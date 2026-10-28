"""Explicit scan presets with conservative matching and no generated lettering."""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from vendor.purescan_core import invert_multiply

METHODS = ('unofficial_copy', 'repeated_diagonal', 'repeated_diagonal_ai')
MAX_PIXELS = 12_000_000
GRAY_LAYOUTS = (1019, 1032, 1994, 2019, 2024, 2029, 2536, 2538)


def unchanged(a, note):
    return a.copy(), np.zeros(a.shape[:2], bool), dict(
        scan_pattern=True, confidence=None, matched=False, changed=0,
        protected=0, reviewed=False, uncertain=False, pattern_note=note)


def unofficial_copy(image, assets, cancelled=lambda: False):
    a = np.array(image.convert('RGB'))
    h, w = a.shape[:2]
    if h*w > MAX_PIXELS:
        raise ValueError('This scan is too large for gray-watermark cleanup.')
    candidates = []
    for height in GRAY_LAYOUTS:
        error = abs(w/h - 1541/height)
        if error < .008:
            candidates.append((error, height))
    if not candidates:
        return unchanged(a, 'This page does not match a supported Unofficial Copy layout. Original retained.')
    height = min(candidates)[1]
    path = Path(assets)/f'unofficial-copy-{height}.npz'
    if not path.is_file():
        raise ValueError('The Unofficial Copy pattern asset is missing. Reinstall the complete application.')
    with np.load(path, allow_pickle=False) as data:
        template, seed, scope = data['template'], data['seed'], data['scope']
    if (h, w) != seed.shape[:2]:
        template = cv2.resize(template, (w, h), interpolation=cv2.INTER_LINEAR)
        seed = cv2.resize(seed, (w, h), interpolation=cv2.INTER_LINEAR)
        scope = cv2.resize(scope.astype('uint8'), (w, h), interpolation=cv2.INTER_NEAREST) > 0
    gray = a.min(2)
    ink = seed.min(2) < 225
    # Require the known glyphs and their white surroundings to agree. A clean
    # page, a different diagonal mark, or a displaced pattern must not qualify.
    visible = ink & (gray > 64)
    coverage = float(np.mean(gray[ink] < 235)) if ink.any() else 0.
    agreement = float(np.mean(np.abs(a.astype('float32')[visible] - template[visible]) < 45)) if visible.any() else 0.
    edge = cv2.dilate(ink.astype('uint8'), np.ones((13,13),'uint8')) > 0
    edge &= ~cv2.dilate(ink.astype('uint8'), np.ones((3,3),'uint8')).astype(bool)
    edge_white = float(np.mean(gray[edge] > 225)) if edge.any() else 0.
    if coverage < .75 or agreement < .70 or edge_white < .65:
        return unchanged(a, 'No confident Unofficial Copy pattern match. Original page retained.')
    if cancelled():
        raise InterruptedError('Cancelled')
    selected = scope & (seed.min(2) >= 64) & (gray > 32)
    result = invert_multiply(a, template, selected)
    near_ink = cv2.dilate((result.min(2) < 180).astype('uint8'), np.ones((3,3),'uint8')) > 0
    result[selected & ~near_ink & (result.min(2) >= 235)] = 255
    changed = np.any(result != a, axis=2)
    return result, changed, dict(scan_pattern=True, confidence=None, pattern_match=round(agreement, 3),
        matched=bool(changed.any()), changed=int(changed.sum()), protected=int((scope & (gray <= 32)).sum()),
        reviewed=False, uncertain=bool(changed.any()),
        pattern_note='Unofficial Copy reverse blending applied. Original near-black strokes retained; check words beneath the gray mark before selecting this page.')


def _repeated_detection(image, cancelled=lambda: False):
    """Shared regular-line detector; no reconstruction is performed here."""
    a = np.array(image.convert('RGB'))
    gray = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    if h*w > MAX_PIXELS:
        raise ValueError('This scan is too large for repeated-watermark cleanup.')
    if cancelled(): raise InterruptedError('Cancelled')
    def no_match(note):
        return a, gray, None, None, None, note
    _, labels, stats, _ = cv2.connectedComponentsWithStats((gray < 220).astype('uint8'), connectivity=8)
    small = (stats[:,4] >= 2) & (stats[:,4] <= 80) & (stats[:,2] <= 23) & (stats[:,3] <= 23)
    small[0] = False
    candidates = small[labels].astype('uint8')
    lines = cv2.HoughLines(candidates, 1, np.pi/180, max(60,int(w*.12)),
                           min_theta=np.pi*25/180, max_theta=np.pi*65/180)
    if lines is None:
        return no_match('No repeated diagonal lettering detected. Original retained.')
    angles = np.round(lines[:,0,1]*180/np.pi).astype(int)
    angle = int(np.bincount(angles).argmax())
    y, x = np.ogrid[:h,:w]
    rho = x*np.cos(angle*np.pi/180) + y*np.sin(angle*np.pi/180)
    projection = np.bincount(np.round(rho).astype(int).ravel(), weights=candidates.ravel())
    smooth = np.convolve(projection, np.ones(15), mode='same')
    peaks = []
    for _ in range(30):
        p = int(smooth.argmax())
        if smooth[p] < w: break
        peaks.append(p)
        smooth[max(0,p-50):p+51] = 0
    if len(peaks) < 4:
        return no_match('Not enough repeated diagonal lines to distinguish a watermark. Original retained.')
    # Keep a regular sequence, rather than unrelated diagonal annotations.
    best = []
    for left in peaks:
        for right in peaks:
            period = abs(right-left)
            if not 85 <= period <= min(w,h)*.4: continue
            fit = [p for p in peaks if abs((p-left+period/2) % period-period/2) < 8]
            if len(fit) > len(best): best = fit
    if len(best) < 4:
        return no_match('The diagonal marks do not form a supported repeated pattern. Original retained.')
    band = np.zeros(gray.shape, bool)
    for p in best: band |= np.abs(rho-p) < 18
    if cancelled(): raise InterruptedError('Cancelled')
    return a, gray, labels, stats, band, ''


def repeated_ai_mask(image, cancelled=lambda: False):
    """Select ink along detected diagonal bands, including document overlaps.

    This mask intentionally includes intersecting original strokes. The caller
    must label predictions as generated drafts, never as exact restorations.
    """
    a, gray, _, _, band, note = _repeated_detection(image, cancelled)
    if band is None:
        return np.zeros(a.shape[:2], bool), note
    selected = band & (gray < 245)
    selected = (cv2.dilate(selected.astype('uint8'), np.ones((3,3), 'uint8')) > 0) & band
    count = int(selected.sum())
    if count < 300 or count > gray.size*.25:
        return np.zeros(gray.shape, bool), 'The detected area is too small or too broad for automatic AI cleanup. Original retained; use a custom painted area instead.'
    return selected, 'AI reconstruction draft: detected diagonal bands include overlapping text. Letters, numbers, signatures and barcode data may change. Review every affected area before selecting this page. Complete removal and text accuracy are not verified.'


def repeated_diagonal(image, cancelled=lambda: False):
    """Remove lettering in blank areas; preserve the content rectangle."""
    a, gray, labels, stats, band, note = _repeated_detection(image, cancelled)
    if band is None:
        return unchanged(a, note)
    h, w = gray.shape
    # Horizontal runs of dark body text, rules, signatures and barcodes establish
    # one conservative content rectangle. Never erase inside that rectangle.
    horizontal = cv2.morphologyEx((gray < 100).astype('uint8'), cv2.MORPH_CLOSE, np.ones((3,31),'uint8'))
    _, _, boxes, _ = cv2.connectedComponentsWithStats(horizontal, connectivity=8)
    body = boxes[1:][(boxes[1:,2] >= 55) & (boxes[1:,4] >= 120) & (boxes[1:,2] > boxes[1:,3]*1.5)]
    if len(body) < 3:
        return unchanged(a, 'Could not establish a protected document-content area. Original retained.')
    margin = max(20, round(w*.025))
    x0=max(0,int(body[:,0].min())-margin); y0=max(0,int(body[:,1].min())-margin)
    x1=min(w,int((body[:,0]+body[:,2]).max())+margin); y1=min(h,int((body[:,1]+body[:,3]).max())+margin)
    protected = np.zeros(gray.shape, bool); protected[y0:y1,x0:x1] = True
    isolated = (stats[:,4] >= 1) & (stats[:,4] <= 400) & (stats[:,2] <= 40) & (stats[:,3] <= 40)
    isolated[np.unique(labels[protected | ~band])] = False
    remove = isolated[labels]
    # Clear only pale compression fringes immediately next to selected dots.
    edge = cv2.dilate(remove.astype('uint8'),np.ones((3,3),'uint8')) > 0
    remove |= edge & (gray >= 220) & ~protected & band
    if np.count_nonzero(remove & (gray < 220)) < 300:
        return unchanged(a, 'No removable diagonal lettering outside the protected content area. Original retained.')
    if cancelled(): raise InterruptedError('Cancelled')
    result = a.copy(); result[remove] = 255
    changed = np.any(result != a, axis=2)
    return result, changed, dict(scan_pattern=True, confidence=None, matched=True,
        changed=int(changed.sum()), protected=int((protected & band & (gray<220)).sum()),
        reviewed=False, uncertain=True, partial=True, protected_box=[x0,y0,x1,y1],
        pattern_note='Partial cleanup: diagonal lettering removed in blank areas. The entire document-content area is preserved exactly, including overlapping watermark. This is not a fully clean copy.')
