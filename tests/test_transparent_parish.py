"""Recording covers can encode the same purple word in a partly transparent JPEG."""
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
import zlib

import numpy as np
import pikepdf as pk

from clearpage.presets import union_parish as parish
from tests.test_county_exports import scan_pdf


class TransparentParishTests(unittest.TestCase):
    def test_clear_stamp_opacity_and_keep_text_crossing_it(self):
        word = parish.word_shape().astype(bool)
        h, w = word.shape
        alpha = np.zeros((1000, 750), np.uint8)
        pixels = np.zeros((*alpha.shape, 3), np.uint8)
        for center in (63, 503, 942):
            region = np.s_[center-h//2:center-h//2+h, (750-w)//2:(750-w)//2+w]
            alpha[region][word] = 49
            pixels[region][word] = (0, 0, 49)
        # A black stroke with partially opaque edges underneath the middle stamp.
        ink = np.zeros_like(alpha)
        ink[500:505, 180:570] = 255
        ink[499, 180:570] = 128
        alpha = np.rint(alpha + (1 - alpha/255) * ink).astype(np.uint8)
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'cover.pdf'
            with pk.open(BytesIO(scan_pdf([pixels], jpeg=True))) as doc:
                smask = doc.make_stream(zlib.compress(alpha.tobytes()))
                smask.update(pk.Dictionary(Type=pk.Name.XObject, Subtype=pk.Name.Image,
                             ColorSpace=pk.Name.DeviceGray, Width=750, Height=1000,
                             BitsPerComponent=8, Filter=pk.Name.FlateDecode, Matte=[0, 0, 0]))
                doc.pages[0].Resources.XObject.Scan.SMask = smask
                doc.save(source)
            target, details = parish.prepare(source, 0, folder)
            self.assertTrue(details['matched'])
            with pk.open(target) as cleaned:
                recovered = np.frombuffer(cleaned.pages[0].Resources.XObject.Scan.SMask.read_bytes(),
                                          dtype=np.uint8).reshape(alpha.shape)
                np.testing.assert_allclose(recovered, ink, atol=1)
