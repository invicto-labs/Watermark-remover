"""Release gates must reject mismatched versions before any build or upload."""
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
from scripts import release


class ReleaseVersionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root/'static').mkdir()
        (self.root/'static/index.html').write_text('ClearPage 1.9\nClearPage 1.9', encoding='utf-8')
        (self.root/'app.py').write_text("download_name='sample_ClearPage-1.9.pdf'", encoding='utf-8')
        (self.root/'README.md').write_text('# ClearPage 1.9\n', encoding='utf-8')
        self.addCleanup(self.tmp.cleanup)
        self.root_patch = patch.object(release, 'ROOT', self.root)
        self.root_patch.start();self.addCleanup(self.root_patch.stop)

    def test_matching_release_and_manual_build(self):
        for tag in ('v1.9', ''):
            with patch.dict(os.environ, RELEASE_TAG=tag):
                self.assertEqual(release.version(), '1.9')

    def test_wrong_or_unsafe_tag_cannot_publish(self):
        for tag in ('v1.10', '1.9', '../../bad', 'v1.9; echo invalid'):
            with patch.dict(os.environ, RELEASE_TAG=tag), self.assertRaises(ValueError):
                release.version()

    def test_inconsistent_title_and_footer_rejected(self):
        (self.root/'static/index.html').write_text('ClearPage 1.9\nClearPage 1.8', encoding='utf-8')
        with patch.dict(os.environ, RELEASE_TAG=''), self.assertRaises(ValueError):
            release.version()

    def test_old_export_name_rejected(self):
        (self.root/'app.py').write_text("download_name='sample_ClearPage-1.8.pdf'", encoding='utf-8')
        with patch.dict(os.environ, RELEASE_TAG=''), self.assertRaises(ValueError):
            release.version()

    def test_old_readme_rejected(self):
        (self.root/'README.md').write_text('# ClearPage 1.8\n', encoding='utf-8')
        with patch.dict(os.environ, RELEASE_TAG=''), self.assertRaises(ValueError):
            release.version()


if __name__ == '__main__':
    unittest.main()
