"""Small regressions for the repository-to-website glue."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import os
import runpy
import sys
import unittest

from docutils import nodes
from sphinx import addnodes
from sphinx.errors import SphinxError

sys.path.insert(0, str(Path(__file__).parent / "_ext"))
from site_support import GROUPS, add_navigation, source_links
from check_site import check


class SiteTests(unittest.TestCase):
    def test_canonical_base_url_handles_local_project_and_custom_domain_builds(self):
        cases = (
            ("", ""),
            ("https://helloworldu.github.io/tui-protocol", "https://helloworldu.github.io/tui-protocol/"),
            ("https://tui-protocol.org/", "https://tui-protocol.org/"),
        )
        for value, expected in cases:
            with self.subTest(value=value), patch.dict(os.environ, {"DOCS_BASE_URL": value}):
                config = runpy.run_path(str(Path(__file__).parent / "conf.py"))
                self.assertEqual(config["html_baseurl"], expected)

    def test_primary_pages_appear_once_in_four_navigation_groups(self):
        paths = [path for entries in GROUPS.values() for _, path in entries]
        self.assertEqual(len(paths), len(set(paths)))
        self.assertEqual(len(GROUPS), 4)
        source = ["# Home\n"]
        add_navigation(None, "docs/index", source)
        self.assertEqual(source[0].count("```{toctree}"), 4)
        self.assertIn("# Home\n", source[0])

    def test_code_links_use_github_and_keep_their_label_and_fragment(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "sample.ts").touch()
            document = nodes.document("", "")
            ref = addnodes.download_reference("", nodes.Text("Source code"), refdoc="README", reftarget="sample.ts#L2")
            document += ref
            app = SimpleNamespace(srcdir=root, env=SimpleNamespace(doc2path=lambda _: root / "README.md"))
            source_links(app, document)
            self.assertEqual(document[0]["refuri"], "https://github.com/HelloWorldU/tui-protocol/blob/main/sample.ts#L2")
            self.assertEqual(document[0].astext(), "Source code")
            self.assertNotIsInstance(document[0], addnodes.download_reference)

    def test_missing_and_local_only_code_links_fail_instead_of_becoming_downloads(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".private").touch()
            app = SimpleNamespace(srcdir=root, env=SimpleNamespace(doc2path=lambda _: root / "README.md"))
            for path in ("missing.ts", ".private", "../outside.ts"):
                with self.subTest(path=path):
                    document = nodes.document("", "")
                    document += addnodes.download_reference("", nodes.Text("Code"), refdoc="README", reftarget=path)
                    with self.assertRaises(SphinxError):
                        source_links(app, document)

    def test_generated_link_check_accepts_anchors_and_rejects_missing_targets(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            page = root / "index.html"
            page.write_text('<h1 id="intro">Hi</h1><a href="#intro">Read</a>', encoding="utf-8")
            check(root)
            for link in ("missing.html", "#missing"):
                page.write_text(f'<a href="{link}">Read</a>', encoding="utf-8")
                with self.assertRaises(SystemExit):
                    check(root)


if __name__ == "__main__":
    unittest.main()
