"""Local PDF backend for the Vite development launcher."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app

if __name__ == '__main__':
    app.SERVER = app.make_server('127.0.0.1', 0, app.app, threaded=True,
                                 request_handler=app.QuietHandler)
    app.HOST = f'127.0.0.1:{app.SERVER.server_port}'
    print(json.dumps({'backend': f'http://{app.HOST}'}), flush=True)
    try:
        app.SERVER.serve_forever()
    finally:
        app.SERVER.server_close()
        app.cleanup()
