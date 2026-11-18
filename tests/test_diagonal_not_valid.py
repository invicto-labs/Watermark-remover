import unittest

import cv2
import numpy as np

from clearpage.presets import diagonal_not_valid as preset


class NotValidTests(unittest.TestCase):
    def setUp(self):
        mark = cv2.resize(preset.silhouette().astype('uint8'), (1272, 1648),
                          interpolation=cv2.INTER_NEAREST).astype(bool)
        self.paper = np.where(mark, 162, 254).astype('uint8')
        self.left = self.paper.copy()
        self.left[220:1100:8, 40:960] = 5
        self.right = self.paper.copy()
        self.right[1150:1550:6, 70:1080] = 8

    def test_removes_letters_preserves_print_and_margin(self):
        model = preset.paired_model(self.left, self.right)
        self.assertIsNotNone(model)
        result = preset.restore(self.left, model)
        self.assertTrue(np.all(result[(self.paper == 162) & (self.left == 162)] == 254))
        np.testing.assert_array_equal(result[self.left == 5], self.left[self.left == 5])
        np.testing.assert_array_equal(result[~model[0]], self.left[~model[0]])

    def test_duplicate_unmarked_and_partial_impressions_do_not_qualify(self):
        self.assertIsNone(preset.paired_model(self.left, self.left))
        self.assertIsNone(preset.paired_model(self.left, np.full_like(self.left, 254)))
        partial = self.right.copy()
        partial[850:] = 254
        self.assertIsNone(preset.paired_model(self.left, partial))
