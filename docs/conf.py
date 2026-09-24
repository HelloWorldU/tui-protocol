"""Build the repository's existing Markdown as one documentation site."""

from pathlib import Path
import os
import sys

sys.path.insert(0, str(Path(__file__).parent / "_ext"))

project = "TUI Protocol"
author = "TUI Protocol contributors"
copyright = "2026, TUI Protocol contributors"
extensions = ["myst_parser", "site_support"]
source_suffix = {".md": "markdown"}
root_doc = "docs/index"
include_patterns = [
    "README.md", "docs/*.md", "docs/**/*.md", "protocol/README.md", "sdk/README.md",
    "terminal/README.md", "examples/**/README.md", "prototypes/**/*.md",
]
exclude_patterns = [".git", ".tmp", "**/node_modules", "**/AGENTS.md"]
myst_heading_anchors = 6
nitpicky = True

html_theme = "furo"
html_title = "TUI Protocol"
_base_url = os.environ.get("DOCS_BASE_URL", "").rstrip("/")
html_baseurl = f"{_base_url}/" if _base_url else ""
html_static_path = ["_static"]
html_css_files = ["site.css"]
templates_path = ["_templates"]
html_additional_pages = {"index": "redirect.html"}
html_copy_source = False
html_show_sourcelink = False
html_use_index = False
html_theme_options = {
    "source_repository": "https://github.com/HelloWorldU/tui-protocol/",
    "source_branch": "main",
    "source_directory": "",
    "light_css_variables": {
        "color-brand-primary": "#2457a7", "color-brand-content": "#2457a7",
        "color-brand-visited": "#2457a7",
        "color-foreground-primary": "#273244",
    },
    "dark_css_variables": {
        "color-brand-primary": "#91baff", "color-brand-content": "#91baff",
        "color-brand-visited": "#91baff",
        "color-foreground-primary": "#dce2eb",
    },
}
