"""DeKalb County's light-gray, outlined Unofficial stamp on bilevel-content scans."""
from functools import lru_cache

import cv2
import numpy as np
import pikepdf
from PIL import Image

from clearpage.paths import RESOURCE_ROOT
from clearpage.presets import native_scan_profile as native

METHODS = ('dekalb_outline',)
CACHE = 'dekalb-outline-v1'


@lru_cache(maxsize=1)
def profile():
    with Image.open(RESOURCE_ROOT/'assets/dekalb-outline.png') as image:
        return (~np.asarray(image.convert('1'), dtype=bool)).astype('uint8')


def stamp_mask(scan):
    height, width = scan.shape
    gray = ((scan >= 127) & (scan < 255)).astype('uint8')
    x, y, w, h = cv2.boundingRect(gray)
    if not (.50 * width < w < .56 * width and .39 * height < h < .43 * height
            and .22 * width < x < .26 * width and .27 * height < y < .32 * height):
        return None
    crop = gray[y:y+h, x:x+w]
    template = cv2.resize(profile(), (w, h), interpolation=cv2.INTER_NEAREST)
    # Scaling and black strokes interrupt the outline. Allow small registration
    # errors, but require the gray ink to trace the complete expected word.
    kernel = np.ones((9, 9), 'uint8')
    outline = cv2.dilate(template, kernel)
    if np.any(crop > outline) or cv2.dilate(crop, kernel)[template != 0].mean() < .97:
        return None
    return gray.astype(bool)


def detect(page):
    found = native.image_entry(page, 8, {'/DeviceGray'},
                               {'/LZWDecode', '/RunLengthDecode', '/FlateDecode'},
                               lambda w, h: 1500 <= w <= 2800 and 1900 <= h <= 3600)
    if found is None:
        return None
    name, obj = found
    scan = np.array(pikepdf.PdfImage(obj).as_pil_image())
    mask = stamp_mask(scan)
    return None if mask is None else (name, scan, mask)


def suggested(source, index):
    with pikepdf.open(source) as doc:
        return detect(doc.pages[index]) is not None


def process(doc, index, directory, cancelled):
    found = detect(doc.pages[index])
    if found is None:
        return None
    name, scan, mask = found
    scan[mask] = 255
    return name, scan, 8, int(mask.sum())


def prepare(source, index, directory, cancelled=lambda: False):
    return native.prepare(source, index, directory, CACHE, process, cancelled)


def write_clean(source, target, keep, directory, cancelled=lambda: False):
    native.export_cached(source, target, keep, directory, CACHE, cancelled)
