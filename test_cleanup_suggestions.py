"""Suggestions exercise real upload/detectors without changing cleanup settings."""
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
import app
import cleanup_suggestions
from test_red_scans import fixture as red_fixture
from test_flat_gray_scans import fixture as gray_fixture


class SuggestionTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        self.headers = {'X-ClearPage': 'local', 'X-Filename': 'sample.pdf'}
        self.keys = []

    def tearDown(self):
        for key in self.keys:
            app.JOBS[key]['state'] = 'ready'
            self.client.post('/api/clear/'+key, json={}, headers=self.headers)

    def upload(self, images):
        data = BytesIO(); canvas = Canvas(data, pagesize=(300,400))
        for image in images:
            canvas.drawImage(ImageReader(image),0,0,300,400); canvas.showPage()
        canvas.save()
        response = self.client.post('/api/upload', data=data.getvalue(), headers=self.headers)
        self.assertEqual(response.status_code,200,response.json)
        key=response.json['id']; self.keys.append(key)
        return key

    def test_mixed_pages_sampling_cache_and_preservation(self):
        red=Image.fromarray(red_fixture()[0]); gray=Image.fromarray(gray_fixture())
        key=self.upload([red,red,gray,red,red]); job=app.JOBS[key]
        before=job['source'].read_bytes(); options=job['options']
        result=self.client.get('/api/suggestions/'+key)
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['sampled_pages'],[1,3,5])
        self.assertEqual([(x['method'],x['pages']) for x in result.json['items']],
                         [('red_copy',[1,5]),('flat_gray_copy',[3])])
        self.assertEqual(job['options'],options); self.assertEqual(job['results'],[])
        self.assertEqual(job['source'].read_bytes(),before)
        with patch.object(cleanup_suggestions,'suggest',side_effect=AssertionError('cache miss')):
            self.assertEqual(self.client.get('/api/suggestions/'+key).json,result.json)
        self.assertFalse(list(job['dir'].glob('*after*')))

    def test_clean_page_no_false_suggestion(self):
        key=self.upload([Image.new('RGB',(600,800),'white')])
        result=self.client.get('/api/suggestions/'+key)
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['sampled_pages'],[1])
        self.assertEqual(result.json['items'],[])
        self.assertEqual(result.json['skipped_pages'],[])

    def test_failed_page_allows_manual_workflow(self):
        key=self.upload([Image.new('RGB',(600,800),'white')])
        with patch.object(app,'original',side_effect=OSError('unreadable preview')):
            result=self.client.get('/api/suggestions/'+key)
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['items'],[])
        self.assertEqual(result.json['skipped_pages'],[1])
        self.assertEqual(app.JOBS[key]['results'],[])

    def test_busy_and_expired_session(self):
        self.assertEqual(self.client.get('/api/suggestions/missing').status_code,400)
        key=self.upload([Image.new('RGB',(600,800),'white')])
        app.JOBS[key]['state']='processing'
        with patch.object(cleanup_suggestions,'suggest',side_effect=AssertionError('busy')):
            response=self.client.get('/api/suggestions/'+key)
        self.assertEqual(response.status_code,200)
        self.assertNotIn('suggestions',app.JOBS[key])

    def test_suggestion_examples_are_served(self):
        for name in ('red-copy.svg','flat-gray.svg','polarity.svg','overlay.webp',
                     'unofficial-copy.webp','huntington.webp','repeated-diagonal.webp',
                     'dotted-document.webp','dotted-map.webp'):
            with self.client.get('/static/type-'+name) as response:
                self.assertEqual(response.status_code,200,name)


if __name__=='__main__': unittest.main()
