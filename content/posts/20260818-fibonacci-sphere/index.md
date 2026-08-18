---
title: "The Sunflower's Secret to Covering a Sphere"
date: 2026-08-18
draft: true
description: "Put a thousand points on a sphere so they're evenly spread. On a flat sheet this is easy; on a sphere it quietly isn't. A tour through the obvious attempts, why each one fails, and how a sunflower — and the most irrational number there is — get it almost right."
tags: ["math", "visualization", "geometry"]
categories: ["math"]
wideLayout: true
---

{{< katex >}}

Here is a problem that sounds like it should be easy.

> Place \(N\) points on the surface of a sphere so that they are spread out
> as evenly as possible.

On a flat sheet of paper you would not think twice: a hexagonal lattice, like
a honeycomb, and you're done — every point has six neighbours at the same
distance and there is nothing left to improve. On a cube or a cylinder you can
get away with unfolding the surface into flat pieces and doing the same. The
sphere is the first surface you meet where none of that works, and it is
worth pausing on why: a sphere cannot be flattened without distortion. Any
map of the earth stretches something, somewhere. So there is no honeycomb to
copy over, and the question "what does *evenly* even mean here?" turns out
to have several defensible answers that disagree with each other.

I ran into this in my master's thesis, needing a few thousand directions on a
sphere that were "fair" to all of the sky. I want to walk you through what I
tried, roughly in the order I tried it, because each attempt fails in a way
that points to the next one — and the last one comes from somewhere you would
not think to look.

## The Obvious First Attempt: A Grid of Angles

Points on a sphere are directions, and directions have two angles: a polar
angle \(\theta\) from the north pole, from \(0\) to \(180°\), and an azimuth
\(\varphi\) around the axis, from \(0\) to \(360°\). So the first thing anyone
does — I certainly did — is put a regular grid on those two angles: every
\(10°\) in \(\theta\), every \(10°\) in \(\varphi\), and convert each pair to a
point. It's two nested loops. Before you look too closely at what it produces,
make a guess: where on the sphere is this going to go wrong?

{{< viz widget="sphere-sampling" id="grid" params=`{"n": 800, "mode": "grid", "fixed": true}` >}}
**A grid of angles, 800 points.** Every ring of latitude gets the same number
of points. Drag the sphere until you are looking straight down at a pole.
{{< /viz >}}

Look at the pole. Every ring of latitude gets the same number of points, but
the rings near the pole are tiny, so those points end up crammed together
while the ring around the equator is sparse. Near the pole itself you are
placing dozens of points that are practically on top of each other. If these
directions were, say, cameras or sensors or samples of the sky, you would be
spending most of your budget on the two least interesting spots on the sphere.

## Fixing the Poles

The fix is natural once you have seen the problem: put *fewer* points on the
short rings. How many fewer? A ring at polar angle \(\theta\) has circumference
proportional to \(\sin\theta\) — the equator has \(\sin 90° = 1\), the ring at
\(30°\) is half as long, the ring at the pole has length zero. So scale the
number of points on each ring by \(\sin\theta\). This is a standard recipe;
here is how the manual of one of the scattering codes I used states it:

$$
\begin{aligned}
N_\theta &= \operatorname{nint}\!\left[\frac{\theta_{\max}-\theta_{\min}}{\Delta\theta}\right] + 1, \\[0.6em]
N_{\varphi,\theta} &= \operatorname{nint}\!\left[\sin\theta \,\frac{\varphi_{\max}-\varphi_{\min}}{\Delta\theta}\right] + 1,
\end{aligned}
$$

with the points on each ring spread evenly in \(\varphi\). "The point of the
\(\sin\theta\) scaling," the manual says, "is to avoid packing the poles."
Here it is, at the same \(N\):

{{< viz widget="sphere-sampling" id="grid-sin" params=`{"n": 800, "mode": "grid-sin", "fixed": true}` >}}
**Rings scaled by \(\sin\theta\).** Each pole now gets exactly one point and
the density is roughly the same everywhere. Look for the seam where the rings
all start, and notice the readout: you asked for 800 and got what the rounding
gave you.
{{< /viz >}}

It is a real improvement.

But keep looking, and things start to bother you. The points still sit on
rings, so a point's neighbours on its own ring are at one distance and its
neighbours on the next ring at a different one. Along the seam where each ring
starts (\(\varphi = 0\)) the pattern lines up from pole to pole, while
elsewhere the rings are out of step. You can't ask for *exactly* \(N\) points —
you get whatever the rounding gives you (the readout shows how far off it
is). And it is still, unmistakably, a *grid*: there are preferred directions,
which is exactly what "spread evenly" was supposed to avoid.

You might be tempted at this point to throw up your hands and use random
directions:

{{< viz widget="sphere-sampling" id="random" params=`{"n": 800, "mode": "random", "fixed": true}` >}}
**Uniformly random directions.** Press *Reshuffle* a few times. No rings, no
seams — and every single draw has clumps and holes.
{{< /viz >}}

Randomness is even *on average*, and you never get the average; you get one
draw.

## What Are We Actually Asking?

Time to step back. What are we trying to do, really?

We want \(N\) points on a sphere with no two of them too close and no region
of the sphere left empty. Said that way, it is a *packing* problem: fit \(N\)
equal caps onto a sphere as snugly as you can. And packing problems have a
reputation. In the flat plane, the densest packing of circles is the
honeycomb, and even that took until 1940 to prove. On the sphere, the version
"place \(N\) points to maximise the smallest distance between any two" is
called the Tammes problem, and it is solved for exactly \(N \le 14\) and \(N = 24\).
For everything else, nobody knows the best answer, and it is not for lack of
trying.

That sounds discouraging until you notice that nature has been solving the
two-dimensional version of this problem, quite well, for a very long time.
Look at the head of a sunflower.

## How a Sunflower Packs Its Seeds

If you look at the centre of a sunflower you will see spirals — some winding
clockwise, some counter-clockwise — with the seeds tucked between them almost
perfectly. It looks designed. It isn't; the plant follows a rule so simple you
could state it to a child:

> Every new seed appears at the centre, rotated by the same fixed angle from
> the previous seed, and older seeds get pushed outward as new ones arrive.

That's it. Two ingredients: a fixed *turn*, and an outward *drift*.

Let's write it down, because we will want to play with it. Number the seeds
\(0, 1, 2, \dots\) in the order they appeared. Seed \(i\) has been rotated
\(i\) times by our fixed angle, and pushed out to some radius. Measure the
angle as a *fraction of a full turn* and call that fraction \(\gamma\); then

$$
\varphi_i = 2\pi \cdot i \cdot \gamma, \qquad r_i = \sqrt{i}.
$$

Why \(\sqrt{i}\) for the drift? For the same reason we scaled the rings by
\(\sin\theta\) a moment ago: we want equal density everywhere. A ring at radius
\(r\) has circumference proportional to \(r\), so it should hold a number of
seeds proportional to \(r\), and that happens exactly when the \(k\)-th seed
lands at radius \(\sqrt{k}\). Notice that this half of the rule is bookkeeping —
it has nothing to do with the turn. Keep that in mind; it matters later.

Everything interesting is in \(\gamma\). Before you touch the slider below,
make a prediction: what fraction of a turn between consecutive seeds gives
the most evenly packed head?

{{< viz widget="fibonacci-spiral" id="spiral" height="1/1" params=`{"n": 600}` >}}
**Six hundred seeds, one dial.** Drag \(\gamma\). Try snapping it to \(1/2\),
then \(1/3\), then \(5/13\). Then nudge the slider *just slightly* off one of
those. Then try \(1/\varphi\).
{{< /viz >}}

If you guessed a half or a third, you now see the problem: the seeds line up.
A half turn gives two straight arms with a big empty wedge between them; a
third gives three.

{{< alert icon="lightbulb" >}}
**Pause and ponder.** Snap to \(5/13\). Why exactly thirteen arms? What happens
after thirteen seeds?
{{< /alert >}}

After \(q\) seeds with \(\gamma = p/q\), you have made exactly \(p\) full turns
and are back where you started, so seed \(q\) sits on the same ray as seed
\(0\), seed \(q+1\) on the same ray as seed \(1\), and so on. Any fraction
\(p/q\) makes exactly \(q\) rays. Fractions are terrible.

So the answer should be an irrational number — something that never repeats.
That is the right instinct, but it turns out not to be enough, and this is
where it gets interesting. Move the slider a hair off \(1/3\). The three arms
don't vanish; they bend into three spirals. The seeds still "know" they are
*almost* repeating every third seed, and the almost shows up as a curl. Try
just off \(5/13\): thirteen curling arms. Being *near* a fraction leaves a
fingerprint — and every number, irrational or not, is near *some* fractions.
The question is how near, and how cheaply.

And then there is one setting where nothing lines up at all, however hard you
squint: \(\gamma = 1/\varphi \approx 0.618\), one turn divided by the golden
ratio. If you have seen a real sunflower head you have seen this exact picture,
because this is the angle the plant uses — usually quoted as \(137.5°\), which
is the same turn measured the other way round: \(0.618\) of a turn one way is
\(0.382\) of a turn the other, and \(0.382 \times 360° \approx 137.5°\). Not
because \(\varphi\) is beautiful. Because it is the number that is *worst at
pretending to be a fraction*.

## The Most Irrational Number

That phrase can be made precise, and since it is the whole secret, it is
worth a few minutes.

Every number can be approximated by fractions; the question is how *well*,
for a given size of denominator. Some numbers are suspiciously easy. \(\pi\)
is the famous example: \(22/7\) is off by about a thousandth, and \(355/113\)
by less than a millionth — an absurdly good deal for a three-digit
denominator. Set the dial to \(\pi - 3 \approx 0.1416\) and you will see faint
arms, because \(355/113\) *is* 113 rays, and \(\pi\)'s seeds don't drift away
from them for a very long time.

The tool for talking about this is the continued fraction: writing a number
not as decimals but as a tower,

$$
x = a_0 + \cfrac{1}{a_1 + \cfrac{1}{a_2 + \cfrac{1}{a_3 + \dots}}} .
$$

Cut the tower off at any level and you get a fraction, and these fractions are
the *best possible* approximations of \(x\) for their size. A big number
somewhere in the tower means the fraction just before it fits unusually well —
for \(\pi\) the tower goes \(3, 7, 15, 1, 292, \dots\), and that \(292\) is why
\(355/113\) is so good. Small numbers in the tower mean the number keeps
wriggling out of every approximation.

So which number has the *smallest possible* entries all the way down? All
ones. And there is exactly one number whose tower is all ones (well, one and
its relatives):

$$
\frac{1}{\varphi} = 0 + \cfrac{1}{1 + \cfrac{1}{1 + \cfrac{1}{1 + \dots}}} .
$$

Cut it off at each level and you get \(1/1,\ 1/2,\ 2/3,\ 3/5,\ 5/8,\ 8/13,\ \dots\) —
ratios of consecutive Fibonacci numbers, closing in on \(0.618\) more
reluctantly than any sequence of fractions closes in on any other number.
There is a theorem that makes this exact (Hurwitz's), and it says the golden
ratio is the hardest number there is to approximate by fractions.

Now look back at the dial. The snap buttons under it are Fibonacci ratios.
Each one is the *best* fraction pretending to be \(1/\varphi\), and each one
gives a picture of straight rays; \(1/\varphi\) itself is what's left when you
refuse all of them. And the spirals on a real sunflower — count them, they
come in Fibonacci numbers, 21 one way and 34 the other — are the plant
showing you the fractions it is *almost* using.

This is where it stops being a picture and becomes a theorem, and the cleanest
place to see it is one dimension down: forget the disk, and just drop points
around a *circle*, point \(i\) at fraction \(i\gamma\) of the way round. Now
"evenly spread" has an exact meaning — look at the gaps between neighbouring
points. Here is a fact that surprised me when I first met it: for *any*
\(\gamma\) and *any* \(N\), those gaps come in at most **three** distinct
sizes. Not roughly three. Three. It is called the three-distance theorem, and
the bars in the middle of the figure count the sizes for you.

{{< viz widget="circle-gaps" id="circle" height="4/3" params=`{"n": 34}` >}}
**The dial on a circle.** Coloured arcs are the gaps, one colour per size; the
bars count them. Snap to \(5/13\): thirteen equal gaps, and every point after
the thirteenth lands on top of an earlier one. Set \(\gamma = 1/\varphi\) and
slide \(N\): whenever \(N\) is a Fibonacci number there are just two gap
sizes, and their counts are the two Fibonacci numbers before it; in between
there are three. Keep an eye on the ratio in the readout.
{{< /viz >}}

So the golden turn is not just even-*looking*; it comes with a guarantee. For
\(\gamma = 1/\varphi\) the longest gap is never more than \(\varphi^2 \approx
2.62\) times the shortest, for every \(N\) — that is the "worst at being a
fraction" property in disguise. Set \(\gamma\) to anything else and watch the
ratio blow past that ceiling sooner or later.

Here is the thing I want you to hold on to. We started with a question about
*geometry* — how do I spread seeds evenly? — and it became a question about
*number theory* — how badly can a number be approximated by fractions? That
reframing is the entire trick, and it is why the same idea will work on a
surface the sunflower has never seen.

## Getting a Flat Pattern onto a Sphere

So the sunflower hands us a beautifully even pattern — on a *disk*. Our
points live on a sphere. How do we carry one to the other?

Remember the two ingredients. The golden turn is a statement about angles,
and a sphere has an azimuth \(\varphi\) just like the disk does — that part
carries over untouched. The only disk-specific ingredient was the drift, the
\(\sqrt{i}\), whose only job was to keep the density constant. So the real
question is: what plays the role of "radius" on a sphere, and what should it
be for point \(i\) so that every point owns the same amount of area?

You could try to answer that with calculus. But there is a much older and
much prettier way in. Imagine laying the sunflower disk on top of the sphere
at the north pole and pressing it down over the surface, like a cloth over a
ball, in the one particular way that *does not stretch or squeeze any area* —
so a small patch of the disk always covers a patch of the sphere of the same
size. Such a map exists; cartographers know it as Lambert's azimuthal
equal-area projection, and it sends a point at distance \(r\) from the centre
of the disk to the point at polar angle \(\theta\) with

$$
r = 2\sin\frac{\theta}{2}, \qquad\text{equivalently}\qquad
\cos\theta = 1 - \frac{r^2}{2}.
$$

Now the sunflower's \(r_i^2 \propto i\) does something wonderful. Square the
radius rule and plug it in. (One piece of housekeeping on the way: use
\(i + \tfrac12\) rather than \(i\), so that the first point sits in the middle
of its own little band instead of dead on the pole — and likewise the last —
and scale the disk so it covers the whole sphere.) The inclination of point
\(i\) comes out as

$$
\cos\theta_i = 1 - \frac{2i+1}{N}.
$$

Read that carefully, because it is the whole answer and it is a direct
comparison with where we started. The grid stepped evenly in \(\theta\).
This steps evenly in \(\cos\theta\) — the *height* of the point above the
equator. That is Archimedes' answer: he showed 2,000 years ago that slicing a
sphere with two horizontal planes cuts off a band whose area depends only on
the distance between the planes, not on where they are. Thin band near the
pole, thin band at the equator, same height, same area. Equal area per point
*means* equal spacing in \(\cos\theta\), and even spacing in \(\theta\) is
exactly the mistake that crowded the poles. (Take a moment with that; it is not
obvious, and it is why a hat-box and the globe inside it have the same surface
area.)

So the recipe on the sphere is a \(\theta\)–\(\varphi\) rule again, just like
the grids — one line each:

$$
\begin{aligned}
\theta_i &= \arccos\!\Big(1 - \frac{2i + 1}{N}\Big), &
\varphi_i &= 2\pi\, i\, \gamma, \\[0.4em]
\mathbf{p}_i &= \big(\sin\theta_i\cos\varphi_i,\; \cos\theta_i,\; \sin\theta_i\sin\varphi_i\big).
\end{aligned}
$$

That's the whole thing. It is called the Fibonacci sphere, or Fibonacci
lattice, and it is the dial you have already turned — pressed onto a sphere.

{{< viz widget="fibonacci-sphere" id="dial" wide="true" params=`{"n": 800}` >}}
**The same dial, one dimension up.** Every fraction \(p/q\) still collapses
the pattern — now into \(q\) spokes running pole to pole. Snap to \(5/13\) and
count them. Nudge off a fraction and the spokes twist. Only \(1/\varphi\)
refuses to line up. Drag to rotate; there is no hidden bad side.
{{< /viz >}}

Put it next to the recipes we started with, at the same \(N\):

{{< viz widget="sphere-sampling" id="methods" params=`{"n": 800, "mode": "fibonacci"}` >}}
**All four recipes, one sphere.** Flip the method. No crowded poles, no rings,
no seam, no clumps — and exactly the \(N\) you asked for.
{{< /viz >}}

Linger on *why* for a moment, because it is genuinely surprising once you
notice it: nowhere in that formula did we tell the points to avoid each other.
Nobody computed a distance. Nothing was optimised. The evenness is a
consequence of a number's *reluctance to be a fraction*, and that reluctance
does not care what surface you draw on.

## Can We Do Better?

Yes, a little — but "better" needs a number first, because "looks even" and
"is even" are different claims. Here is the simplest one that captures what we
mean: take every point's distance to its nearest neighbour, and ask how much
those distances vary. If the points were perfectly even, they would all be the
same. So define the loss as the relative spread,

$$
L \;=\; \frac{\operatorname{std}(d_i)}{\operatorname{mean}(d_i)}, \qquad d_i = \text{distance from point } i \text{ to its nearest neighbour},
$$

and try to make it small. It is not the only sensible choice — you could ask
about the largest empty hole instead, and the figure reports that too — but it
is honest, cheap, and it punishes exactly the crowding and clumping we saw.

{{< viz widget="sphere-quality" id="quality" height="16/9" params=`{"n": 1000}` >}}
**Same \(N\), five recipes.** Each row is the histogram of nearest-neighbour
distances in units of the ideal spacing \(\sqrt{4\pi/N}\), with log-scaled
bars so the thin tails show. A perfectly even set would be one spike. On the
right, three numbers in the same units: the loss \(L\), the closest pair
anywhere on the sphere, and the largest empty hole. The last row is the
Fibonacci lattice with a pole offset \(\varepsilon\), explained below; set it
to \(0.5\) and the row becomes the plain lattice above it.
{{< /viz >}}

Two things jump out. The plain grid and random directions are as bad as they
looked — most of the grid's points are crowded to a fraction of the ideal
spacing, and the random cloud is smeared across the whole axis, with a closest
pair almost on top of each other and holes nearly twice the ideal size. And the
\(\sin\theta\)-scaled grid is, by this loss, *nearly as good as the Fibonacci
lattice* — by the largest-hole measure it is actually a shade better. I want to
be honest about that, because it is the recipe most codes actually ship, and
it deserves its reputation. What the Fibonacci lattice adds is not a much
smaller \(L\). It is that you get exactly the \(N\) you asked for, with no
seam, no rings and no preferred direction, from a formula with no rounding
logic in it — and, as we saw, from a reason that has nothing to do with the
sphere.

Its one visible flaw is at the very poles, where the first and last points sit
a touch closer to their neighbours than everyone else — the closest pair on the
whole sphere is always point \(0\) and point \(3\), and their mirror images
at the other end. Remember the half-step we slipped into the height rule? Make
it a knob:

$$
\cos\theta_i = 1 - \frac{2(i+\varepsilon)}{N-1+2\varepsilon}.
$$

At \(\varepsilon = \tfrac12\) this is exactly the \((2i+1)/N\) we derived.
At \(\varepsilon = 0\) the first and last points sit dead on the poles — the
version most code snippets ship, and the worst of the lot; try it. Above
\(\tfrac12\) the pole points are pushed inward, and now that we have numbers we
don't have to guess: drag the slider and watch the closest pair loosen and
\(L\) fall. But keep dragging, and watch the *other* number: the largest hole
grows. You are opening a bald spot at each pole to make the neighbours around
it happier. Packing (no two points too close) and covering (no region left
empty) pull in opposite directions, and where you stop depends on which you
care about. Martin Roberts, who mapped this trade-off carefully, found that if
all you care about is the closest pair you want \(\varepsilon\) in the tens for
large \(N\), pole gaps and all, while \(\varepsilon \approx 0.36\) gives the
best *average* spacing. Past that you are into genuine optimisation — letting
the points repel each other for a while — which buys the last few percent at a
hundred times the cost.

That little tug-of-war is worth remembering, because it is the whole story of
"perfect" in miniature: the loss you choose decides the answer.

And there is a ceiling on how good "best" can be, which is worth knowing
about. For \(N = 4, 6\) and \(12\) there is an arrangement everyone agrees on:
the tetrahedron, the octahedron and the icosahedron, where every point sees
exactly the same picture as every other. You might expect the cube and the
dodecahedron to join them. They don't — for eight points, take a cube and twist
its top face by \(45°\), and every point gains room. For \(N = 5\) it already
gets murky: the Tammes problem has infinitely many equally good answers, and
the "minimise the energy of \(N\) repelling charges" problem picks a different
shape again. Beyond a dozen or so points, with a lonely exception at \(N = 24\),
nobody can even *prove* which arrangement is best under any of these
definitions. Against that backdrop, the Fibonacci sphere is not a compromise.
It is what a good heuristic looks like: deterministic, one line, linear time,
and close to optimal under every definition of "even" at once. The sunflower
got there first, but it had a few hundred million years.

## One Fact in Three Costumes

If you remember one thing from this, don't let it be the recipe. The sunflower,
the sphere, and the theorem about three gaps on a circle are the same fact
wearing different clothes: *if you keep turning by a fixed fraction, the
pattern you get is a picture of how well that fraction can be approximated by
simpler ones.* Rational, and you get rays. Nearly rational, and you get
spirals. Golden, and you get the closest thing to nothing at all — which, when
what you want is evenness, is exactly what you were after.

And if you're now itching to ask the obvious next question — is there a
"golden ratio" for turning by *two* fractions at once, say to fill a torus or
a higher-dimensional sphere? — wonderful. The answer is murkier than you'd
hope (the search term is "plastic number", and Roberts' post on quasirandom
sequences below is the place to start), and it is a good rabbit hole.

## Further reading

- H. Vogel, *A better way to construct the sunflower head*, Math. Biosci. 44 (1979).
- R. Swinbank & R. J. Purser, *Fibonacci grids: A novel approach to global
  modelling*, Q. J. R. Meteorol. Soc. 132 (2006).
- Á. González, *Measurement of areas on a sphere using Fibonacci and
  latitude–longitude lattices*, Math. Geosci. 42 (2010).
- R. Marques, C. Bouville, K. Bouatouch, J. Blat, *Spherical Fibonacci point
  sets for illumination integrals*, Comput. Graph. Forum 32 (2013).
- V. T. Sós, *On the distribution mod 1 of the sequence \(n\alpha\)*, Ann.
  Univ. Sci. Budapest 1 (1958) — the three-distance theorem.
- M. Roberts, *How to evenly distribute points on a sphere more effectively
  than the canonical Fibonacci lattice* (blog post; the \(\varepsilon\)-offset).
- M. Roberts, *The unreasonable effectiveness of quasirandom sequences* (blog
  post; the "golden ratio" for two dimensions at once).
