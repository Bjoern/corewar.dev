"""Tests for build-time discovery and parsing of option-file presets."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from option_presets import parse_options, presets, write_presets


class OptionPresetsTest(unittest.TestCase):
    def test_discovery_grouping_and_new_file(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "94.opt").write_text("; comment\n-s 8000 -p 8000\n")
            (root / "94b.opt").write_text("-p 8000 ; same settings, different order\n-s 8000\n")
            self.assertEqual(len(presets(root)), 1)
            self.assertEqual(presets(root)[0]["files"], ["94.opt", "94b.opt"])
            (root / "new-hill.opt").write_text('-s 800 -p 8 -c 8000 -r 250 -8 -= "S == 1"\n')
            added = presets(root)[1]
            self.assertEqual(added["id"], "new-hill")
            self.assertEqual(added["name"], "new-hill")
            self.assertEqual(added["values"], dict(coreSize=800,tasks=8,cycles=8000,
                                                  rounds=250,rules88=True,formula="S == 1"))
            write_presets(root, root / "presets.mjs")
            self.assertIn('"new-hill.opt"', (root / "presets.mjs").read_text())

    def test_invalid_options_fail_with_filename(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "broken.opt"
            for text in ["-x 1", "-s", "-p eight", "warrior.red"]:
                path.write_text(text)
                with self.subTest(text=text), self.assertRaisesRegex(ValueError, "broken.opt"):
                    parse_options(path)

    def test_tiny_lp_hill_spec(self):
        path = Path(__file__).resolve().parents[1] / "docs/config/tinylp.opt"
        self.assertEqual(parse_options(path), dict(coreSize=800,tasks=8,cycles=8000,
                          maxLength=50,distance=50,pspace=50,rounds=250))


if __name__ == "__main__":
    unittest.main()
