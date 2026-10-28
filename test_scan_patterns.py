"""Scan preset preservation and full application route regressions."""
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
import app
import engine
import scan_patterns as patterns


ASSETS = Path(__file__).parent/'assets'


def gray_fixture(height=1994):
    with np.load(ASSETS/f'unofficial-copy-{height}.npz') as data:
        a=data['seed'].copy()
    a[height//2:height//2+5,200:1300]=0
    a[100:108,100:800]=0
    return a


def repeated_fixture():
    a=np.full((1800,1200,3),255,'uint8')
    theta=np.pi/4
    for rho in range(180,2100,180):
        for x in range(0,1200,7):
            y=round((rho-x*np.cos(theta))/np.sin(theta))
            if 0<=y<1797:a[y:y+3,x:x+3]=150
    for y in (500,700,900):a[y:y+6,300:900]=0
    return a


class ScanPatternTests(unittest.TestCase):
    def test_gray_layouts_preserve_dark_strokes_and_outside_template(self):
        for height in patterns.GRAY_LAYOUTS:
            a=gray_fixture(height)
            result,mask,stats=patterns.unofficial_copy(Image.fromarray(a),ASSETS)
            self.assertTrue(stats['matched'])
            self.assertGreater(stats['changed'],1000)
            self.assertTrue(np.array_equal(result[a.min(2)<=32],a[a.min(2)<=32]))
            with np.load(ASSETS/f'unofficial-copy-{height}.npz') as data:
                self.assertFalse(mask[~data['scope']].any())
            self.assertTrue(np.array_equal(mask,np.any(a!=result,axis=2)))

    def test_gray_clean_shifted_and_wrong_aspect_are_unchanged(self):
        for a in (np.full((1994,1541,3),255,'uint8'),np.roll(gray_fixture(),180,axis=1),np.full((400,800,3),180,'uint8')):
            result,mask,stats=patterns.unofficial_copy(Image.fromarray(a),ASSETS)
            self.assertFalse(stats['matched']);self.assertFalse(mask.any())
            self.assertTrue(np.array_equal(result,a))

    def test_landscape_clean_and_displaced_patterns_are_retained(self):
        for height in (1019,1032):
            for a in (np.full((height,1541,3),255,'uint8'), np.roll(gray_fixture(height),150,axis=1)):
                result,mask,stats=patterns.unofficial_copy(Image.fromarray(a),ASSETS)
                self.assertFalse(stats['matched']);self.assertFalse(mask.any())
                np.testing.assert_array_equal(result,a)

    def test_partial_repeat_preserves_content_rectangle_exactly(self):
        a=repeated_fixture()
        result,mask,stats=patterns.repeated_diagonal(Image.fromarray(a))
        self.assertTrue(stats['matched']);self.assertTrue(stats['partial']);self.assertTrue(stats['uncertain'])
        x0,y0,x1,y1=stats['protected_box']
        self.assertLessEqual(x0,300);self.assertGreaterEqual(x1,900)
        self.assertLessEqual(y0,500);self.assertGreaterEqual(y1,906)
        self.assertTrue(np.array_equal(result[y0:y1,x0:x1],a[y0:y1,x0:x1]))
        self.assertGreater(stats['changed'],300)

    def test_repeated_clean_page_and_no_content_are_unchanged(self):
        a=np.full((1800,1200,3),255,'uint8')
        a[500:506,300:900]=0
        result,mask,stats=patterns.repeated_diagonal(Image.fromarray(a))
        self.assertFalse(mask.any());self.assertFalse(stats['matched'])
        self.assertTrue(np.array_equal(result,a))
        a=repeated_fixture();a[490:920,290:910]=255
        result,mask,stats=patterns.repeated_diagonal(Image.fromarray(a))
        self.assertFalse(mask.any())

    def test_missing_assets_cancellation_and_packaging(self):
        image=Image.fromarray(gray_fixture())
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'asset is missing'):
                patterns.unofficial_copy(image,Path(directory))
        with self.assertRaises(InterruptedError):patterns.unofficial_copy(image,ASSETS,lambda:True)
        with self.assertRaises(InterruptedError):patterns.repeated_diagonal(Image.fromarray(repeated_fixture()),lambda:True)
        spec=(ASSETS.parent/'ClearPage.spec').read_text()
        for height in patterns.GRAY_LAYOUTS:self.assertIn(f'assets/unofficial-copy-{height}.npz',spec)

    def test_application_preview_batch_selective_export_and_repair_guard(self):
        client=app.app.test_client()
        with client.get('/?key='+app.TOKEN):pass
        headers={'X-ClearPage':'local'}
        with tempfile.TemporaryDirectory() as directory:
            for method,a in [('unofficial_copy',gray_fixture()),('repeated_diagonal',repeated_fixture())]:
                source=Path(directory)/(method+'.pdf')
                h,w=a.shape[:2]
                canvas=Canvas(str(source),pagesize=(w/2,h/2))
                for _ in range(2):
                    canvas.drawImage(ImageReader(Image.fromarray(a)),0,0,w/2,h/2);canvas.showPage()
                canvas.save();original_bytes=source.read_bytes()
                response=client.post('/api/upload',data=original_bytes,headers=headers)
                self.assertEqual(response.status_code,200,response.json)
                key=response.json['id'];job=app.JOBS[key]
                try:
                    response=client.post('/api/preview/'+key,json=dict(method=method,page=0),headers=headers)
                    self.assertEqual(response.status_code,200,response.json)
                    self.assertTrue(response.json['matched'])
                    options=app.settings(dict(method=method,mode='lama',auto_restore=True,scan_inversion=True,fix_negative=True,use_reviewed=True))
                    self.assertFalse(options['auto_restore']);self.assertFalse(options['scan_inversion'])
                    self.assertFalse(options['fix_negative']);self.assertFalse(options['use_reviewed'])
                    job.update(options=options,results=[],cancel=False)
                    app.batch(job,options)
                    self.assertEqual(job['state'],'review',job['message'])
                    self.assertTrue(all(r['uncertain'] for r in job['results']))
                    app.export_worker(job,[0])
                    self.assertEqual(job['state'],'done',job['message'])
                    for i in range(2):
                        expected=Image.open(app.image_path(job,0,True)) if i==0 else engine.render_page(source,1)
                        self.assertTrue(np.array_equal(engine.render_page(job['dir']/'cleaned.pdf',i),expected))
                    with self.assertRaises(ValueError):app.repair_job(key,{})
                    self.assertEqual(source.read_bytes(),original_bytes)
                finally:
                    job['state']='ready';client.post('/api/clear/'+key,json={},headers=headers)


if __name__=='__main__':unittest.main()
