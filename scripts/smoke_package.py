"""Exercise an extracted Windows package using only generated test documents."""
from pathlib import Path
from io import BytesIO
import http.cookiejar
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import numpy as np
from PIL import Image, ImageDraw
from reportlab.pdfgen.canvas import Canvas
import engine


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def check_package(bundle, version):
    executable = bundle/'ClearPage.exe'
    require(executable.is_file(), 'Missing ClearPage.exe.')
    require((bundle/'licenses/Python-LICENSE.txt').is_file(), 'Missing licenses.')
    with tempfile.TemporaryDirectory(prefix='ClearPage-release-') as folder:
        root = Path(folder)
        # Keep all smoke-test state out of the developer or runner user profile.
        env = dict(os.environ, LOCALAPPDATA=str(root/'profile'), TEMP=str(root), TMP=str(root))
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        report = root/'models.json'
        subprocess.run([str(executable), '--release-self-test', str(report)],
                       check=True, timeout=180, env=env, creationflags=flags)
        model_checks = json.loads(report.read_text())
        require(all(model_checks.get(key) for key in ('lama_inference', 'onnx_inference', 'outside_mask_preserved')),
                'Packaged model inference checks failed.')
        info = root/'launch.json'
        process = subprocess.Popen([str(executable), '--test-info', str(info)], env=env, creationflags=flags)
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                  urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        base = None
        def get(path):
            with client.open(base+path, timeout=30) as response:
                return response.read()
        def post(path, data, name=None):
            headers = {'X-ClearPage': 'local', 'Content-Type': 'application/json'}
            if name:
                headers.update({'X-Filename': name, 'Content-Type': 'application/octet-stream'})
            request = urllib.request.Request(base+path, data=data if name else json.dumps(data).encode(), headers=headers)
            with client.open(request, timeout=90) as response:
                return json.load(response)
        def wait_job(identifier, expected):
            deadline = time.monotonic()+90
            while time.monotonic() < deadline:
                job = json.loads(get('/api/job/'+identifier))
                if job['state'] not in ('processing', 'exporting', 'restoring', 'learning'):
                    require(job['state'] == expected, f'Unexpected processing state: {job}')
                    return job
                time.sleep(.2)
            raise TimeoutError('Packaged document processing timed out.')
        try:
            deadline = time.monotonic()+60
            while not info.exists() and time.monotonic() < deadline:
                require(process.poll() is None, 'Application exited before starting its server.')
                time.sleep(.2)
            launch = json.loads(info.read_text())['url']
            base = launch.split('/?')[0]
            with client.open(launch, timeout=30) as response:
                require(f'ClearPage {version}' in response.read().decode(), 'Wrong application version.')
            for asset in ('app.js', 'style.css', 'repair.js'):
                require(len(get('/static/'+asset)) > 100, 'Missing static asset: '+asset)
            positive = Image.new('RGB', (600, 800), 'white')
            draw = ImageDraw.Draw(positive)
            for line in range(12):
                draw.text((40, 50+line*28), 'SYNTHETIC RELEASE CHECK 1234567890', fill='black')
            marked = positive.copy()
            ImageDraw.Draw(marked).ellipse((200, 690, 230, 720), fill=(195, 195, 195))
            negative = Image.fromarray(255-np.array(marked))
            fixtures = []
            for format, name in [('PNG', 'negative.png'), ('TIFF', 'mixed.tiff'), ('JPEG', 'normal.jpg')]:
                memory = BytesIO()
                image = positive if format == 'JPEG' else negative
                extra = dict(save_all=True, append_images=[positive]) if format == 'TIFF' else {}
                image.save(memory, format=format, dpi=(144, 144), **extra)
                fixtures.append((name, memory.getvalue(), format))
            memory = BytesIO()
            canvas = Canvas(memory, pagesize=(300, 400))
            canvas.drawString(30, 320, 'SYNTHETIC PDF 12345')
            canvas.showPage();canvas.save()
            fixtures.append(('document.pdf', memory.getvalue(), 'PDF'))
            verified = []
            for name, data, kind in fixtures:
                job = post('/api/upload', data, name)
                identifier = job['id']
                original = np.array(Image.open(BytesIO(get(f'/api/page/{identifier}/0/before'))).convert('RGB'))
                options = dict(method='manual', mode='light', fix_negative=True,
                               polarity_pages=[0] if kind in ('PNG', 'TIFF') else [],
                               strokes=[dict(points=[[215/600, 705/800]], width=.1)],
                               auto_restore=False, use_reviewed=False)
                post('/api/process/'+identifier, options)
                processed = wait_job(identifier, 'review')
                changed = kind in ('PNG', 'TIFF')
                if changed:
                    require(processed['results'][0]['color_correction']['applied'], 'Negative scan was not corrected.')
                post('/api/export/'+identifier, {'keep': [0] if changed else []})
                wait_job(identifier, 'done')
                exported = root/(kind+'.pdf')
                exported.write_bytes(get('/api/download/'+identifier))
                rendered = np.array(engine.render_page(exported, 0))
                if changed:
                    require(np.array_equal(rendered[:650], np.array(positive)[:650]), 'Correction damaged original text.')
                    require(rendered[700:710, 210:220].min() > 245, 'Synthetic mark was not removed.')
                else:
                    require(np.array_equal(rendered, original), 'Unchecked page changed.')
                require(len(engine.inspect_pdf(exported)[1]) == (2 if kind == 'TIFF' else 1), 'Wrong page count.')
                if kind == 'TIFF':
                    require(np.array_equal(engine.render_page(exported, 1), positive), 'Unselected TIFF page changed.')
                verified.append(kind)
                post('/api/clear/'+identifier, {})
            post('/api/quit', {})
            process.wait(timeout=20)
            require(process.returncode == 0, 'Application did not exit cleanly.')
            return dict(models=model_checks, formats=verified, selected_export=True,
                        unselected_pages_preserved=True, clean_shutdown=True)
        finally:
            if process.poll() is None:
                if base:
                    try:
                        post('/api/quit', {})
                        process.wait(timeout=10)
                    except Exception:
                        pass
                if process.poll() is None:
                    process.kill();process.wait(timeout=10)
