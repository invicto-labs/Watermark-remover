"""Local reconstruction routing, masking, cache, and explicit review checks."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
import app, engine, scan_patterns
from test_scan_patterns import repeated_fixture


class RepeatedAITests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.source=self.root/'input.pdf';self.a=repeated_fixture()
        canvas=Canvas(str(self.source),pagesize=(600,900))
        for _ in range(2):
            canvas.drawImage(ImageReader(Image.fromarray(self.a)),0,0,600,900);canvas.showPage()
        canvas.save()
        self.client=app.app.test_client()
        with self.client.get('/?key='+app.TOKEN):pass
        self.headers={'X-ClearPage':'local'}
        response=self.client.post('/api/upload',data=self.source.read_bytes(),headers=self.headers)
        self.assertEqual(response.status_code,200,response.json)
        self.job=app.JOBS[response.json['id']];self.key=self.job['id']
        self.options=app.settings(dict(method='repeated_diagonal_ai',auto_restore=True,fix_negative=True,use_reviewed=True))

    def tearDown(self):
        self.job['state']='ready'
        self.client.post('/api/clear/'+self.key,json={},headers=self.headers)
        self.tmp.cleanup()

    @staticmethod
    def predict(source,mask,*args,**kwargs):
        result=source.copy();result[mask]=255
        return result

    def test_mask_crosses_document_content_but_excludes_unrelated_ink(self):
        mask,note=scan_patterns.repeated_ai_mask(Image.fromarray(self.a))
        self.assertTrue(mask[500:506,300:900].any())
        self.assertFalse(mask.all());self.assertIn('draft',note)
        for image in (Image.new('RGB',(1200,1800),'white'),Image.new('RGB',(300,300),'black')):
            mask,_=scan_patterns.repeated_ai_mask(image);self.assertFalse(mask.any())
        with self.assertRaises(InterruptedError):
            scan_patterns.repeated_ai_mask(Image.fromarray(self.a),lambda:True)

    def test_preview_cache_batch_review_gate_and_selective_export(self):
        self.assertEqual(self.options['mode'],'lama')
        self.assertFalse(self.options['auto_restore']);self.assertFalse(self.options['fix_negative'])
        self.assertFalse(self.options['use_reviewed'])
        with patch.object(app.neural_restore,'inpaint',side_effect=self.predict) as model:
            first=self.client.post('/api/preview/'+self.key,json=dict(method='repeated_diagonal_ai',page=0),headers=self.headers)
            self.assertEqual(first.status_code,200,first.json)
            self.assertTrue(first.json['ai']);self.assertTrue(first.json['uncertain'])
            self.assertTrue(first.json['reconstruction_unverified'])
            again=self.client.post('/api/preview/'+self.key,json=dict(method='repeated_diagonal_ai',page=0),headers=self.headers)
            self.assertEqual(first.json,again.json);self.assertEqual(model.call_count,1)
            self.job.update(options=self.options,results=[],cancel=False)
            app.batch(self.job,self.options)
            self.assertEqual(self.job['state'],'review',self.job['message'])
            self.assertEqual(model.call_count,2)
        denied=self.client.post('/api/export/'+self.key,json={'keep':[0]},headers=self.headers)
        self.assertEqual(denied.status_code,400);self.assertIn('Mark page reviewed',denied.json['error'])
        app.require_ai_review(self.job,[])  # Keeping originals requires no AI approval.
        self.job['ui']={'reviewed':[1]}
        with self.assertRaises(ValueError):app.require_ai_review(self.job,[0])
        self.job['ui']={'reviewed':[0]}
        app.export_worker(self.job,[0])
        self.assertEqual(self.job['state'],'done',self.job['message'])
        for i in range(2):
            rendered=engine.render_page(self.job['dir']/'cleaned.pdf',i)
            expected=Image.open(app.image_path(self.job,0,True)) if i==0 else engine.render_page(self.source,1)
            self.assertTrue(np.array_equal(rendered,expected))
        # Returning to conservative mode must start from the original, not AI pixels.
        options=app.settings({'method':'repeated_diagonal'})
        stats=app.process_page(self.job,0,options)
        x0,y0,x1,y1=stats['protected_box']
        after=np.array(Image.open(app.image_path(self.job,0,True)))
        original=np.array(engine.render_page(self.source,0))
        self.assertTrue(np.array_equal(after[y0:y1,x0:x1],original[y0:y1,x0:x1]))

    def test_model_failure_and_cancel_do_not_publish_draft(self):
        for error in (ValueError('weights missing'),InterruptedError('Cancelled')):
            with patch.object(app.neural_restore,'inpaint',side_effect=error):
                with self.assertRaises(type(error)):
                    app.process_page(self.job,0,self.options)
            self.assertFalse(app.image_path(self.job,0,True).exists())
            self.assertFalse(list(self.job['dir'].glob('*-repeated-ai-*.png')))

    def test_invalid_model_output_is_rejected(self):
        with patch.object(app.neural_restore,'inpaint',return_value=np.zeros_like(self.a)):
            with self.assertRaisesRegex(ValueError,'pixel-preservation'):
                app.process_page(self.job,0,self.options)
        self.assertFalse(app.image_path(self.job,0,True).exists())
        self.assertFalse(list(self.job['dir'].glob('*-repeated-ai-*.png')))


if __name__=='__main__':unittest.main()
