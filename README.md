# Arunoruto's Personal Website

This repository contains the source code for my personal website: [www.arnaut.me](https://www.arnaut.me).

This project uses [devenv](https://devenv.sh/) to manage the development environment. Ensure it is installed and hooked into the shell (e.g., with `direnv`).

## 🥞 Tech Stack

- **Static Site Generator:** [Hugo](https://gohugo.io/)
- **Theme:** [Blowfish](https://github.com/nunocoracao/blowfish)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/)
- **Development Environment:** [devenv](https://devenv.sh/)

## 🚀 Getting Started

### 1. Initialize the Theme

This site uses the Blowfish theme as a [Git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules).

When first cloning the repository, initialize the submodule using the defined `devenv` task:

```sh
devenv task git:submoduleInit
```

To update the theme to the latest version, run:

```sh
devenv task git:submoduleUpdate
```

### 2. Run Locally

The development environment defines a process for running the Hugo server. To start it, simply run:

```sh
devenv up
```

This command will start the `hugo serve` process, automatically open a new browser tab, and build any draft or future-dated posts. The local site will be available at `http://localhost:1313/`.
