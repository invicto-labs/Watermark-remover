"""Dedicated Windows window around the local PDF service; no remote Python bridge."""
import sys
from pathlib import Path
from app_version import VERSION


def open_window(url):
    if sys.platform != 'win32':
        raise RuntimeError('The ClearPage desktop edition requires Windows.')
    import webview
    set_app_identity()
    webview.settings['ALLOW_DOWNLOADS'] = True
    webview.settings['ALLOW_FILE_URLS'] = False
    webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True
    webview.settings['OPEN_DEVTOOLS_IN_DEBUG'] = False
    window = webview.create_window(f'ClearPage {VERSION}', url, width=1280, height=850,
                          min_size=(860, 620), background_color='#faf8f4',
                          text_select=True, js_api=None)
    renderer_state = {'supported': False}
    def require_supported_renderer(renderer):
        renderer_state['supported'] = renderer == 'edgechromium'
        return renderer_state['supported']
    # pywebview can otherwise fall back to MSHTML even when Edge was requested.
    # This synchronous event cancels window creation before that fallback appears.
    window.events.initialized += require_supported_renderer
    webview.start(gui='edgechromium', debug=False, private_mode=True,
                  icon=str(Path(__file__).resolve().parent/'assets/clearpage.ico'))
    if not renderer_state['supported']:
        raise RuntimeError('Microsoft Edge WebView2 Runtime is required.')


def set_app_identity():
    import ctypes
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('RaysanSure.ClearPage')


def show_startup_error():
    message = ('ClearPage could not open its desktop window.\n\n'
               'Extract the complete ZIP, keeping _internal beside ClearPage.exe. '
               'Windows 10/11 x64 and Microsoft Edge WebView2 Runtime are required.\n\n'
               'WebView2: https://developer.microsoft.com/microsoft-edge/webview2/\n'
               'If the problem continues, contact sales@zynape.com.')
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, 'ClearPage — unable to start', 0x10)
    else:
        print(message, file=sys.stderr)
