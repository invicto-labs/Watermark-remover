"""Native tiled and fax scan cleanup for the supported diagonal licensing stamp.

The tiled variant interpolates crossings; the fax variant removes isolated stamp fragments. Text is never OCR-rewritten;
overlapping strokes remain estimates and require review.
"""
from functools import lru_cache
from clearpage.paths import RESOURCE_ROOT
from pathlib import Path
import hashlib
import json
from PIL import Image
import cv2
import numpy as np
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject
from clearpage.pdf.pdf_overlays import read_pdf
from clearpage.presets.dotted_scans import replace_image

METHODS = ('licensed_diagonal',)
CACHE = 'licensed-diagonal-v2'
WIDTH = 2560
HEIGHTS = {3312: (736, 736, 736, 736, 368),
           4208: (766, 766, 766, 766, 766, 378)}


@lru_cache(maxsize=1)
def profile():
    path = RESOURCE_ROOT/'assets/licensed-diagonal.npz'
    if hashlib.sha256(path.read_bytes()).hexdigest() != '41fabde6872417d45eb021ff5a7e13ee14c1419e1048aa08a5e0d3b7eb6bac7b':
        raise ValueError('The diagonal licensing profile is damaged. Reinstall ClearPage.')
    with np.load(path, allow_pickle=False) as data:
        mask = np.unpackbits(data['mask'], axis=1).astype(bool)
        layouts = {h: data[f'layout_{h}'].tobytes() for h in HEIGHTS}
    if mask.shape != (3312, WIDTH) or mask.sum() != 39629:
        raise ValueError('Invalid diagonal licensing profile.')
    ring = cv2.dilate(mask.astype('uint8'), np.ones((5, 5), 'uint8')).astype(bool) & ~mask
    return mask, ring, layouts


@lru_cache(maxsize=1)
def fax_profile():
    # Stamp-only consensus from clear areas; no document pixels or page numbers required.
    with Image.open(RESOURCE_ROOT/'assets/licensed-fax.png') as image:
        if image.size != (WIDTH, 3312) or image.mode != '1':
            raise ValueError('Invalid diagonal fax profile.')
        mask = ~np.asarray(image)
    digest = hashlib.sha256(np.packbits(mask).tobytes()).hexdigest()
    if digest != '64e62493dbfe0b79a02b0dbf99b409707025f7796a8af857f8659ea2512c84ce':
        raise ValueError('Invalid diagonal fax profile.')
    ring = cv2.dilate(mask.astype('uint8'), np.ones((5, 5), 'uint8')).astype(bool) & ~mask
    return mask, ring


def scan_objects(page, *, cached=False):
    if page.rotation or '/Resources' not in page or '/XObject' not in page['/Resources']:
        return None
    objects = page['/Resources']['/XObject']
    if len(objects) == 1:
        name = next(iter(objects))
        obj = objects[name]
        if (obj.get('/Subtype') != '/Image' or obj.get('/ColorSpace') != '/DeviceGray'
                or obj.get('/BitsPerComponent') != 1 or obj.get('/Width') != WIDTH
                or obj.get('/Height') != 3312
                or any(k in obj for k in ('/Decode', '/Mask', '/SMask', '/ImageMask'))):
            return None
        if cached:
            return [(name, obj)] if obj.get('/Filter') == '/FlateDecode' else None
        params = obj.get('/DecodeParms')
        if obj.get('/Filter') != '/CCITTFaxDecode' or params is None:
            return None
        params = params.get_object()
        if (params.get('/K') != -1 or params.get('/Columns') != WIDTH
                or params.get('/Rows', 3312) != 3312):
            return None
        return [(name, obj)]
    heights = next((v for v in HEIGHTS.values() if len(v) == len(objects)), None)
    if heights is None or page.rotation:
        return None
    names = [f'/Image{i+1}' for i in range(len(heights))]
    if set(objects) != set(names):
        return None
    bands = []
    for name, height in zip(names, heights):
        obj = objects[name].get_object()
        if (obj.get('/Subtype') != '/Image' or obj.get('/ColorSpace') != '/DeviceGray'
                or obj.get('/BitsPerComponent') != 8 or obj.get('/Filter') != '/FlateDecode'
                or obj.get('/Width') != WIDTH or obj.get('/Height') != height
                or any(k in obj for k in ('/Decode', '/Mask', '/SMask', '/ImageMask'))):
            return None
        bands.append((name, obj))
    content = page.get_contents()
    if content is None or content.get_data() != profile()[2][sum(heights)]:
        return None
    return bands


def native_pixels(page, bands):
    if len(bands) == 1:
        name, _ = bands[0]
        return np.asarray(page.images[name].image.convert('L'))
    parts = []
    for _, obj in bands:
        height = int(obj['/Height'])
        data = obj.get_data()
        if len(data) != height*WIDTH:
            return None
        pixels = np.frombuffer(data, dtype='uint8').reshape(height, WIDTH)
        if np.any((pixels != 0) & (pixels != 255)):
            return None
        parts.append(pixels)
    return np.vstack(parts)


def matches(scan, *, fax=False):
    if scan is None or scan.dtype != np.uint8 or scan.shape not in ((3312, WIDTH), (4208, WIDTH)):
        return False
    if np.any((scan != 0) & (scan != 255)):
        return False
    if fax and scan.shape != (3312, WIDTH):
        return False
    mask, ring = fax_profile() if fax else profile()[:2]
    ink = scan[:3312] == 0
    signal, background = float(ink[mask].mean()), float(ink[ring].mean())
    if signal < .55 or background > .30 or signal-background < .30:
        return False
    y, x = np.nonzero(mask)
    # A shifted pattern must not use a mask at the wrong pixel coordinates.
    shifted = max(float(ink[y+dy, x+dx].mean()) for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)))
    return signal-shifted > .04


def clean_pixels(scan, cancelled=lambda: False, *, fax=False):
    if cancelled(): raise InterruptedError('Cancelled')
    details = dict(native_licensed=True, scan_pattern=True, matched=False, changed=0,
                   protected=0, confidence=None, uncertain=False, reviewed=False,
                   pattern_note='Original page kept: no matching diagonal licensing watermark.')
    if not matches(scan, fax=fax):
        return scan, details
    if fax:
        mask, _ = fax_profile()
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            (scan == 0).astype('uint8'), connectivity=4)
        inside = np.bincount(labels[mask], minlength=count)
        size = stats[:, cv2.CC_STAT_AREA]
        stamp = (inside == size) | ((size >= 80) & (inside >= .987 * size))
        stamp[0] = False
        result = scan.copy()
        result[mask] = np.where(stamp[labels[mask]], 255, scan[mask])
        if cancelled(): raise InterruptedError('Cancelled')
        details.update(matched=True, refined_fax=True, changed=int(np.count_nonzero(result != scan)),
                       protected=int(np.count_nonzero(scan[~mask] == 0)), watermark_pixels=int(mask.sum()),
                       uncertain=True, pattern_note='Removed matching diagonal stamp fragments. Review crossings with printed ink.')
        return result, details
    mask = np.zeros(scan.shape, bool); mask[:3312] = profile()[0]
    estimated = cv2.inpaint(scan, mask.astype('uint8'), 3, cv2.INPAINT_TELEA)
    result = scan.copy()
    result[mask] = np.where(estimated[mask] < 128, 0, 255)
    if cancelled(): raise InterruptedError('Cancelled')
    if not np.array_equal(scan[~mask], result[~mask]):
        raise ValueError('Ink-preservation check failed. Original page kept.')
    details.update(matched=True, changed=int(np.count_nonzero(result != scan)),
                   protected=int(np.count_nonzero(scan[~mask] == 0)), uncertain=True,
                   stroke_reconstruction=True, watermark_pixels=int(mask.sum()),
                   pattern_note='Diagonal licensing stamp removed at original resolution. Pixels outside the stamp are unchanged. Review reconstructed crossings with words and signatures.')
    return result, details


def prepare(source, index, directory, cancelled=lambda: False):
    if cancelled(): raise InterruptedError('Cancelled')
    target = Path(directory)/f'{index}-{CACHE}.pdf'
    metadata = target.with_suffix('.json')
    if target.exists() and metadata.exists():
        return target, json.loads(metadata.read_text())
    page = read_pdf(source).pages[index]
    bands = scan_objects(page)
    scan = native_pixels(page, bands) if bands else None
    result, details = clean_pixels(scan, cancelled, fax=bool(bands and len(bands) == 1))
    writer = PdfWriter(); writer.add_page(page)
    if details['matched']:
        offset = 0
        for name, obj in bands:
            height = int(obj['/Height'])
            stream = DecodedStreamObject()
            stream.update({k: v for k, v in obj.items() if k not in ('/Length', '/Filter', '/DecodeParms')})
            pixels = result[offset:offset+height]
            if len(bands) == 1:
                pixels = np.packbits(pixels != 0, axis=1)
            stream.set_data(pixels.tobytes())
            replace_image(writer, writer.pages[0], name, stream.flate_encode())
            offset += height
    temporary = target.with_suffix('.part')
    try:
        if cancelled(): raise InterruptedError('Cancelled')
        writer.write(temporary)
        if cancelled(): raise InterruptedError('Cancelled')
        temporary.replace(target)
        metadata.write_text(json.dumps(details))
    finally:
        temporary.unlink(missing_ok=True)
    return target, details


def write_clean(source, target, keep, directory, cancelled=lambda: False):
    writer = PdfWriter(clone_from=read_pdf(source))
    for index in keep:
        cached, details = prepare(source, index, directory, cancelled)
        if not details['matched']: continue
        bands = scan_objects(read_pdf(cached).pages[0], cached=True)
        original = scan_objects(writer.pages[index])
        if bands is None or original is None or [n for n, _ in bands] != [n for n, _ in original]:
            raise ValueError('The licensing cleanup cache is invalid. Process the file again.')
        for name, obj in bands:
            replace_image(writer, writer.pages[index], name, obj.clone(writer))
    temporary = Path(str(target)+'.part')
    try:
        if cancelled(): raise InterruptedError('Cancelled')
        writer.write(temporary)
        if cancelled(): raise InterruptedError('Cancelled')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
