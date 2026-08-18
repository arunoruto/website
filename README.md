# Arunoruto's Personal Website

This repository contains the source code for my personal website: [www.arnaut.me](https://www.arnaut.me).

The development environment comes from a [Nix flake](https://nixos.wiki/wiki/Flakes). With
[direnv](https://direnv.net/) installed, `cd`-ing into the repository puts the whole toolchain on
your `PATH` automatically — see [`.envrc`](.envrc), which prefers a local checkout at
`~/.config/flake` and otherwise falls back to `github:arunoruto/flake#website`.

Without direnv, enter the shell manually:

```sh
nix develop 'github:arunoruto/flake#website'
```

## 🥞 Tech Stack

- **Static Site Generator:** [Hugo](https://gohugo.io/)
- **Theme:** [Blowfish](https://github.com/nunocoracao/blowfish)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/)
- **Development Environment:** [Nix flake](https://nixos.wiki/wiki/Flakes) + [direnv](https://direnv.net/)

## 🚀 Getting Started

### 1. Initialize the Theme

This site uses the Blowfish theme as a [Git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules).

When first cloning the repository, initialize the submodule:

```sh
git-submodule-init
```

To update the theme to the latest version:

```sh
git-submodule-update
```

### 2. Run Locally

```sh
serve
```

This starts `hugo serve`, opens a browser tab, and builds draft and future-dated posts. The local
site is available at `http://localhost:1313/`.

To reproduce a production build instead:

```sh
hugo --minify
```

## 🔄 Synced Content

Three parts of the site are mirrored into the repository by scheduled GitHub Actions rather than
fetched while Hugo builds. This is deliberate: the build must never depend on a third-party API
being up, or an ORCID hiccup could fail a deploy — or worse, silently blank a page.

| Source | Lands in | Workflow |
| --- | --- | --- |
| ORCID + Crossref | `publications.bib`, `data/publications.json` | [`sync-publications.yml`](.github/workflows/sync-publications.yml) |
| Resume gist | `data/resume.json` | [`sync-external.yml`](.github/workflows/sync-external.yml) |
| GitHub profile README | `assets/external/github-readme.md` | [`sync-external.yml`](.github/workflows/sync-external.yml) |

Both run weekly and can be triggered manually from the Actions tab. To refresh publications
locally:

```sh
uv run scripts/sync_publications.py
```

The script declares its interpreter and dependencies inline
([PEP 723](https://peps.python.org/pep-0723/)), so `uv` provisions everything itself — nothing to
install first. Note that it fully regenerates both files; hand edits to `publications.bib` will not
survive a re-sync.

## 🎛️ Interactive figures

Math posts embed live figures (sliders, drag-to-rotate scenes) through a small in-repo runtime — no
node toolchain involved, Hugo's built-in esbuild bundles everything.

```
assets/js/viz/core/       runtime: mount.js (lifecycle), controls.js (sliders/buttons/readouts),
                          theme.js (Blowfish colours + dark mode), motion.js (frame loop, reduced
                          motion), three-scene.js (three.js boilerplate)
assets/js/viz/lib/        shared between widgets: golden.js (γ maths + dial rows),
                          sphere-points.js (placement recipes + spacing statistics),
                          point-sphere.js (three.js point cloud on a shell)
assets/js/viz/widgets/    one ES module per widget — Canvas 2D: fibonacci-spiral,
                          circle-gaps, sphere-quality; three.js: fibonacci-sphere,
                          sphere-sampling
assets/lib/three/         vendored three.js (see VERSION there; nothing is fetched from a CDN)
layouts/shortcodes/viz.html            the {{< viz >}} shortcode
layouts/partials/extend-head-uncached.html  import map for "three" + KaTeX render fallback
content/lab/viz/          draft-only playground that mounts every widget
```

Use a widget in a post:

```md
{{< viz widget="fibonacci-sphere" wide="true" params=`{"n": 800}` >}}
Caption in **Markdown**, KaTeX allowed.
{{< /viz >}}
```

Options: `params` (JSON handed to the widget), `id`, `height` (`16/10` aspect or a pixel number),
`poster` (page-resource image shown until the widget mounts), `wide` (borrow the left gutter on
large screens), `controls` (`below` | `right` | `none`), `eager` (skip lazy mounting). Quote JSON
with backticks — Hugo does not support single-quoted shortcode arguments.

Add a widget: create `assets/js/viz/widgets/<name>.js` exporting
`mount(root, params, ctx) → { destroy?, setTheme? }` and ending with `register("<name>", mount)`;
build controls with `buildControls(ctx.controlsEl, spec, onChange)`; for 3D use
`makeScene(ctx, opts)`. Colours come from `ctx.theme` so dark mode works for free. Then add a
section to `content/lab/viz/index.md` — `serve` builds drafts, `hugo --minify` does not, so the lab
never ships.

Third-party JS is vendored under `assets/lib/<name>/` next to its `LICENSE` and a `VERSION` note,
mirroring how Blowfish ships KaTeX and Mermaid. `import … from "three"` stays a bare specifier: the
widget bundle marks it external and the import map in `extend-head-uncached.html` resolves it, so
several 3D figures on one page share a single three.js download.

Wide pages: `wideLayout: true` in a post's front matter loosens the prose column on large screens
(wider body, less side padding, ~90ch text) — for figure-heavy posts; other pages are untouched.

Math: drop `{{< katex >}}` into the post once; `\(…\)` inline and `$$…$$` blocks work
(`config/_default/markup.toml` enables Goldmark passthrough so Markdown leaves the TeX alone).

## 🚢 Deployment

Cloudflare Pages builds from the Git integration on every push to `main`; the build command and
`HUGO_VERSION` live in the Cloudflare dashboard, not in this repository. Blowfish v3 needs the
**extended** edition and declares a supported window of `0.162.0`–`0.165.0` in the theme's
`config.toml`, so `HUGO_VERSION` has to stay inside it — `config/_default/module.toml` repeats only
the floor, to avoid failing the build the day a newer Hugo ships.
[`deploy.yml`](.github/workflows/deploy.yml) is a manual re-trigger for rebuilding without a new
commit, e.g. after a theme bump.
