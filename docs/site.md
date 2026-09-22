# Building the Documentation Website

The website renders the repository's Markdown with Sphinx, MyST, and Furo.
Edit each document in its existing directory; both GitHub and the website use
that source. Website navigation is configured in `_ext/site_support.py`.

## Tooling Layout

Sphinx configuration and presentation assets stay with the documentation;
executable build and validation tools live under `scripts/docs/`.

```text
docs/
  conf.py              Sphinx configuration
  requirements.txt     Documentation dependencies
  _ext/                Sphinx extensions
  _static/             Styles and fonts
  _templates/          Page templates
scripts/docs/
  run.mjs              Build, check, and local preview commands
  check_site.py        Generated HTML link and anchor checks
  test_site.py         Documentation tooling tests
.github/workflows/
  docs.yml             CI checks and GitHub Pages deployment
```

## Local Setup

Use Python 3.12 or newer. From the repository root on Windows:

```powershell
python -m venv .tmp/docs-venv
.tmp/docs-venv/Scripts/python.exe -m pip install -r docs/requirements.txt
pnpm docs:build
pnpm docs:check
pnpm docs:serve
```

On macOS/Linux, the environment's Python is `.tmp/docs-venv/bin/python`.
Open `http://127.0.0.1:4179/`. Stop the preview with Ctrl+C. After editing a
document, rebuild and refresh the page.

## Build and Check

`pnpm docs:build` runs Sphinx with warnings treated as errors, including unresolved
document references. Each build replaces the generated `.tmp/docs-site/` output.
Generated HTML and intermediate files stay under `.tmp/`.
Only public documentation is included; agent instructions and local scratch
files are excluded. Source-code links lead to the corresponding GitHub files.

`pnpm docs:check` checks navigation/source-link helpers and then verifies local
links, assets, and heading anchors in the built HTML. It does not contact external
websites or exercise the browser's search and theme controls.

`docs/requirements.txt` pins the documentation tools separately from the
TypeScript runtime.

## Publishing with GitHub Pages

The [Documentation workflow](https://github.com/HelloWorldU/tui-protocol/blob/main/.github/workflows/docs.yml) builds and checks
the site on pull requests and pushes to `main`. Only successful builds on
`main` are deployed. It can also be run manually from the Actions tab.
The workflow installs the documentation tools without the application's
TypeScript dependencies and uploads only `.tmp/docs-site/`.

In the repository's **Settings > Pages**, set **Source** to **GitHub Actions**
before the first publishing run. The workflow reads the site's configured URL
from Pages and passes it as `DOCS_BASE_URL` for canonical page links. With no
custom domain, Pages uses `https://helloworldu.github.io/tui-protocol/`.
Local builds leave canonical links unset unless `DOCS_BASE_URL` is supplied.

### Connecting tui-protocol.org

1. Confirm that the registrar lists the domain as registered in your account.
2. In your GitHub account's **Settings > Pages**, add and verify
   `tui-protocol.org`. Add the TXT record GitHub provides at your DNS provider,
   complete verification, and keep that record.
3. In the repository's **Settings > Pages**, save `tui-protocol.org` as the
   **Custom domain** before pointing traffic to GitHub.
4. At your DNS provider, add the following records. If using Cloudflare, start
   with **DNS only** (the grey cloud) for these records and use automatic TTL.
   Replace conflicting website records for `@` or `www`; keep unrelated TXT
   and mail records.

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `helloworldu.github.io` |

5. Once GitHub's DNS check and certificate provisioning finish, enable
   **Enforce HTTPS**. DNS propagation and certificate availability can take
   up to 24 hours. Run the Documentation workflow on `main` again after
   changing the domain so canonical links use the new address.
6. Check the root page, an inner document, search, and the `www` redirect at
   the public HTTPS address.

GitHub manages HTTPS and redirects `www` to the configured apex domain.
Actions-based publishing uses the repository's Pages settings, so it does not
need a `CNAME` file in the source tree.

References: [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[domain verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages),
and [custom domain configuration](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
