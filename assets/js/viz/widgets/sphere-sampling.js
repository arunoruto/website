// Ways to put N points on a sphere, side by side on the same instrument:
//   grid       θ×φ lattice — same number of points on every ring of latitude
//   grid-sin   rings of latitude, but the number of points on each ring scales
//              with sin θ (one point at each pole) — the "avoid packing the poles"
//              recipe from many scattering / radiative-transfer codes
//   random     uniformly random directions (seeded; "Reshuffle" redraws)
//   fibonacci  the Fibonacci lattice with γ = 1/φ
//
// Shortcode params (all optional):
//   mode         initial method (default "grid")
//   fixed        true = no method selector, the figure shows just `mode` (default false)
//   n            target point count (default 500)
//   autorotate   slow spin (default true; off under reduced motion)
//   colorByIndex tint points in the order they were generated (default false)
//   shell        opaque inner sphere hiding back-facing points (default true)
//   maxN         upper slider bound (default 5000)

import { register } from "../core/mount.js";
import { buildControls } from "../core/controls.js";
import { createPointSphere } from "../lib/point-sphere.js";
import { METHODS, placePoints } from "../lib/sphere-points.js";

export default function mount(root, params, ctx) {
  const maxN = Math.max(100, Math.floor(params.maxN ?? 5000));
  const ps = createPointSphere(ctx, { maxN, shell: params.shell ?? true });
  const positions = new Float32Array(maxN * 3);
  const colorA = new ps.THREE.Color();
  const colorB = new ps.THREE.Color();
  const gradient = (i, n, theme) => colorA.setHex(theme.primary.hex).lerp(colorB.setHex(theme.secondary.hex), i / (n - 1 || 1)).getHex();

  let seed = 1;
  let info = { count: 0, rings: 0 };

  const layout = () => {
    const { mode, n, colorByIndex } = controls.state;
    info = placePoints(mode, positions, n, { maxN, seed });
    ps.setPoints(positions, info.count, colorByIndex ? gradient : null);
    controls.update();
  };

  const mode = METHODS.some((m) => m.value === params.mode) ? params.mode : "grid";
  const fixed = Boolean(params.fixed ?? false);
  const spec = [
    ...(fixed
      ? [] // state still needs the key; seed it below
      : [{ type: "select", key: "mode", label: "Method", value: mode, options: METHODS }]),
    { type: "range", key: "n", label: "Points N", min: 10, max: maxN, value: Math.floor(params.n ?? 500), scale: "log", integer: true },
    {
      type: "readout",
      label: "Placed",
      render: () => (info.rings ? `${info.count} points on ${info.rings} rings` : `${info.count} points`),
    },
    ...(fixed && mode !== "random"
      ? []
      : [{ type: "buttons", label: "Random draw", buttons: [{ label: "Reshuffle", onClick: () => { seed++; if (controls.state.mode === "random") layout(); } }] }]),
    { type: "checkbox", key: "colorByIndex", label: "Colour by index", value: Boolean(params.colorByIndex ?? false) },
    { type: "checkbox", key: "autorotate", label: "Auto-rotate", value: Boolean(params.autorotate ?? true) },
  ];
  const controls = buildControls(ctx.controlsEl, spec, (state, changed) => {
    if (changed.some((k) => k === "mode" || k === "n" || k === "colorByIndex")) layout();
    if (changed.includes("autorotate")) ps.view.setAutoRotate(state.autorotate);
  });
  if (fixed) controls.state.mode = mode;

  layout();
  ps.view.setAutoRotate(controls.state.autorotate);

  return {
    setTheme: (theme) => ps.setTheme(theme),
    destroy: () => ps.dispose(),
  };
}

register("sphere-sampling", mount);
