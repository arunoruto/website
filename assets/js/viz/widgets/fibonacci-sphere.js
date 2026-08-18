// The turn-fraction dial on a sphere: point i sits at height z = 1 - 2(i + ½)/N
// and is turned by 2π·i·γ around the axis. With γ = p/q the angles repeat every
// q points and the sphere collapses into q spokes; with γ = 1/φ they never do.
//
// Shortcode params (all optional):
//   n            initial point count            (default 500)
//   gamma        initial turn fraction in [0,1) (default 1/φ)
//   autorotate   slow spin                      (default true; off under reduced motion)
//   colorByIndex tint points along the spiral   (default false)
//   shell        opaque inner sphere hiding back-facing points (default true)
//   maxN         upper slider bound             (default 5000)

import { register } from "../core/mount.js";
import { buildControls } from "../core/controls.js";
import { turnFractionControls } from "../lib/golden.js";
import { createPointSphere } from "../lib/point-sphere.js";
import { fibonacciSphere } from "../lib/sphere-points.js";

export default function mount(root, params, ctx) {
  const maxN = Math.max(100, Math.floor(params.maxN ?? 5000));
  const ps = createPointSphere(ctx, { maxN, shell: params.shell ?? true });
  const positions = new Float32Array(maxN * 3);
  const colorA = new ps.THREE.Color();
  const colorB = new ps.THREE.Color();

  const gradient = (i, n, theme) => colorA.setHex(theme.primary.hex).lerp(colorB.setHex(theme.secondary.hex), i / (n - 1 || 1)).getHex();

  const layout = () => {
    const { n, gamma, colorByIndex } = controls.state;
    fibonacciSphere(positions, n, gamma);
    ps.setPoints(positions, n, colorByIndex ? gradient : null);
  };

  const controls = buildControls(
    ctx.controlsEl,
    [
      ...turnFractionControls(params, { maxN }),
      { type: "checkbox", key: "autorotate", label: "Auto-rotate", value: Boolean(params.autorotate ?? true) },
    ],
    (state, changed) => {
      if (changed.includes("n") || changed.includes("gamma") || changed.includes("colorByIndex")) layout();
      if (changed.includes("autorotate")) ps.view.setAutoRotate(state.autorotate);
    }
  );

  layout();
  ps.view.setAutoRotate(controls.state.autorotate);

  return {
    setTheme: (theme) => ps.setTheme(theme),
    destroy: () => ps.dispose(),
  };
}

register("fibonacci-sphere", mount);
