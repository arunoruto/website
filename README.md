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

## 🚢 Deployment

Cloudflare Pages builds from the Git integration on every push to `main`; the build command and
`HUGO_VERSION` live in the Cloudflare dashboard, not in this repository. Blowfish v3 needs the
**extended** edition and declares a supported window of `0.162.0`–`0.165.0` in the theme's
`config.toml`, so `HUGO_VERSION` has to stay inside it — `config/_default/module.toml` repeats only
the floor, to avoid failing the build the day a newer Hugo ships.
[`deploy.yml`](.github/workflows/deploy.yml) is a manual re-trigger for rebuilding without a new
commit, e.g. after a theme bump.
