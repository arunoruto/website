// The one-dimensional dial: N points dropped around a circle at fractional
// positions {i·γ}. For any γ the gaps between neighbours come in at most three
// distinct lengths (the three-distance theorem); the arcs are coloured by
// which of the three they are, and the panel lists each length with how many
// times it occurs. With γ = 1/φ and N a Fibonacci number there are two gap
// sizes whose counts are the two Fibonacci numbers below N; for every N the
// longest gap is at most φ² ≈ 2.618 times the shortest (φ when N is Fibonacci).
// Rational γ = p/q with N > q makes points coincide; those zero-length "gaps"
// are reported as coincidences and left out of the size classes.
//
// Shortcode params (all optional):
//   n            point count (default 34)
//   gamma        turn fraction (default 1/φ)
//   maxN         upper slider bound (default 500)

import { register } from "../core/mount.js";
import { buildControls } from "../core/controls.js";
import { turnFractionControls } from "../lib/golden.js";

const TAU = Math.PI * 2;

// Sorted gap lengths (as fractions of the circle) and their distinct classes.
function analyse(n, gamma) {
  const pos = new Float64Array(n);
  for (let i = 0; i < n; i++) pos[i] = (i * gamma) % 1;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pos[a] - pos[b]);
  const gaps = new Array(n); // gap after the k-th sorted point
  for (let k = 0; k < n; k++) {
    const a = pos[order[k]];
    const b = k + 1 < n ? pos[order[k + 1]] : pos[order[0]] + 1;
    gaps[k] = b - a;
  }
  // Group gap lengths, tolerating float noise. Zero-length gaps are points that
  // landed on top of an earlier one (γ = p/q, N > q): counted, not classed.
  const EPS = 1e-9;
  const classes = [];
  const classOf = new Int32Array(n).fill(-1);
  let coincident = 0;
  for (let k = 0; k < n; k++) {
    if (gaps[k] < EPS) {
      coincident++;
      continue;
    }
    let c = classes.findIndex((g) => Math.abs(g.length - gaps[k]) < EPS);
    if (c < 0) {
      classes.push({ length: gaps[k], count: 0 });
      c = classes.length - 1;
    }
    classes[c].count++;
    classOf[k] = c;
  }
  const rank = classes.map((_, i) => i).sort((a, b) => classes[a].length - classes[b].length);
  const rankOf = new Int32Array(classes.length);
  rank.forEach((c, r) => (rankOf[c] = r));
  return { pos, order, gaps, classes, classOf, rankOf, ranked: rank.map((c) => classes[c]), coincident };
}

export default function mount(root, params, ctx) {
  const maxN = Math.max(50, Math.floor(params.maxN ?? 500));
  const canvas = document.createElement("canvas");
  canvas.className = "viz__canvas";
  ctx.stage.append(canvas);
  const g = canvas.getContext("2d");
  let theme = ctx.theme;
  let dpr = 1, width = 0, height = 0;
  let a = analyse(1, 0);

  const controls = buildControls(
    ctx.controlsEl,
    [
      ...turnFractionControls(params, { maxN, minN: 3, defaultN: 34 }).filter((c) => c.key !== "colorByIndex"),
      {
        type: "readout",
        label: "Gaps",
        render: () => {
          const parts = a.ranked.map((c) => `${(c.length * 360).toFixed(2)}° ×${c.count}`);
          const ratio = a.ranked.length > 1 ? a.ranked[a.ranked.length - 1].length / a.ranked[0].length : 1;
          const dup = a.coincident ? `, ${a.coincident} points coincide` : "";
          return `${a.ranked.length} distinct: ${parts.join(", ")}${dup}  (longest/shortest = ${ratio.toFixed(3)})`;
        },
      },
    ],
    () => {
      recompute();
      draw();
    }
  );

  const recompute = () => {
    a = analyse(controls.state.n, controls.state.gamma);
    controls.update();
  };

  const gapColour = (rankIdx, count) => {
    // shortest → primary, longest → secondary, middle → muted; one class → primary
    if (count === 1) return theme.primary.css();
    if (rankIdx === 0) return theme.primary.css();
    if (rankIdx === count - 1) return theme.secondary.css();
    return theme.muted.css();
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;
    const R = Math.min(width, height) * 0.4;
    const n = a.gaps.length;
    const lw = Math.max(6, Math.min(18, (TAU * R) / n / 2.2));

    // Gap arcs, coloured by size class (zero-length gaps draw nothing).
    for (let k = 0; k < n; k++) {
      if (a.classOf[k] < 0) continue;
      const start = a.pos[a.order[k]] * TAU;
      const end = start + a.gaps[k] * TAU;
      g.beginPath();
      g.strokeStyle = gapColour(a.rankOf[a.classOf[k]], a.classes.length);
      g.lineWidth = lw;
      g.lineCap = "butt";
      // canvas y grows downward; keep angles counter-clockwise on screen
      g.arc(cx, cy, R, -end, -start, false);
      g.stroke();
    }
    // Points.
    g.fillStyle = theme.fg.css();
    const pr = Math.max(1.5, Math.min(4, lw * 0.28));
    for (let i = 0; i < n; i++) {
      const t = a.pos[i] * TAU;
      g.beginPath();
      g.arc(cx + R * Math.cos(t), cy - R * Math.sin(t), pr, 0, TAU);
      g.fill();
    }
    // Centre: bar chart of the distinct gap lengths with counts.
    const barW = R * 0.9;
    const rows = a.ranked.length;
    const bh = Math.min(22, (R * 0.8) / Math.max(rows, 1));
    const maxLen = a.ranked[rows - 1].length;
    const top = cy - (rows * bh) / 2;
    g.font = `${Math.max(10, Math.min(13, bh * 0.6))}px ui-monospace, monospace`;
    g.textBaseline = "middle";
    a.ranked.forEach((c, r) => {
      const y = top + r * bh + bh / 2;
      const w = (c.length / maxLen) * barW;
      g.fillStyle = gapColour(r, rows);
      g.fillRect(cx - barW / 2, y - bh * 0.32, w, bh * 0.64);
      g.fillStyle = theme.fg.css();
      g.textAlign = "left";
      g.fillText(`×${c.count}`, cx - barW / 2 + w + 6, y);
    });
  };

  const resize = () => {
    ({ width, height } = ctx.size());
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  };

  ctx.onResize(resize);
  recompute();
  resize();

  return {
    setTheme(next) {
      theme = next;
      draw();
    },
    destroy() {
      canvas.remove();
    },
  };
}

register("circle-gaps", mount);
