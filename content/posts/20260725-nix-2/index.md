---
title: "Nix Tutorial - Part 2: The Language"
date: 2026-07-25
draft: false
description: "A tour of the Nix language: values, attribute sets, functions, laziness, defining your first derivation, and the override pattern that makes Nixpkgs so customizable — plus where to look things up once this post isn't enough."
tags: ["nix"]
series: ["Nix Tutorial"]
series_order: 2
---

In [part 1]({{< ref "/posts/20260722-nix-1" >}}) we covered where Nix came from and what the name covers. This time we get our hands on the actual language: the small, purely functional core that everything else, the package manager, Nixpkgs, NixOS, is built out of.

Open a terminal and start `nix repl` — every example below is meant to be typed in and poked at, not just read.

## Basic values

Nothing surprising here, mostly:

```nix
42          # integer
3.14        # float
"a string"  # string
true        # boolean
null        # null
[ 1 2 3 ]   # list — note: no commas between elements!
```

The one genuinely unusual entry is **paths**. Anything starting with `./` or `/` is parsed as its own type, not a string, and Nix checks at parse time that it actually resolves relative to the file it's written in:

```nix
./some-file.txt
```

This matters more than it looks: because a path is a distinct type, Nix can track "this expression depends on this file" automatically, which is part of how reproducible builds work under the hood.

## Attribute sets

Attribute sets (`attrsets`) are Nix's dictionaries — the thing you'll spend most of your time reading and writing. Keys and values are separated by `=`, entries by `;`:

```nix
{
  name = "ripgrep";
  version = "14.1.0";
  supportsWindows = true;
}
```

Access a field with a dot:

```nix
{ name = "ripgrep"; }.name
# => "ripgrep"
```

Nested sets work exactly how you'd expect, and there's a shorthand for writing them: `a.b.c = 1;` is the same as `a = { b = { c = 1; }; };`.

There's a wrinkle worth knowing early: a plain attribute set can't refer to its own fields while defining them.

```nix
{
  x = 1;
  y = x + 1;  # error! `x` isn't in scope here
}
```

Prefix it with `rec` to allow that:

```nix
rec {
  x = 1;
  y = x + 1;
}
# => { x = 1; y = 2; }
```

You'll see `rec` constantly in real Nixpkgs code. It's convenient, but it also means you can accidentally create a variable shadowing chain that's hard to follow — use it when you need it, not by default.

## `let ... in`

Local bindings, scoped to a single expression:

```nix
let
  x = 1;
  y = 2;
in
x + y
# => 3
```

Unlike a plain attribute set, everything inside a `let` block can see everything else in it — no `rec` needed.

## Functions

This is the part that trips up people coming from most other languages: **every Nix function takes exactly one argument.** No exceptions.

```nix
x: x + 1
```

Call it by putting the argument right next to it — no parentheses, no comma:

```nix
(x: x + 1) 41
# => 42
```

So how does anything take "multiple arguments"? By currying — a function returning a function:

```nix
x: y: x + y
```

```nix
(x: y: x + y) 1 2
# => 3
```

That second line is really `((x: y: x + y) 1) 2`: call it with `1`, get back a function waiting for `y`, call that with `2`.

In practice though, you'll rarely see chained arguments like that in real code. Instead, Nixpkgs conventions favor a single attribute-set argument, destructured right in the function head — this is what almost every package definition looks like:

```nix
{ name, version }: "${name}-${version}"
```

```nix
( { name, version }: "${name}-${version}" ) { name = "ripgrep"; version = "14.1.0"; }
# => "ripgrep-14.1.0"
```

Two extras worth knowing on that pattern:

- **Default values**, so callers can omit a field: `{ name, version, static ? false }: ...`
- **`...`**, which allows extra attributes to be passed without erroring: `{ name, version, ... }: ...`. Without it, passing an attrset with any field the function doesn't destructure is a hard error. You'll see `...` constantly in Nixpkgs precisely because callers pass a lot more than any one function actually uses.

## `with` and `inherit`

**`with`** brings every attribute of a set into scope, so you don't have to repeat a prefix:

```nix
with { a = 1; b = 2; };
a + b
# => 3
```

Handy for cutting down on repetition (`with pkgs; [ ripgrep fd bat ]` instead of `[ pkgs.ripgrep pkgs.fd pkgs.bat ]`), but it's also the one language feature most style guides tell you to use sparingly: because the names it introduces aren't listed anywhere, it's easy to lose track of where a bare identifier actually came from, especially if you nest multiple `with`s.

**`inherit`** does the opposite job: it copies a name from the surrounding scope into an attribute set, so you don't have to write `x = x;`:

```nix
let
  x = 1;
  y = 2;
in
{
  inherit x y;
  z = 3;
}
# => { x = 1; y = 2; z = 3; }
```

It also works with an explicit source: `inherit (pkgs) ripgrep fd;` pulls just those two names out of `pkgs` without a `with`.

## Strings, interpolation, and context

Double-quoted strings support `${ ... }` interpolation, same idea as JavaScript template literals:

```nix
let name = "world"; in "hello, ${name}!"
```

For anything multi-line, use `''...''` instead of fighting with escaped newlines and quotes — this is what you'll see in every `configuration.nix` for shell scripts or config file contents:

```nix
''
  echo "building now"
  make install
''
```

Here's the detail that actually matters once you start writing real derivations: strings can carry **context**. If you interpolate a derivation into a string, Nix doesn't just paste in a path, it also records that the resulting string _depends on that derivation being built first_:

```nix
"${pkgs.hello}/bin/hello"
# => "/nix/store/xxxxxxx-hello-2.12.1/bin/hello"
```

That string isn't just text. Nix remembers it references the `hello` derivation, so anything built from a string like this will correctly pull in `hello` as a build-time dependency. This is a big part of how Nix expressions end up wiring together a correct dependency graph almost by accident, just from writing normal string interpolation.

## Laziness

Nix is lazily evaluated: an expression isn't computed until something actually demands its value. This means you can write bindings that would error if evaluated, as long as nothing ever forces them:

```nix
let
  x = 1;
  y = builtins.throw "boom";
in
x
# => 1, no error — `y` is simply never touched
```

It also means attribute sets and lists can contain infinite or mutually self-referential structures without immediately blowing up, and that large configurations, like a full NixOS system, don't waste time evaluating options nobody asked about. The main practical consequence for you: if something fails with a confusing error, it's often worth asking _what actually forced this value_, since the failure point and the "wrong" line aren't always the same line.

## `import`

`import` takes a path to a `.nix` file and evaluates it as an expression, exactly as if you'd pasted its contents in:

```nix
import ./config.nix
```

If the path is a directory, Nix looks for `default.nix` inside it. This one convention is the backbone of how Nixpkgs is organized: `pkgs = import <nixpkgs> { }` imports the top-level `default.nix`, which is a giant function that, once called, returns an attribute set of every package, each of which is itself the result of importing and calling another file. It's `import` and function calls, all the way down.

## Defining a package: your first derivation

Everything so far has been plain language features. Now let's build something, because a "package" in Nix is really just a value produced by calling a function — and once that clicks, overrides stop being magic.

At the very bottom, there's a builtin called `derivation` that takes an attribute set and produces a derivation: a recipe describing a build, plus the store path its output will live at once built. Nobody writes this directly in practice, but seeing it once demystifies everything built on top of it:

```nix
derivation {
  name = "hello";
  system = builtins.currentSystem;
  builder = "${pkgs.bash}/bin/bash";
  args = [ "-c" "echo hi > $out" ];
}
```

That's the raw primitive: a name, which system it's built for, a program to run, and arguments for it. Everything a build phase does, unpacking a tarball, running `./configure`, running `make install`, is just shell commands executed by a builder like this one, wrapped in far more convenience than you'd want to write by hand.

That convenience is `stdenv.mkDerivation`, the function almost every package in Nixpkgs is actually built with. It wraps `derivation` with a standard set of build phases (`unpackPhase`, `configurePhase`, `buildPhase`, `installPhase`, ...) that already know how to build an ordinary autotools or CMake project without you writing a single shell command. A real, complete package definition can be this short:

```nix
{ lib, stdenv, fetchurl }:

stdenv.mkDerivation (finalAttrs: {
  pname = "hello";
  version = "2.12.1";

  src = fetchurl {
    url = "mirror://gnu/hello/hello-${finalAttrs.version}.tar.gz";
    hash = "sha256-jZkUKv2SV28wsM18tCqNxoCZmLxdYH2Idh9RLibH2yA=";
  };

  meta = {
    description = "Program that produces a familiar, friendly greeting";
    homepage = "https://www.gnu.org/software/hello/";
    license = lib.licenses.gpl3Plus;
  };
})
```

Walk through what happens when this builds: `fetchurl` downloads the tarball and checks it against `hash` (more on why that matters in a second), `mkDerivation`'s default `unpackPhase` extracts it, the default `configurePhase` runs `./configure`, the default `buildPhase` runs `make`, and the default `installPhase` runs `make install DESTDIR=$out`. We didn't write any of that. We only supplied the three things that are actually specific to _this_ package: what it's called, where to get it, and how to describe it.

Notice the whole file is just a function, `{ lib, stdenv, fetchurl }: ...`, taking its dependencies as arguments rather than reaching out for global state. That's not a style choice, it's what makes the "same input, same output" guarantee from earlier actually hold, and it's exactly the function-plus-arguments shape that `override` hooks into.

A few do's and don'ts worth internalizing before you write your own:

**Do:**

- Reach for `stdenv.mkDerivation` (or a language-specific builder like `buildPythonPackage`, `buildGoModule`, `rustPlatform.buildRustPackage`) instead of the raw `derivation` builtin. They give you sane default phases for free.
- Use `pname` and `version` separately rather than a single `name` — it's what lets tooling bump versions automatically.
- Trust the default phases before overriding them. Most portable build systems just work with zero custom `buildPhase`/`installPhase`.
- Fill in `meta` (`description`, `homepage`, `license`). This is exactly what powers `search.nixos.org` and the Nixpkgs manual.
- Pin every source with a real content hash. If you don't know it yet, put in `lib.fakeHash` as a placeholder, try to build, and Nix's error message will hand you the correct one.

**Don't:**

- Don't do network access from inside `buildPhase` or `installPhase`. Builds run in a sandbox with no network on purpose, that's what makes the output reproducible. Anything that needs to fetch something (like `fetchurl` above) has to be its own dedicated fixed-output derivation, which is allowed network access specifically because its output hash gets checked against what you declared.
- Don't hardcode absolute paths from your own machine (`/home/you/...`) into a derivation. If it isn't a declared input, it isn't reproducible, and it'll almost certainly fail to build for someone else.
- Don't rewrite phases you don't need to. A custom `installPhase` that reimplements what the default one already does is extra surface area to maintain for no benefit.

## Overrides

Here's where functions, attribute sets, and laziness come together into the pattern you'll actually use constantly once you start customizing packages.

Remember: a package in Nixpkgs isn't just a built thing, it's the **result of calling a function like `mkDerivation` with a specific set of arguments, and Nix keeps that function and those arguments attached to the result**. Because of that, you can ask for "the same package, but with one input changed" without editing any source:

```nix
pkgs.ripgrep.override {
  # override arguments passed to the original function that built ripgrep
}
```

`override` re-invokes the original build function with modified arguments — useful when a package's `default.nix` exposes something like `withPCRE2` as a parameter. `overrideAttrs` is the more commonly reached-for tool: it lets you tweak the derivation's attributes directly (`src`, `version`, `patches`, `buildInputs`, ...) without needing to know what arguments the original function accepted:

```nix
pkgs.ripgrep.overrideAttrs (finalAttrs: previousAttrs: {
  version = "14.1.1";
  src = pkgs.fetchFromGitHub {
    owner = "BurntSushi";
    repo = "ripgrep";
    rev = "14.1.1";
    hash = "..."; # nix will tell you the correct hash if you get this wrong
  };
})
```

`overrideAttrs` takes a function of the _final_ (post-override) and _previous_ (pre-override) attribute sets, and returns the attributes to change. You'll see older code using just `oldAttrs: { ... }` (single argument); the two-argument form is the current convention because it lets your override refer to other overrides you've also applied, not just the original values.

This pattern, a value that carries around the means to reconstruct itself with changes, is also what powers **overlays**, the mechanism for patching Nixpkgs itself. That's a big enough topic to earn its own space later in the series, but now you have the language-level building block it's made of.

{{< alert icon="lightbulb" >}}
If you only remember one thing from this section: `override` changes the _inputs_ to the build function, `overrideAttrs` changes the _derivation's attributes_ directly. When in doubt, `overrideAttrs` is almost always the one you want.
{{< /alert >}}

## Where to find documentation

This post is a starting point, not a reference. When you need the real thing:

- **[nix.dev language basics](https://nix.dev/tutorials/nix-language.html)** — a friendlier, more example-driven introduction than this post, if you want a second pass.
- **[Nix language reference](https://nix.dev/manual/nix/stable/language/)** — the actual formal reference for syntax and built-ins. This is what you reach for when you need to know precisely how something behaves.
- **[Nixpkgs manual](https://nixos.org/manual/nixpkgs/stable/)** — covers conventions specific to Nixpkgs: how packages are structured, how to write overlays, language idioms used throughout the tree.
- **[Noogle](https://noogle.dev/)** — a search engine for Nix and Nixpkgs library functions. Indispensable once you start wondering "is there already a builtin for this."
- **[search.nixos.org](https://search.nixos.org/)** — search packages and NixOS options directly.
- **[Nix Pills](https://nixos.org/guides/nix-pills/)** — an older but still excellent series that builds up Nix concepts from first principles, going deeper into the store and derivations than this series will.
- **[Official NixOS Wiki](https://wiki.nixos.org/)** — community-maintained, good for practical how-tos and gotchas that don't fit in a reference manual.

## What's next

Next up is the CLI itself: the old commands versus the modern unified `nix` command, and a proper introduction to flakes.

See you in the next one!
