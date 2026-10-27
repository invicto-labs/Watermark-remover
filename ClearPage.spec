# Build from the repository root in a clean Windows virtual environment.
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH)
datas = [(str(root/'static'), 'static'), (str(root/'assets/huntington.npy'), 'assets'),
         (str(root/'assets/ocr-word.ps1'), 'assets'),
         (str(root/'models/big-lama.pt'), 'models'),
         (str(root/'models/PP-OCRv6_rec_small.onnx'), 'models')]
binaries, hiddenimports = [], []
for package in ('pypdfium2', 'pypdfium2_raw'):
    data, binary, imports = collect_all(package)
    datas += data
    binaries += binary
    hiddenimports += imports

a = Analysis([str(root/'app.py')], pathex=[str(root)], binaries=binaries,
             datas=datas, hiddenimports=hiddenimports,
             excludes=['matplotlib', 'pandas', 'scipy', 'IPython', 'notebook', 'pytest'],
             noarchive=False, optimize=0)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ClearPage',
          console=False, strip=False, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='ClearPage')
