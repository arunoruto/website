// How even is "even"? For each placement recipe at the same N, the histogram
// of nearest-neighbour distances (in units of the ideal spacing √(4π/N)). A
// perfectly even set would be a single spike at ~1; the wider the smear, the
// more the local density varies. Includes the Fibonacci lattice with and
// without the ε pole offset (ε = ½ is the plain lattice; see sphere-points.js).
//
// Three numbers per row: the loss the text asks to minimise,
// L = std(d) / mean(d) over nearest-neighbour distances d; the closest pair
// (packing, min d); and the largest empty hole (covering radius) — all in
// units of the ideal spacing.
//
// Shortcode params (all optional):
//   n      point count (default 1000)
//   eps    initial pole offset for the last row (default 1.0)
//   logY   log-scaled histogram heights (default true)
//   maxN   upper slider bound (default 3000)

import { register } from "../core/mount.js";
import { buildControls } from "../core/controls.js";
import { placePoints, neighbourLists, nearestNeighbourDistances, largestHole, FIB_EPS_DEFAULT } from "../lib/sphere-points.js";

const ROWS = [
  { key: "grid", label: "θ × φ grid" },
  { key: "grid-sin", label: "grid, sin θ-scaled" },
  { key: "random", label: "uniform random" },
  { key: "fibonacci", label: "Fibonacci lattice" },
  { key: "fibonacci-eps", label: "Fibonacci, offset ε" },
];
const BINS = 60;
const XMAX = 2; // histogram range in units of ideal spacing

export default function mount(root, params, ctx) {
  const maxN = Math.max(200, Math.floor(params.maxN ?? 3000));
  const canvas = document.createElement("canvas");
  canvas.className = "viz__canvas";
  ctx.stage.append(canvas);
  const g = canvas.getContext("2d");
  let theme = ctx.theme;
  let dpr = 1, width = 0, height = 0;
  let seed = 1;
  let stats = []; // per row: { hist, min, mean, cv, hole, count }
  const buf = new Float32Array(maxN * 3);

  const computeRow = (row, n, ideal) => {
    const method = row.key === "fibonacci-eps" ? "fibonacci" : row.key;
    const eps = row.key === "fibonacci-eps" ? controls.state.eps : FIB_EPS_DEFAULT;
    const { count } = placePoints(method, buf, n, { maxN, seed, eps });
    const lists = neighbourLists(buf, count);
    const d = nearestNeighbourDistances(buf, count, lists);
    const hist = new Float32Array(BINS);
    let min = Infinity, sum = 0, sum2 = 0;
    for (let i = 0; i < count; i++) {
      const x = d[i] / ideal;
      const b = Math.min(BINS - 1, Math.floor((x / XMAX) * BINS));
      hist[b] += 1;
      if (x < min) min = x;
      sum += x;
      sum2 += x * x;
    }
    const mean = sum / count;
    const cv = Math.sqrt(Math.max(0, sum2 / count - mean * mean)) / mean;
    const hole = largestHole(buf, count, lists) / ideal;
    return { hist, min, mean, cv, hole, count };
  };

  // `only` limits the recompute to one row key (the ε slider only moves the
  // last row, Reshuffle only the random one).
  const compute = (only = null) => {
    const n = controls.state.n;
    const ideal = Math.sqrt((4 * Math.PI) / n);
    stats = ROWS.map((row, r) => (only && row.key !== only && stats[r] ? stats[r] : computeRow(row, n, ideal)));
  };

  // A slider fires many input events per frame; each recompute is O(N²), so
  // coalesce them: remember the widest recompute asked for, do it once per frame.
  let pending = null; // null | "all" | Set of row keys
  let rafId = 0;
  const schedule = (scope) => {
    if (scope === "all" || pending === "all") pending = "all";
    else (pending ??= new Set()).add(scope);
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const todo = pending;
      pending = null;
      if (todo === "all") compute();
      else for (const key of todo) compute(key);
      draw();
    });
  };

  const controls = buildControls(
    ctx.controlsEl,
    [
      { type: "range", key: "n", label: "Points N", min: 100, max: maxN, value: Math.floor(params.n ?? 1000), scale: "log", integer: true },
      { type: "range", key: "eps", label: "Pole offset ε", min: 0, max: 3, step: 0.01, value: params.eps ?? 1, format: (v) => v.toFixed(2) },
      { type: "checkbox", key: "logY", label: "Log-scale bars", value: Boolean(params.logY ?? true) },
      { type: "buttons", label: "Random draw", buttons: [{ label: "Reshuffle", onClick: () => { seed++; schedule("random"); } }] },
    ],
    (state, changed) => {
      if (changed.includes("n")) schedule("all");
      else if (changed.includes("eps")) schedule("fibonacci-eps");
      else draw();
    }
  );

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const labelW = Math.min(150, width * 0.28);
    const statW = Math.min(120, width * 0.24);
    const left = labelW + 8;
    const right = width - statW - 8;
    const plotW = Math.max(40, right - left);
    const rowH = height / ROWS.length;
    const fs = Math.max(10, Math.min(12.5, rowH * 0.22));
    g.font = `${fs}px system-ui, sans-serif`;
    g.textBaseline = "middle";

    const logY = controls.state.logY;
    const scale = (v) => (logY ? Math.log10(1 + v) : v);
    const peak = Math.max(...stats.map((s) => Math.max(...s.hist.map(scale))));
    ROWS.forEach((row, r) => {
      const y0 = r * rowH;
      const base = y0 + rowH * 0.82;
      const s = stats[r];
      // label
      g.fillStyle = theme.fg.css();
      g.textAlign = "left";
      g.fillText(row.key === "fibonacci-eps" ? `Fibonacci, ε = ${controls.state.eps.toFixed(2)}` : row.label, 4, y0 + rowH / 2);
      // axis line + ideal-spacing tick
      g.strokeStyle = theme.faint.css();
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(left, base + 0.5);
      g.lineTo(right, base + 0.5);
      g.stroke();
      const xIdeal = left + (1 / XMAX) * plotW;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(xIdeal, y0 + rowH * 0.12);
      g.lineTo(xIdeal, base);
      g.stroke();
      g.setLineDash([]);
      // bars
      const bw = plotW / BINS;
      const isFib = row.key.startsWith("fibonacci");
      g.fillStyle = isFib ? theme.primary.css() : theme.muted.css(0.85);
      for (let b = 0; b < BINS; b++) {
        const h = (scale(s.hist[b]) / peak) * rowH * 0.66;
        if (h > 0) g.fillRect(left + b * bw, base - h, Math.max(1, bw - 1), h);
      }
      // stats: loss, packing (closest pair), covering (largest hole)
      g.fillStyle = theme.muted.css();
      g.textAlign = "right";
      const cy = y0 + rowH / 2;
      g.fillText(`L = ${s.cv.toFixed(4)}`, width - 4, cy - fs * 1.25);
      g.fillText(`closest pair ${s.min.toFixed(2)}`, width - 4, cy);
      g.fillText(`largest hole ${s.hole.toFixed(2)}`, width - 4, cy + fs * 1.25);
    });
    // x-axis caption
    g.fillStyle = theme.muted.css();
    g.textAlign = "center";
    g.fillText(`nearest-neighbour distance ÷ ideal spacing (dashed = 1)${logY ? ", log-scaled counts" : ""}`, left + plotW / 2, height - fs * 0.7);
  };

  const resize = () => {
    ({ width, height } = ctx.size());
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  };

  ctx.onResize(resize);
  compute();
  resize();

  return {
    setTheme(next) {
      theme = next;
      draw();
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      canvas.remove();
    },
  };
}

register("sphere-quality", mount);
