<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Website][website-shield]][website-url]
[![Sync publications][sync-publications-shield]][sync-publications-url]
[![Sync external content][sync-external-shield]][sync-external-url]
[![Last commit][last-commit-shield]][last-commit-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://www.arnaut.me">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/img/mirza-logo-white-small.png">
      <img src="assets/img/mirza-logo-black-small.png" alt="Logo" width="96" height="96">
    </picture>
  </a>

  <h3 align="center">arnaut.me</h3>

  <p align="center">
    The source of my personal website: research, publications, interactive math write-ups
    and whatever I am listening to right now.
    <br />
    <a href="https://www.arnaut.me"><strong>Visit the site »</strong></a>
    <br />
    <br />
    <a href="https://www.arnaut.me/posts/">Posts</a>
    &middot;
    <a href="https://www.arnaut.me/publications/">Publications</a>
    &middot;
    <a href="https://github.com/arunoruto/website/issues/new">Report a bug</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#running-locally">Running Locally</a></li>
      </ul>
    </li>
    <li>
      <a href="#features">Features</a>
      <ul>
        <li><a href="#synced-content">Synced Content</a></li>
        <li><a href="#interactive-figures">Interactive Figures</a></li>
        <li><a href="#now-playing">Now Playing</a></li>
      </ul>
    </li>
    <li><a href="#deployment">Deployment</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

[![Homepage of arnaut.me][product-screenshot]](https://www.arnaut.me)

A static [Hugo](https://gohugo.io/) site on the [Blowfish](https://github.com/nunocoracao/blowfish)
theme, deployed to Cloudflare Pages. A few things go beyond a stock theme:

* **Publications that maintain themselves.** A weekly job merges Google Scholar, ORCID and Crossref
  into one record, with DOIs, abstracts and a BibTeX export.
* **Interactive figures.** Math posts embed live sliders and drag-to-rotate 3D scenes through a small
  in-repo runtime. Hugo's built-in esbuild bundles them, so there's no node toolchain.
* **Now playing.** A live ListenBrainz card under my name, pushed over a WebSocket, with the current
  cover blurred behind it.
* **Reproducible tooling.** The whole toolchain comes from a Nix flake, loaded by direnv.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![Hugo][Hugo-badge]][Hugo-url]
* [![Blowfish][Blowfish-badge]][Blowfish-url]
* [![Tailwind CSS][Tailwind-badge]][Tailwind-url]
* [![three.js][Three-badge]][Three-url]
* [![ListenBrainz][ListenBrainz-badge]][ListenBrainz-url]
* [![Python][Python-badge]][Python-url] + [![uv][uv-badge]][uv-url]
* [![Nix][Nix-badge]][Nix-url]
* [![Cloudflare Pages][Cloudflare-badge]][Cloudflare-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* [Nix](https://nixos.org/download/) with [flakes](https://nixos.wiki/wiki/Flakes) enabled
* [direnv](https://direnv.net/) (optional, but it makes the toolchain appear on its own)

### Installation

1. Clone the repository
   ```sh
   git clone https://github.com/arunoruto/website.git
   cd website
   ```
2. Enter the development shell. With direnv, `cd`-ing into the repository is enough: see
   [`.envrc`](.envrc), which prefers a local checkout at `~/.config/flake` and otherwise falls back
   to `github:arunoruto/flake#website`. Without direnv:
   ```sh
   nix develop 'github:arunoruto/flake#website'
   ```
3. Initialize the Blowfish theme, a [Git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules)
   ```sh
   git-submodule-init
   ```
   Later, update it to the latest version with `git-submodule-update`.

### Running Locally

```sh
serve
```

This starts `hugo serve`, opens a browser tab and builds draft and future-dated posts, at
`http://localhost:1313/`. To reproduce a production build instead:

```sh
hugo --minify
```

> [!NOTE]
> Hugo's fast-render mode only rebuilds pages you have viewed and does not always notice new page
> resources. A `feature.png` / `background.png` dropped into an existing bundle can stay invisible
> until you restart the server or run `hugo server -D --disableFastRender`. A changed `colorScheme`
> additionally needs `--ignoreCache`, because the CSS bundle is cached on disk in `resources/_gen`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- FEATURES -->
## Features

### Synced Content

Three parts of the site are mirrored into the repository by scheduled GitHub Actions instead of
being fetched while Hugo builds. That's deliberate: the build must never depend on a third-party
API being up. Otherwise an ORCID hiccup could fail a deploy, or worse, silently blank a page.

| Source | Lands in | Workflow |
| --- | --- | --- |
| Google Scholar + ORCID + Crossref | `data/publications.json`, `data/publications.bib`, `data/scholar.json` | [`sync-publications.yml`](.github/workflows/sync-publications.yml) |
| Resume gist | `data/resume.json` | [`sync-external.yml`](.github/workflows/sync-external.yml) |
| GitHub profile README | `assets/external/github-readme.md` | [`sync-external.yml`](.github/workflows/sync-external.yml) |

Both workflows run weekly and can be triggered by hand from the Actions tab. To refresh
publications locally:

```sh
uv run scripts/sync_publications.py
```

The script declares its interpreter and dependencies inline
([PEP 723](https://peps.python.org/pep-0723/)), so `uv` provisions everything itself. It fully
regenerates its outputs, so hand edits to `data/publications.bib` won't survive a re-sync.

<details>
  <summary>How the publication sync works</summary>

The Google Scholar profile decides *which* publications appear, so curate and merge there. ORCID
records from the last 12 months are listed even before Scholar has indexed them. Scholar has no
official API and exposes no DOIs, so the profile is read through
[SerpApi](https://serpapi.com/google-scholar-author-api). Each article is then matched by title
against ORCID and Crossref for its DOI, work type, full author list and abstract.

The script needs `GOOGLE_SCHOLAR_ID` and `SERPAPI_KEY`: repository secrets in CI, a gitignored
`.env` (loaded by direnv) locally.

`data/publications.json` is the site's own platform-independent record, and the cache the next run
starts from. Each entry has its content fields plus:

* `ids`: DOI, Scholar and ORCID put-code
* `links`: every known page of the work, ready to be linked
* `sync`: the script's bookkeeping

`data/publications.bib` is a LaTeX export of the same data. Entries also get a link to their
ResearchGate page when a Google `site:` search (again through SerpApi) finds one whose URL carries
the same title.

A weekly run costs one SerpApi search, plus one per new article that neither ORCID nor Crossref
knows, plus a monthly ResearchGate re-check of each article not found there yet. That's well inside
the free tier's 250 searches.

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Interactive Figures

Math posts embed live figures (sliders, drag-to-rotate scenes) through a small in-repo runtime.
There's no node toolchain involved: Hugo's built-in esbuild bundles everything.

```md
{{< viz widget="fibonacci-sphere" wide="true" params=`{"n": 800}` >}}
Caption in **Markdown**, KaTeX allowed.
{{< /viz >}}
```

| Option | Meaning |
| --- | --- |
| `params` | JSON handed to the widget. Quote it with backticks: Hugo doesn't support single-quoted shortcode arguments. |
| `id` | Anchor id for the figure |
| `height` | `16/10`-style aspect ratio or a pixel number |
| `poster` | Page-resource image shown until the widget mounts |
| `wide` | Borrow the left gutter on large screens |
| `controls` | `below` · `right` · `none` |
| `eager` | Mount immediately instead of when scrolled into view |

Other helpers for posts:

* **Wide pages:** `wideLayout: true` in a post's front matter loosens the prose column on large
  screens (wider body, less side padding, ~90ch text). It's meant for figure-heavy posts; other
  pages are untouched.
* **Math:** add `{{< katex >}}` to the post once, then `\(…\)` inline and `$$…$$` blocks work.
  `config/_default/markup.toml` enables Goldmark passthrough so Markdown leaves the TeX alone.

<details>
  <summary>Layout and adding a widget</summary>

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

To add a widget:

1. Create `assets/js/viz/widgets/<name>.js`. It exports `mount(root, params, ctx) → { destroy?, setTheme? }`
   and ends with `register("<name>", mount)`.
2. Build controls with `buildControls(ctx.controlsEl, spec, onChange)`. For 3D, use
   `makeScene(ctx, opts)`. Colours come from `ctx.theme`, so dark mode works for free.
3. Add a section to `content/lab/viz/index.md`. `serve` builds drafts and `hugo --minify` doesn't,
   so the lab never ships.

Third-party JS is vendored under `assets/lib/<name>/` next to its `LICENSE` and a `VERSION` note,
the same way Blowfish ships KaTeX and Mermaid. `import … from "three"` stays a bare specifier: the
widget bundle marks it external and the import map in `extend-head-uncached.html` resolves it. That
way several 3D figures on one page share a single three.js download.

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Now Playing

A "now playing / last played" card fed by the public [ListenBrainz](https://listenbrainz.org) API.
Nothing happens at build time. The visitor's browser fetches the data directly: the API allows
cross-site requests (CORS) and needs no key. The shortcode's markup doubles as the no-JS fallback,
a plain link to the profile. Clicking the card opens the listening history, and the title links to
the scrobble's source.

```md
{{< listenbrainz user="arunoruto" variant="pill" background="cover" >}}
```

| Parameter | Values |
| --- | --- |
| `user` | ListenBrainz user name (default: `params.listenbrainz.user`) |
| `variant` | The layout. `card` (default): a boxed row with cover, title, artist · release. `pill`: a one-line translucent badge that centres with the text around it (used in the homepage hero). `inline`: the pill without its box, valid mid-sentence. `vinyl`: no box, the cover spins as a record while something plays. `glass`: a frosted translucent panel with the cover's colour as an ambient glow. |
| `background` | The fill of a boxed variant (`card`, `pill`, `glass`), themed by the cover with white text on top. `none` (default). `color`: a gradient of the cover's dominant colour. `solid`: that colour, flat. `cover`: the cover itself, zoomed and blurred (the Spotify look). `color` and `solid` keep the plain look until the colour has been sampled. |
| `center` | `true` caps a block variant at 28 rem and centres it |

[`content/lab/listenbrainz/`](content/lab/listenbrainz/index.md) is a draft-only page showing every
combination.

<details>
  <summary>How updates arrive</summary>

Updates come from the same Socket.IO feed that listenbrainz.org's own user page subscribes to,
spoken over a bare WebSocket with no client library. A `playing_now` or `listen` event triggers a
refetch, so a new track shows up within a second.

The feed is undocumented, so it only ever *triggers* a refetch and the HTTP API stays the source of
truth. If the socket fails, the card falls back to polling every 30 s. While the feed is up, it
still polls every 2 min as a safety net. A timer also re-checks when the live track should have
ended, using the duration the scrobbler sent.

The last result sits in `sessionStorage`, so the next page paints the known track immediately.
`data-listenbrainz-feed` on the card says `live` or `poll`.

Several cards for the same user on one page share a single source: one poll loop, one feed socket,
one cover lookup. Stacking them costs nothing extra, which matters because the API allows only 30
requests per rate-limit window per IP.

</details>

<details>
  <summary>How the cover is found</summary>

Finished listens come back with a Cover Art Archive id, but a playing-now listen has no MusicBrainz
mapping yet. When the listen ListenBrainz just recorded is the same track,
[`assets/js/listenbrainz.js`](assets/js/listenbrainz.js) reuses its cover. Otherwise it walks a
chain, most authoritative first, and stops at the first cover that loads:

1. **ListenBrainz's own matcher** (`labs.api.listenbrainz.org/acr-lookup`, public and keyless): the
   release ListenBrainz would map the listen to, plus that release group's cover via a plain
   MusicBrainz lookup.
2. **MusicBrainz search**: release group first, then every recording of that title, compilations
   last. This step exists because scrobblers invent release names for YouTube uploads.
3. **iTunes Search**, filtered to the scrobbled artist and ranked by title so karaoke covers lose.
4. **The YouTube thumbnail** of the scrobbled video, the same last resort listenbrainz.org uses.

Every MusicBrainz call goes through a gate that allows one request per second, per their
rate-limit policy. Once ListenBrainz maps the finished listen, its cover replaces the guess.
Results are cached per track, so re-polls cost nothing.

The cover's dominant colour is sampled on a canvas (the image hosts send CORS headers) into
`--listenbrainz-tint`. The boxed variants glow with it while playing, `background="color"` and
`"solid"` fill with it, and `background="cover"` shows it until the image has loaded.

Styles live in `assets/css/custom.css` under `.listenbrainz`. States are set in
`data-listenbrainz-state`: `loading`, `playing`, `idle`, `empty`, `error`.

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- DEPLOYMENT -->
## Deployment

Cloudflare Pages builds from the Git integration on every push to `main`. The build command and
`HUGO_VERSION` live in the Cloudflare dashboard, not in this repository.

Blowfish v3 needs the **extended** edition of Hugo and declares a supported window of
`0.162.0`–`0.165.0` in the theme's `config.toml`, so `HUGO_VERSION` has to stay inside it.
`config/_default/module.toml` repeats only the floor, so the build doesn't fail the day a newer
Hugo ships.

[`deploy.yml`](.github/workflows/deploy.yml) is a manual re-trigger for rebuilding without a new
commit, for example after a theme bump.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Mirza Arnaut

[![Website][website-shield]][website-url]
[![GitHub][GitHub-badge]][GitHub-url]
[![ORCID][ORCID-badge]][ORCID-url]
[![LinkedIn][LinkedIn-badge]][LinkedIn-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Blowfish](https://github.com/nunocoracao/blowfish), the theme everything sits on
* [ListenBrainz](https://listenbrainz.org), [MusicBrainz](https://musicbrainz.org) and the
  [Cover Art Archive](https://coverartarchive.org) for open music data
* [three.js](https://threejs.org) and [KaTeX](https://katex.org) for the math posts
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template), which this README
  is modelled on
* [Shields.io](https://shields.io) for the badges

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fwww.arnaut.me&style=for-the-badge&label=arnaut.me
[website-url]: https://www.arnaut.me
[sync-publications-shield]: https://img.shields.io/github/actions/workflow/status/arunoruto/website/sync-publications.yml?style=for-the-badge&label=publications
[sync-publications-url]: https://github.com/arunoruto/website/actions/workflows/sync-publications.yml
[sync-external-shield]: https://img.shields.io/github/actions/workflow/status/arunoruto/website/sync-external.yml?style=for-the-badge&label=external%20content
[sync-external-url]: https://github.com/arunoruto/website/actions/workflows/sync-external.yml
[last-commit-shield]: https://img.shields.io/github/last-commit/arunoruto/website?style=for-the-badge
[last-commit-url]: https://github.com/arunoruto/website/commits/main
[product-screenshot]: .github/assets/homepage.jpg

[Hugo-badge]: https://img.shields.io/badge/Hugo-FF4088?style=for-the-badge&logo=hugo&logoColor=white
[Hugo-url]: https://gohugo.io/
[Blowfish-badge]: https://img.shields.io/badge/Blowfish-1E293B?style=for-the-badge
[Blowfish-url]: https://blowfish.page/
[Tailwind-badge]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
[Three-badge]: https://img.shields.io/badge/three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white
[Three-url]: https://threejs.org/
[ListenBrainz-badge]: https://img.shields.io/badge/ListenBrainz-353070?style=for-the-badge&logo=musicbrainz&logoColor=white
[ListenBrainz-url]: https://listenbrainz.org/
[Python-badge]: https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white
[Python-url]: https://www.python.org/
[uv-badge]: https://img.shields.io/badge/uv-DE5FE9?style=for-the-badge&logo=uv&logoColor=white
[uv-url]: https://docs.astral.sh/uv/
[Nix-badge]: https://img.shields.io/badge/Nix-5277C3?style=for-the-badge&logo=nixos&logoColor=white
[Nix-url]: https://nixos.org/
[Cloudflare-badge]: https://img.shields.io/badge/Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflarepages&logoColor=white
[Cloudflare-url]: https://pages.cloudflare.com/

[GitHub-badge]: https://img.shields.io/badge/arunoruto-181717?style=for-the-badge&logo=github&logoColor=white
[GitHub-url]: https://github.com/arunoruto
[ORCID-badge]: https://img.shields.io/badge/0000--0002--1631--7083-A6CE39?style=for-the-badge&logo=orcid&logoColor=white
[ORCID-url]: https://orcid.org/0000-0002-1631-7083
[LinkedIn-badge]: https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge
[LinkedIn-url]: https://www.linkedin.com/in/mirza-arnaut-78589b14b/
