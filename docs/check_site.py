"""Check generated local links and anchors without a browser or network calls."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = set()
        self.links = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        for name in ("href", "src"):
            if attrs.get(name):
                self.links.append(attrs[name])


def check(root):
    root = root.resolve()
    if not (root / "index.html").is_file():
        raise SystemExit("Documentation output is missing; run pnpm docs:build first.")
    pages = {path: Page(path.read_text(encoding="utf-8")) for path in root.rglob("*.html")}
    failures = []
    checked = 0
    for path, page in pages.items():
        for link in page.links:
            url = urlsplit(link)
            if url.scheme or url.netloc:
                continue
            target = (root / unquote(url.path).lstrip("/") if url.path.startswith("/")
                      else path.parent / unquote(url.path) if url.path else path).resolve()
            if target.is_dir():
                target /= "index.html"
            checked += 1
            if not target.is_relative_to(root) or not target.is_file():
                failures.append(f"{path.relative_to(root)}: missing {link}")
            elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
                failures.append(f"{path.relative_to(root)}: missing anchor {link}")
    for path in pages:
        if path.name == "AGENTS.html" or "node_modules" in path.parts:
            failures.append(f"Non-documentation output: {path}")
    print(f"Checked {len(pages)} HTML pages and {checked} local links/assets.")
    if failures:
        raise SystemExit("\n".join(failures))


if __name__ == "__main__":
    check(Path(__file__).resolve().parents[1] / ".tmp/docs-site")
