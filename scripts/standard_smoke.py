"""Check the extracted EXE, including billing-config tamper rejection, without real payments."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def check_desktop(bundle):
    """Launch the actual packaged GUI with downloaded-file marks retained."""
    bundle = Path(bundle)
    if not (bundle/'ClearPage.exe.config').is_file():
        raise RuntimeError('The desktop .NET configuration is missing.')
    # Mimic a browser download followed by Windows Explorer ZIP extraction.
    for file in bundle.rglob('*'):
        if file.is_file() and file.suffix.lower() in ('.dll', '.exe', '.config'):
            Path(str(file)+':Zone.Identifier').write_text('[ZoneTransfer]\nZoneId=3\n', encoding='ascii')
    with tempfile.TemporaryDirectory(prefix='ClearPage-desktop-check-') as folder:
        root = Path(folder)
        info = root/'desktop.json'
        env = {**os.environ, 'LOCALAPPDATA':str(root/'local'), 'CLEARPAGE_DATA_DIR':str(root/'profile')}
        process = subprocess.Popen([str(bundle/'ClearPage.exe'), '--desktop-smoke-info', str(info)], env=env,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            process.wait(timeout=60)
            if process.returncode or not info.is_file():
                log = root/'local/ClearPage/startup-error.log'
                detail = log.read_text(encoding='utf-8') if log.is_file() else 'The UI did not finish loading.'
                raise RuntimeError('Downloaded desktop startup failed: '+detail)
            result = json.loads(info.read_text(encoding='utf-8'))
            if result.get('renderer') != 'edgechromium' or result.get('ui_ready') is not True:
                raise RuntimeError('The packaged desktop UI did not load with WebView2.')
            return {**result, 'download_marks':True}
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)


def check_package(bundle, version):
    exe = Path(bundle)/'ClearPage.exe'
    config = Path(bundle)/'_internal/billing.json'
    original = config.read_bytes()
    results = []
    try:
        with tempfile.TemporaryDirectory(prefix='ClearPage-standard-check-') as folder:
            root = Path(folder)
            for mode in ('normal','environment-override','changed-config','missing-config'):
                config.write_bytes(original)
                if mode == 'changed-config': config.write_text('{}')
                if mode == 'missing-config': config.unlink()
                info = root/(mode+'.json')
                # External network unavailable by design; local app HTTP still works.
                env = {**os.environ,'CLEARPAGE_DATA_DIR':str(root/'profile'),'LOCALAPPDATA':str(root/'local'),
                       'HTTPS_PROXY':'http://127.0.0.1:9','HTTP_PROXY':'http://127.0.0.1:9','NO_PROXY':'127.0.0.1,localhost'}
                env.pop('PYTHONPATH',None)
                env['CLEARPAGE_BILLING_CONFIG'] = str(root/'absent.json') if mode == 'environment-override' else str(config)
                process = subprocess.Popen([str(exe),'--test-info',str(info)],env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                try:
                    deadline=time.monotonic()+45
                    while not info.exists() and time.monotonic()<deadline:
                        if process.poll() is not None: raise RuntimeError('Packaged EXE exited before startup.')
                        time.sleep(.2)
                    base = json.loads(info.read_text())['url'].rstrip('/')
                    def call(path, body=None):
                        req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),
                            headers={'Content-Type':'application/json','X-ClearPage':'local'})
                        with opener.open(req,timeout=25) as response:return json.load(response)
                    billing=call('/api/billing')
                    if not billing['enabled'] or billing['credits'] != 0 or billing.get('admin'): raise RuntimeError('Credit gate bypassed.')
                    if mode in ('changed-config','missing-config') and not billing.get('error'): raise RuntimeError('Config tampering accepted.')
                    update=call('/api/update-status')
                    if update['current_version'] != version: raise RuntimeError('Packaged version mismatch.')
                    try: call('/api/billing/activate',{'key':'forged'}); raise RuntimeError('Offline credit activation accepted.')
                    except urllib.error.HTTPError as error:
                        if error.code not in (400,402): raise
                    try: call('/api/admin/login',{'username':'admin','password':'admin'}); raise RuntimeError('Default owner login accepted.')
                    except urllib.error.HTTPError as error:
                        if error.code not in (400,401,402,503): raise
                    call('/api/quit',{})
                    process.wait(timeout=15)
                    results.append(dict(mode=mode,locked=True,version=version))
                finally:
                    if process.poll() is None: process.terminate(); process.wait(timeout=10)
    finally:
        config.write_bytes(original)
    return results
