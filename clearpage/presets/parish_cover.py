"""Remove repeated overlays encoded in the alpha channel of parish recording covers."""
from io import BytesIO

import cv2
import numpy as np
from PIL import Image
from pypdf.generic import DecodedStreamObject, NameObject

from clearpage.presets.dotted_scans import replace_image
from clearpage.presets.scan_patterns import MAX_PIXELS


def cover_image(page):
    objects = page['/Resources'].get('/XObject') if '/Resources' in page else None
    if objects is None or len(objects.get_object()) != 1:
        return None
    objects = objects.get_object()
    name = next(iter(objects))
    obj = objects[name]
    if (obj.get('/Filter') != '/DCTDecode' or obj.get('/Subtype') != '/Image'
            or obj.get('/ColorSpace') != '/DeviceRGB' or obj.get('/BitsPerComponent') != 8
            or '/SMask' not in obj or any(k in obj for k in ('/Mask', '/ImageMask', '/Decode'))):
        return None
    alpha = obj['/SMask']
    width, height = int(obj['/Width']), int(obj['/Height'])
    if (min(width, height) < 100 or width * height > MAX_PIXELS
            or (alpha.get('/Width'), alpha.get('/Height')) != (width, height)
            or alpha.get('/ColorSpace') != '/DeviceGray' or alpha.get('/BitsPerComponent') != 8
            or alpha.get('/Matte') != [0, 0, 0] or '/Decode' in alpha):
        return None
    content = page.get_contents()
    if content is None or [args for args, op in content.operations if op == b'Do'] != [[name]]:
        return None
    data = alpha.get_data()
    if len(data) != width * height:
        return None
    opacity = np.frombuffer(data, np.uint8).reshape(height, width)
    if not np.any(opacity == 49):
        return None
    with Image.open(BytesIO(obj.get_data())) as jpeg:
        if jpeg.size != (width, height) or jpeg.mode != 'RGB':
            return None
        pixels = np.array(jpeg)
    # The JPEG is premultiplied against a black matte. Inspect it on white paper.
    white = (255 - opacity)[:, :, None] + np.minimum(pixels, opacity[:, :, None])
    return name, pixels, opacity, white


def word_layer(opacity, boxes):
    if len(boxes) != 3 or len({mask.shape for _, mask in boxes}) != 1:
        return None
    copies = np.stack([opacity[region] for region, _ in boxes])
    # Document ink increases opacity. The lightest impression at each registered
    # pixel supplies the stamp alone, including the antialiased letter edges.
    lightest = copies.min(axis=0)
    inside = np.logical_and.reduce([mask for _, mask in boxes])
    ink = inside & (lightest > 0)
    if not ink.any() or np.mean(lightest[ink] == 49) < .75:
        return None
    if np.mean((copies == lightest).sum(axis=0)[ink] >= 2) < .82:
        return None
    return np.where(inside & (lightest <= 90), lightest, 0).astype('uint8')


def code_layers(white, opacity, regions):
    # Two unobstructed impressions establish the exact antialiased code mask.
    clear = [opacity[r] for r in regions if np.any(opacity[r] == 28)
             and np.all((opacity[r] == 0) | (opacity[r] == 28))]
    for i, reference in enumerate(clear):
        if not any(np.array_equal(reference, other) for other in clear[i+1:]):
            continue
        glyph = reference == 28
        for region in regions:
            blue = white[region][:, :, 2]
            if blue.shape != glyph.shape:
                continue
            signal = ((blue >= 228) & (blue < 248)) | ((blue > 5) & (blue < 19))
            # Confirm registration even when the QR or seal obscures part of the code.
            if signal[glyph].mean() > .30 and signal[glyph].mean() > signal[~glyph].mean() + .18:
                yield region, reference
        return


def undo_layer(rgb, opacity, region, layer, color):
    active = layer != 0
    amount = layer[active].astype(np.float32)
    trans = 1 - amount / 255
    a = np.rint((opacity[region][active].astype(np.float32) - amount) / trans).clip(0, 255)
    value = (rgb[region][active] - amount[:, None] * np.asarray(color)) / trans[:, None]
    # The underlying paperwork is grayscale. Red/green avoid blue-channel JPEG fringing.
    gray = np.rint(value[:, :2].mean(axis=1)).clip(0, a).astype(np.uint8)
    rgb[region][active] = gray[:, None]
    opacity[region][active] = a.astype(np.uint8)


def encoded(original, data):
    stream = DecodedStreamObject()
    stream.update({k: v for k, v in original.items() if k not in ('/Filter', '/Length', '/DecodeParms')})
    stream.set_data(data.tobytes())
    return stream.flate_encode()


def clean(writer, image, boxes, layer, codes):
    name, original_rgb, original_alpha, white = image
    rgb, alpha = original_rgb.copy(), original_alpha.copy()
    # The gray identifier is printed over the purple letters.
    for region, gray in code_layers(white, original_alpha, codes):
        undo_layer(rgb, alpha, region, gray, (100/255,)*3)
    for region, _ in boxes:
        undo_layer(rgb, alpha, region, layer, (0, 0, 1))
    page = writer.pages[0]
    original = page['/Resources']['/XObject'][name]
    obj = encoded(original, rgb)
    obj[NameObject('/SMask')] = writer._add_object(encoded(original['/SMask'], alpha))
    replace_image(writer, page, name, obj)
    return int(np.count_nonzero((alpha != original_alpha) | np.any(rgb != original_rgb, axis=2)))
