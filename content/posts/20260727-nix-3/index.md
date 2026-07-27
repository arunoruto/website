---
title: "Nix Tutorial - Part 3: The CLI"
date: 2026-07-27
draft: false
description: "Two command-line interfaces exist for Nix: the classic one and the modern unified nix command. Where names like nixpkgs actually come from (channels and the flake registry), what each command looks like day to day, and a proper introduction to flakes."
tags: ["nix"]
series: ["Nix Tutorial"]
series_order: 3
---

In [part 2]({{< ref "/posts/20260725-nix-2" >}}) we covered the language itself. Now let's actually use it from the command line — this is the part where Nix starts feeling like a tool instead of a syntax lesson.

## Two CLIs, and why

Nix's command-line tools grew organically over roughly two decades: `nix-env` to manage installed packages, `nix-build` to build a derivation, `nix-shell` to drop into a build or dev environment, `nix-store` to poke at the store directly, and a handful of others, each with its own flags and its own quirks. They all still work, and you'll see them in plenty of existing docs, scripts, and older tutorials.

Since 2017, there's also a single unified `nix` command (`nix build`, `nix run`, `nix develop`, ...) designed as a coherent replacement for all of it, introduced alongside flakes. It's still officially marked "experimental" — the design is not 100% frozen yet — but in practice it's what the vast majority of the community has settled on, myself included. This series uses it going forward.

## Naming things: channels and the flake registry

Both command styles let you write a short name like `nixpkgs` instead of a full URL, but they resolve that name completely differently — and the difference is a big part of why flakes exist at all.

**Classic: channels.** `nix-env -iA nixpkgs.ripgrep` and `import <nixpkgs> { }` both resolve `nixpkgs` through channels: subscriptions registered on your machine with `nix-channel --add` and refreshed with `nix-channel --update`.

```console
$ nix-channel --list
nixpkgs https://nixos.org/channels/nixpkgs-unstable
```

This is global, mutable, per-machine state. The same name, `nixpkgs`, can point at a different actual revision depending on when you last ran `nix-channel --update`, and depending on which machine you're sitting at.

**New: the flake registry.** `nix run nixpkgs#ripgrep` resolves `nixpkgs` through the **flake registry** instead — conceptually the same idea, a short name mapped to an actual source, implemented differently.

```console
$ nix registry list
global flake:nixpkgs github:NixOS/nixpkgs
global flake:home-manager github:nix-community/home-manager
global flake:nix-darwin github:LnL7/nix-darwin
...
```

That `github:NixOS/nixpkgs` is a full flake reference — `nixpkgs#ripgrep` is shorthand for "look up `ripgrep` in the outputs of `github:NixOS/nixpkgs`". The registry has three layers, checked in order:

1. **User** — `~/.config/nix/registry.json`, yours alone.
2. **System** — `/etc/nix/registry.json`, machine-wide.
3. **Global** — fetched from [`github:NixOS/flake-registry`](https://github.com/NixOS/flake-registry), what ships with Nix by default and where entries like `nixpkgs` above come from.

Add your own entries to the user registry. Point a short name at a specific branch:

```console
$ nix registry add unstable github:NixOS/nixpkgs/nixos-unstable
$ nix run unstable#hello
```

Or point one at your own project, so you can build or run it from any directory without typing the full path:

```console
$ nix registry add my github:yourname/your-flake
$ nix build my#default
$ nix develop my#default
```

`nix registry remove <name>` undoes it, `nix registry pin <name>` freezes an entry to whatever it currently resolves to.

{{< alert icon="lightbulb" >}}
Neither channels nor a bare registry lookup are pinned. `nix run nixpkgs#hello` re-resolves `nixpkgs` fresh every time, same as a channel update can silently move `nixpkgs` out from under you. Actual reproducibility comes from a flake's own `inputs` and its `flake.lock`, covered further down. Channels and registries are naming convenience at the shell prompt; `inputs` are what you actually pin.
{{< /alert >}}

## Command comparison

You don't need to memorize this, just skim it once and come back when you need it:

| Task | Classic | New |
|---|---|---|
| Install into your profile | <span style="white-space:nowrap">`nix-env -iA nixpkgs.ripgrep`</span> | <span style="white-space:nowrap">`nix profile install nixpkgs#ripgrep`</span> |
| Try a package in a throwaway shell | <span style="white-space:nowrap">`nix-shell -p ripgrep`</span> | <span style="white-space:nowrap">`nix shell nixpkgs#ripgrep`</span> |
| Run a program without installing it | <span style="white-space:nowrap">`nix-shell -p ripgrep --run rg`</span> | <span style="white-space:nowrap">`nix run nixpkgs#ripgrep`</span> |
| Search for a package | <span style="white-space:nowrap">`nix search nixpkgs ripgrep`</span> | <span style="white-space:nowrap">`nix search nixpkgs ripgrep`</span> |
| Build something (produces `./result`) | <span style="white-space:nowrap">`nix-build`</span> | <span style="white-space:nowrap">`nix build`</span> |
| Enter a dev environment from a project | <span style="white-space:nowrap">`nix-shell`</span> | <span style="white-space:nowrap">`nix develop`</span> |
| Delete unused store paths | <span style="white-space:nowrap">`nix-collect-garbage -d`</span> | <span style="white-space:nowrap">`nix store gc`</span> |

Notice the new CLI's install/run/shell commands all take the same shape: `<flake-reference>#<attribute>` — that `nixpkgs` is exactly the registry name from the previous section. That consistency is the actual point of the redesign: the classic tools each invented their own argument conventions independently.

## Turning it on

If a `nix <subcommand>` gives you an error about experimental features, add this to `/etc/nix/nix.conf` (or `nix.settings.experimental-features` if you're already on NixOS):

```
experimental-features = nix-command flakes
```

`nix-command` unlocks the unified CLI; `flakes` unlocks what we're about to get into.

## What flakes actually solve

We already saw that channels are mutable, global, per-machine state: the same `nixpkgs` name can quietly resolve to a different revision depending on timing and machine. It works, but it reintroduces the exact "works on my machine" problem Nix exists to solve.

A flake fixes this by making every input explicit and pinned. A flake is a directory (usually a git repo) with a `flake.nix` that declares its own inputs, and it gets a `flake.lock` that pins every one of those inputs, transitively, to an exact revision and hash. No ambient state, no `NIX_PATH`, no channel subscriptions. The same flake, on any machine, evaluates against the exact same inputs.

## Anatomy of a flake.nix

```nix
{
  description = "A tiny example flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages.${system}.default = pkgs.hello;

      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.ripgrep pkgs.fd ];
      };
    };
}
```

Two parts:

- **`inputs`** — every external thing this flake depends on, each with a URL Nix knows how to fetch (a GitHub repo, a tarball, another flake, ...). Nothing here is a version range; it's resolved to one exact thing.
- **`outputs`** — a function from those inputs to an attribute set. Nothing magic about this attribute set, it's a plain Nix value like anything from part 2, except the `nix` CLI knows to look for specific conventional attribute names: `packages`, `devShells`, `nixosConfigurations`, and a few others. That's why `nix build .#default` or `nix develop` "just work" without extra flags — the CLI is just looking up a well-known path in the output attrset.

Run this once and you'll get a `flake.lock` sitting next to it, a JSON file recording the exact revision and content hash of `nixpkgs` (and anything it pulls in). Commit that file to git, same as you would `package-lock.json` or `Cargo.lock`. `nix flake update` bumps it deliberately, on your terms, rather than silently.

{{< alert icon="triangle-exclamation" >}}
The most common first-timer gotcha: flakes only see files that are tracked by git. Add a new file, forget to `git add` it, and Nix will act like it doesn't exist, no error, it's just invisible to the evaluation. If something "isn't there" and you're sure you saved it, check `git status` before anything else.
{{< /alert >}}

## Channels vs. flakes, side by side

A recap now that you've seen both naming mechanisms and `flake.lock` in action:

|                              | Channels (classic)                                                  | Flakes                                     |
| ---------------------------- | --------------------------------------------------------------------| ------------------------------------------ |
| What's pinned                | Nothing by default — resolved through `NIX_PATH` at evaluation time | Every input, exactly, via `flake.lock`     |
| Where state lives            | Global, per-machine (`nix-channel`)                                  | Local to the project, checked into git     |
| Reproducible across machines | Only if you remember to sync channels manually                      | Yes, by construction                       |
| Update mechanism             | `nix-channel --update`, implicit                                     | `nix flake update`, explicit and committed |

Channels aren't gone, and plenty of working systems still use them, but if you're starting something new today, reach for a flake.

## What's next

Part 4 goes all in on NixOS itself: system configuration, modules, and yes, `nixos-rebuild`.

See you in the next one!
