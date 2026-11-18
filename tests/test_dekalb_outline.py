"""Protect black strokes and reject unrelated gray marks on the same diagonal."""
import unittest

import numpy as np

from clearpage.presets import dekalb_outline as dekalb


class DeKalbOutlineTests(unittest.TestCase):
    def setUp(self):
        self.page = np.full((2200, 1700), 255, dtype=np.uint8)
        profile = dekalb.profile().astype(bool)
        h, w = profile.shape
        area = self.page[645:645+h, 402:402+w]
        area[profile] = 160

    def test_recognizes_outline_with_interruptions_and_preserves_dark_ink(self):
        self.page[1030:1037, 400:1300] = 0
        self.page[1041:1044, 410:1290] = 50
        expected = self.page.copy()
        expected[expected == 160] = 255
        mask = dekalb.stamp_mask(self.page)
        self.assertIsNotNone(mask)
        self.page[mask] = 255
        np.testing.assert_array_equal(expected, self.page)

    def test_rejects_other_shapes_and_pages_with_gray_print(self):
        self.assertIsNone(dekalb.stamp_mask(np.fliplr(self.page)))
        self.page[1075:1085, 830:900] = 190
        self.assertIsNone(dekalb.stamp_mask(self.page))
        self.assertIsNone(dekalb.stamp_mask(np.full_like(self.page, 255)))
