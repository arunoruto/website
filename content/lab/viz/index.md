---
title: "Viz lab"
description: "Development playground for the interactive figures. Draft-only: never built for production."
date: 2026-08-18
draft: true

showDate: false
showHero: false
showBreadcrumbs: false
showTableOfContents: false
showReadingTime: false
showWordCount: false
showPagination: false
showTaxonomies: false
showAuthor: false
showEdit: false
showComments: false
sharingLinks: false
---

Every widget under `assets/js/viz/widgets/` mounted once with defaults, plus
layout variants. `serve` builds drafts, `hugo --minify` does not, so this page
never ships. Add a section here whenever you add a widget.

## sphere-sampling

Grid / sin θ-scaled grid / random / Fibonacci on one sphere:

{{< viz widget="sphere-sampling" eager="true" params=`{"n": 800}` >}}
Switch methods at fixed N. The θ×φ grid crowds the poles; the sin θ-scaled
grid fixes that but keeps rings and seams; random clumps; Fibonacci doesn't.
{{< /viz >}}

## circle-gaps

Three-distance theorem on a circle:

{{< viz widget="circle-gaps" height="1/1" eager="true" params=`{"n": 34}` >}}
At `1/φ` with N = 34 the gap counts are 13 / 21 (Fibonacci); snap to `5/13` to
see the gaps collapse to one size, with the remaining points reported as
coincident.
{{< /viz >}}

## sphere-quality

Nearest-neighbour histograms per method:

{{< viz widget="sphere-quality" height="16/9" params=`{"n": 1000}` />}}

## fibonacci-spiral

Vogel's sunflower, Canvas 2D. Same controls as the sphere:

{{< viz widget="fibonacci-spiral" height="1/1" eager="true" >}}
Snap to `8/21` for 21 arms; nudge γ a hair off `1/φ` to see arms curl into spirals.
{{< /viz >}}

Sweeping, colour by index, controls on the right:

{{< viz widget="fibonacci-spiral" controls="right" params=`{"n": 1500, "gamma": 0.55, "colorByIndex": true, "sweep": true}` />}}

## fibonacci-sphere

Defaults, controls below:

{{< viz widget="fibonacci-sphere" eager="true" >}}
Default instance. Snap to `5/13` to see 13 spokes; `1/φ` never snaps.
{{< /viz >}}

Wide, controls on the right, preset to a Fibonacci convergent:

{{< viz widget="fibonacci-sphere" wide="true" controls="right" params=`{"n": 1200, "gamma": 0.6, "colorByIndex": true}` >}}
`wide="true"` borrows the left gutter on large screens; `controls="right"` needs ≥ 768px.
{{< /viz >}}

No controls, fixed pixel height, no shell:

{{< viz widget="fibonacci-sphere" controls="none" height="240" params=`{"n": 300, "shell": false, "autorotate": true}` />}}
