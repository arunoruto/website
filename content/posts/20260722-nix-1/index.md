---
title: "Nix Tutorial - Part 1: History of Nix"
date: 2026-07-22
draft: false
description: "Where Nix came from, what the name actually covers (a language, a package manager, and an operating system), the philosophy behind it, the 2024 governance shakeup, and where Lix and Guix fit in."
tags: ["nix"]
series: ["Nix Tutorial"]
series_order: 1
---

In [part 0]({{< ref "/posts/20251201-nix-0" >}}) I told you why I started this series. Let's start where any good story should: at the beginning.

## Where it came from

Nix started as [Eelco Dolstra](https://github.com/edolstra)'s PhD research at Utrecht University. His 2006 thesis, [_The Purely Functional Software Deployment Model_](https://edolstra.github.io/pubs/phd-thesis.pdf), asked a pretty specific question: why is installing and upgrading software on Unix systems still so fragile? Shared mutable state in places like `/usr/lib` meant installing one package could quietly break another, upgrades couldn't be cleanly rolled back, and "works on my machine" was a permanent condition rather than a bug.

His answer was to borrow an idea from functional programming and apply it to package management: build every package in isolation, and give it a unique location on disk (a hashed path under `/nix/store`) that's derived from _everything_ that went into building it. Change the compiler, a dependency, or a single build flag, and you get a different hash, hence a different, independent path. Nothing is ever overwritten in place.

That idea became the Nix package manager. Once it existed, the natural next question was: if you can manage packages this way, why not the whole operating system? That became NixOS, first described in a [2008 paper](https://edolstra.github.io/pubs/nixos-jfp-final.pdf) by Dolstra and [Andres Löh](https://github.com/kosmikus). The package collection that ships with it, [Nixpkgs](https://github.com/NixOS/nixpkgs), has since grown into one of the largest software repositories that exists, maintained entirely by volunteers on GitHub.

## What "Nix" actually covers

This is the part that trips people up, mostly because one name is used for three things at once:

- **A language** — a small, purely functional language used to describe how packages, environments, and systems should be built.
- **A package manager** — a CLI (`nix-env`, `nix-build`, or the newer unified `nix` command) that reads that language and turns it into built software in `/nix/store`. It runs on regular Linux distros and macOS, no NixOS required.
- **An operating system** — NixOS, which uses that same package manager to build and atomically switch between entire system configurations, not just individual packages.

I'm keeping this section short on purpose. Each of these three gets its own full post later in the series — this one is just about the project as a whole.

## The philosophy

A few ideas repeat throughout the whole ecosystem, and once they click, a lot of otherwise-odd design decisions make sense:

- **Declarative over imperative.** You describe the state you want, not the steps to get there. The tool figures out the steps.
- **Builds are pure functions.** A build's output depends only on its declared inputs. Nothing implicit, nothing picked up from whatever happens to be lying around on your system. Same inputs in, same output out, every time, on every machine.
- **Nothing is mutated in place.** Every build result and every system configuration is a new, independent, content-addressed path. Old ones just stick around until garbage collected, which is what makes atomic upgrades and instant rollbacks possible.
- **Multiple versions, no conflicts.** Because nothing shares a path by default, you can have three versions of the same library installed at once and every consumer just points at the exact one it was built against.

## The 2024 governance shakeup

Worth knowing about, since it shaped where the ecosystem is today. In 2024, the community went through a genuinely rocky period: disagreements over how the NixOS Foundation was governed, moderation decisions, and trust between the foundation and parts of the volunteer community, came to a head. One concrete result was that a group of contributors forked the reference C++ implementation of Nix into a new project, independently governed and outside the foundation's structure.

I'm deliberately not relitigating the details here since I only followed it at a distance. If you want to read into it yourself, a few good starting points:

- [Nix alternatives and spinoffs](https://lwn.net/Articles/981124/) — LWN's neutral technical write-up of the crisis and the projects that came out of it.
- [Open letter to the NixOS Foundation](https://lobste.rs/s/0qvtim/open_letter_nixos_foundation) — the community discussion thread where a lot of this played out in public.
- [Lix's own "Why Lix?"](https://lix.systems/about) — the fork's perspective on why it exists and how it's governed.

What matters for this series is the outcome: there are now several actively maintained implementations of Nix, and it's worth knowing what they are.

## Alternatives

- **[Lix](https://lix.systems/)** — the fork that came out of the 2024 split. It aims to be a drop-in replacement for the reference Nix implementation: same language, same store format, Nixpkgs works on it unmodified. The pitch is faster iteration, better documentation, and community governance not tied to any single company or foundation.
- **[GNU Guix](https://guix.gnu.org/)** — a separate project from the GNU project, directly inspired by Nix's research (its author cites the original Nix papers explicitly), but it makes different choices: configuration is written in [Guile Scheme](https://www.gnu.org/software/guile/) instead of a purpose-built language, and the project only distributes free software by default, following the [FSF Free System Distribution Guidelines](https://www.gnu.org/distros/free-system-distribution-guidelines.html). If having a fully free system matters to you more than access to Nixpkgs' breadth, Guix is worth a serious look.
- **[Snix](https://snix.dev/)** — the newest of the bunch and still very much a work in progress: a from-scratch Rust re-implementation of Nix's components, aiming to be Nix-compatible (same language, same Nixpkgs, same binary caches) while being modular enough to use as embeddable libraries rather than just a monolithic CLI. Not something to run in production yet, but worth keeping an eye on.

All three are proof that the core idea, purely functional, content-addressed software deployment, is bigger than any one project.

## What's next

With the big picture out of the way, the next three posts each take one of the three pieces and actually dig in:

- **Part 2** — the Nix language: syntax, structure, what overrides are, and where to find good documentation.
- **Part 3** — the CLI: old commands vs. the new unified `nix` command, and an introduction to flakes.
- **Part 4** — a proper deep dive into NixOS itself.

See you in the next one!
