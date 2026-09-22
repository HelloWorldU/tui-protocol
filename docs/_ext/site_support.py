"""Supply website navigation without changing GitHub-readable Markdown."""

from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from docutils import nodes
from sphinx import addnodes
from sphinx.errors import SphinxError

GROUPS = {
    "Get started": [
        ("Project overview", "README"),
        ("Run an example", "examples/multi-round/README"),
        ("Pi coding trial", "prototypes/integration/pi-session/coding/README"),
    ],
    "Protocol": [
        ("Core model and goals", "docs/rfcs/0001-mutable-terminal-history-and-reading-anchors"),
        ("Contexts", "docs/protocol/contexts"),
        ("Operations", "docs/protocol/operations"),
        ("Capabilities", "docs/protocol/capabilities"),
        ("Content representation", "docs/protocol/content-representation"),
        ("Plain text", "docs/protocol/plain-text"),
        ("Terminal-native behavior", "docs/protocol/terminal-native-behavior"),
        ("Wire requirements", "docs/protocol/wire-requirements"),
        ("Message model", "docs/protocol/wire-format"),
        ("Message schemas", "docs/protocol/message-schemas"),
        ("Error codes", "docs/protocol/error-codes"),
        ("JSON serialization", "docs/protocol/serialization"),
        ("OSC framing", "docs/protocol/framing"),
    ],
    "Implementation & examples": [
        ("Protocol library", "protocol/README"),
        ("TUI SDK", "sdk/README"),
        ("Terminal execution", "terminal/README"),
        ("Streaming text", "examples/streaming-text/README"),
        ("Terminal host", "examples/terminal-host/README"),
    ],
    "Design & experiments": [
        ("RFC process", "docs/rfcs/README"),
        ("Prior art", "docs/prior-art"),
        ("Validation plan", "docs/design/next-stage-validation"),
        ("Complete documentation index", "docs/README"),
        ("Build this website", "docs/site"),
    ],
}


def toctree(entries, caption=None):
    options = ":hidden:\n:maxdepth: 1\n"
    if caption:
        options += f":caption: {caption}\n"
    links = "\n".join(f"{title} </{path}>" for title, path in entries)
    return f"\n\n```{{toctree}}\n{options}\n{links}\n```\n"


def add_navigation(app, docname, source):
    if docname == "docs/index":
        source[0] += "".join(toctree(entries, name) for name, entries in GROUPS.items())
    elif docname == "docs/README":
        primary = {path for entries in GROUPS.values() for _, path in entries}
        remaining = sorted(app.env.found_docs - primary - {"docs/index"})
        entries = []
        for path in remaining:
            content = Path(app.env.doc2path(path)).read_text(encoding="utf-8")
            title = next(line[2:].strip() for line in content.splitlines() if line.startswith("# "))
            entries.append((title, path))
        source[0] += toctree(entries)


def source_links(app, doctree):
    """Link code on GitHub instead of bundling downloads into the website."""
    root = Path(app.srcdir).resolve()
    for node in list(doctree.findall(addnodes.download_reference)):
        target = urlsplit(node["reftarget"])
        document = Path(app.env.doc2path(node["refdoc"]))
        path = (document.parent / unquote(target.path)).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise SphinxError(f"Invalid source link in {node['refdoc']}: {node['reftarget']}")
        relative = path.relative_to(root)
        if any(part.startswith(".") or part == "node_modules" for part in relative.parts):
            raise SphinxError(f"Local-only source link: {relative}")
        url = "https://github.com/HelloWorldU/tui-protocol/blob/main/" + quote(relative.as_posix())
        if target.fragment:
            url += "#" + target.fragment
        node.replace_self(nodes.reference("", "", *node.children, refuri=url))


def setup(app):
    app.connect("source-read", add_navigation)
    app.connect("doctree-read", source_links, priority=100)
    return {"version": "1", "parallel_read_safe": True, "parallel_write_safe": True}
