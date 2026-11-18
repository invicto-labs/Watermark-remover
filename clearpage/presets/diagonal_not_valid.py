"""Recover the gray NOT VALID background from two independently printed scans."""
from functools import lru_cache

import cv2
import numpy as np
import pikepdf
from PIL import Image

from clearpage.paths import RESOURCE_ROOT
from clearpage.presets import native_scan_profile as native

METHODS = ('diagonal_not_valid',)
CACHE = 'diagonal-not-valid-v1'


@lru_cache(maxsize=1)
def silhouette():
    with Image.open(RESOURCE_ROOT / 'static/type-not-valid.webp') as image:
        return np.asarray(image.convert('L')) < 214


def matches_shape(mask):
    expected = silhouette()
    observed = cv2.resize(mask.astype('float32'), expected.shape[::-1],
                          interpolation=cv2.INTER_AREA) > .42
    # Check the top, middle and bottom of the phrase independently. Text or
    # a gray rule elsewhere on the scan must not stand in for missing letters.
    for mark, sample in zip(np.array_split(expected, 4), np.array_split(observed, 4)):
        if np.count_nonzero(sample & mark) < .60 * np.count_nonzero(mark | sample):
            return False
    return True


def scan_entry(page):
    return native.image_entry(page, 8, {'/DeviceRGB', '/DeviceGray'}, {'/DCTDecode'},
                              lambda w, h: 600 <= w <= 2600 and .72 <= w/h <= .81)


def matched_scan(entry):
    with pikepdf.PdfImage(entry[1]).as_pil_image() as image:
        pixels = np.asarray(image)
        if pixels.ndim == 3:
            gray = pixels[:, :, 0]
            if any(not np.array_equal(gray, pixels[:, :, c]) for c in (1, 2)):
                return None
        else:
            gray = pixels
        if matches_shape(cv2.inRange(gray, 151, 174) != 0):
            return np.ascontiguousarray(gray)
    return None


def kernel(size, scale, ellipse=True):
    side = max(3, 2 * round((size - 1) * scale / 2) + 1)
    shape = cv2.MORPH_ELLIPSE if ellipse else cv2.MORPH_RECT
    return cv2.getStructuringElement(shape, (side, side))


def paired_model(scan, peer):
    height, width = np.minimum(scan.shape, peer.shape)
    left, right = scan[:height, :width], peer[:height, :width]
    # Duplicate scans cannot independently distinguish document ink.
    thumbnails = [cv2.resize(p, (96, 128), interpolation=cv2.INTER_AREA) for p in (left, right)]
    if cv2.absdiff(*thumbnails).mean() < 1:
        return None
    scale = width / 1271
    shared = np.maximum(left, right)
    seed = cv2.morphologyEx(cv2.inRange(shared, 151, 174), cv2.MORPH_CLOSE,
                            kernel(5, scale, ellipse=False))
    _, labels, stats, _ = cv2.connectedComponentsWithStats(seed, connectivity=8)
    letters = stats[:, cv2.CC_STAT_AREA] > 4000 * scale**2
    letters[0] = False
    if np.count_nonzero(letters) != 8 or not matches_shape(letters[labels]):
        return None
    core = letters[labels].astype('uint8')
    region = cv2.dilate(core, kernel(17, scale)).astype(bool)
    background = np.where(region, np.clip(shared, 162, 254), 254).astype('uint8')
    background[cv2.erode(core, kernel(5, scale)) != 0] = 162
    return region, background


def find_match(doc, index, cancelled):
    entry = scan_entry(doc.pages[index])
    scan = matched_scan(entry) if entry else None
    if scan is None:
        return None
    # A recording page and its exhibit often have a few extra margin pixels.
    # Pair only pages sampled on the same grid, starting with nearby pages.
    tolerance = max(3, round(scan.shape[1] * .005))
    for other in sorted(range(len(doc.pages)), key=lambda n: abs(n-index)):
        if cancelled():
            raise InterruptedError('Cancelled')
        if other == index:
            continue
        partner = scan_entry(doc.pages[other])
        if partner is None:
            continue
        obj = partner[1]
        if max(abs(int(obj.Height)-scan.shape[0]), abs(int(obj.Width)-scan.shape[1])) > tolerance:
            continue
        peer = matched_scan(partner)
        if peer is not None:
            model = paired_model(scan, peer)
            if model is not None:
                return entry[0], scan, model
    return None


def suggested(source, index):
    with pikepdf.open(source) as doc:
        return find_match(doc, index, lambda: False) is not None


def restore(scan, model):
    region, background = model
    height, width = region.shape
    gray = scan[:height, :width]
    values = np.minimum(gray, 254)
    ink = (gray.astype('int16') + 20 < background) & (gray < 144) & region
    near_ink = cv2.dilate(ink.astype('uint8'), kernel(7, width / 1271)) != 0
    transmission = np.where(near_ink, background, values)
    result = scan.copy()
    corrected = values[region].astype('float32') * 254 / np.maximum(transmission[region], 1)
    result[:height, :width][region] = np.rint(np.clip(corrected, 0, 254)).astype('uint8')
    result[scan <= 12] = scan[scan <= 12]
    return result


def process(doc, index, directory, cancelled):
    match = find_match(doc, index, cancelled)
    if match is None:
        return None
    name, scan, model = match
    result = restore(scan, model)
    return name, result, 8, int(np.count_nonzero(result != scan))


def prepare(source, index, directory, cancelled=lambda: False):
    return native.prepare(source, index, directory, CACHE, process, cancelled)


def write_clean(source, target, keep, directory, cancelled=lambda: False):
    native.export_cached(source, target, keep, directory, CACHE, cancelled)
