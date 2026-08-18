// The turn-fraction dial, flat: Vogel's sunflower model. Seed i sits at radius
// √i (so every ring of seeds gets the same area) and angle 2π·i·γ. Rational
// γ = p/q collapses the head into q straight arms; near a convergent of 1/φ the
// arms curl into the Fibonacci-numbered spirals real sunflowers show; γ = 1/φ
// itself packs evenly. Same dial as the sphere widget, one dimension down.
//
// Shortcode params (all optional):
//   n            seed count               (default 500)
//   gamma        turn fraction in [0,1)   (default 1/φ)
//   colorByIndex tint seeds along the spiral (default false)
//   sweep        slowly drift γ upward    (default false; disabled under reduced motion)
//   maxN         upper slider bound       (default 5000)

import { register } from "../core/mount.js";
import { buildControls } from "../core/controls.js";
import { createLoop } from "../core/motion.js";
import { turnFractionControls } from "../lib/golden.js";

const SWEEP_RATE = 0.006; // γ per second — a full lap in under three minutes

export default function mount(root, params, ctx) {
  const maxN = Math.max(100, Math.floor(params.maxN ?? 5000));
  const canvas = document.createElement("canvas");
  canvas.className = "viz__canvas";
  ctx.stage.append(canvas);
  const g = canvas.getContext("2d");

  let theme = ctx.theme;
  let dpr = 1;
  let width = 0;
  let height = 0;

  const controls = buildControls(
    ctx.controlsEl,
    [
      ...turnFractionControls(params, { maxN }),
      { type: "checkbox", key: "sweep", label: "Sweep γ slowly", value: Boolean(params.sweep ?? false) && !ctx.reducedMotion },
    ],
    (state, changed) => {
      if (changed.includes("sweep")) syncSweep();
      loop.requestFrame();
    }
  );

  const resize = () => {
    ({ width, height } = ctx.size());
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    loop.requestFrame();
  };

  const draw = () => {
    const { n, gamma, colorByIndex } = controls.state;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const R = Math.min(width, height) * 0.47;
    // Radius √i on a disk of area πR² gives area πR²/N per seed → spacing ~ R·√(π/N).
    const spacing = R * Math.sqrt(Math.PI / n);
    const dot = Math.max(0.8, Math.min(9, 0.32 * spacing));
    const a = theme.primary.rgb;
    const b = theme.secondary.rgb;
    g.fillStyle = theme.primary.css();
    for (let i = 0; i < n; i++) {
      const r = R * Math.sqrt((i + 0.5) / n);
      const t = 2 * Math.PI * i * gamma;
      if (colorByIndex) {
        const u = i / (n - 1 || 1);
        g.fillStyle = `rgb(${a[0] + (b[0] - a[0]) * u}, ${a[1] + (b[1] - a[1]) * u}, ${a[2] + (b[2] - a[2]) * u})`;
      }
      g.beginPath();
      g.arc(cx + r * Math.cos(t), cy - r * Math.sin(t), dot, 0, Math.PI * 2);
      g.fill();
    }
  };

  const loop = createLoop(ctx.stage, (dt) => {
    if (controls.state.sweep && dt > 0) {
      let gamma = controls.state.gamma + SWEEP_RATE * dt;
      if (gamma >= 1) gamma -= 1;
      controls.set({ gamma }, { silent: true });
    }
    draw();
  });

  const syncSweep = () => {
    if (controls.state.sweep && ctx.reducedMotion) controls.set({ sweep: false }, { silent: true });
    if (controls.state.sweep) loop.start();
    else loop.stop();
  };

  ctx.onResize(resize);
  resize();
  syncSweep();

  return {
    setTheme(next) {
      theme = next;
      loop.requestFrame();
    },
    destroy() {
      loop.dispose();
      canvas.remove();
    },
  };
}

register("fibonacci-spiral", mount);
