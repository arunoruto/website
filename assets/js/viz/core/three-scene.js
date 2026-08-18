// Shared three.js boilerplate for 3D widgets: renderer sized to the stage,
// orbit controls, theme-aware clear colour and a frame loop that only renders
// when something changed (camera damping, auto-rotate, or an explicit
// requestRender()) and only while the figure is on screen.
//
//   const view = makeScene(ctx, { cameraDistance: 3.2 });
//   view.scene.add(...);
//   view.onFrame((dt) => { ...animate... });   // optional
//   view.setAutoRotate(true);
//   view.requestRender();
//   ...
//   view.dispose();
//
// "three" stays a bare specifier: layouts/shortcodes/viz.html marks it external
// for js.Build and the import map in layouts/partials/extend-head-uncached.html
// resolves it to the vendored assets/lib/three/three.module.min.js.

import * as THREE from "three";
import { OrbitControls } from "../../../lib/three/OrbitControls.js";
import { createLoop } from "./motion.js";

export { THREE };

export function makeScene(ctx, opts = {}) {
  const { fov = 38, cameraDistance = 3.2, elevation = 0, autoRotateSpeed = 0.6, maxPixelRatio = 2, transparent = true } = opts;
  const stage = ctx.stage;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.domElement.classList.add("viz__canvas");
  stage.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
  // `elevation` (degrees) tilts the start view so the pole is in sight.
  const el = (elevation * Math.PI) / 180;
  camera.position.set(0, cameraDistance * Math.sin(el), cameraDistance * Math.cos(el));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7;
  controls.minDistance = cameraDistance * 0.5;
  controls.maxDistance = cameraDistance * 2.5;
  controls.autoRotateSpeed = autoRotateSpeed;
  controls.autoRotate = false;

  let frameCb = null;
  let needsRender = true;

  const applyTheme = (theme) => {
    if (transparent) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(theme.surface.hex, 1);
    needsRender = true;
  };
  applyTheme(ctx.theme);

  const resize = () => {
    const { width, height } = ctx.size();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    needsRender = true;
    loop.requestFrame();
  };
  ctx.onResize(resize);

  const loop = createLoop(stage, (dt, t) => {
    const moved = controls.update(dt);
    if (frameCb && frameCb(dt, t) !== false) needsRender = true;
    if (moved || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  });
  loop.start();
  controls.addEventListener("change", () => loop.requestFrame());
  resize();

  const view = {
    THREE,
    renderer,
    scene,
    camera,
    controls,
    canvas: renderer.domElement,
    loop,
    // Register a per-frame callback. Return `false` from it to signal that
    // nothing changed and no re-render is needed.
    onFrame(cb) {
      frameCb = cb;
    },
    setAutoRotate(on) {
      controls.autoRotate = Boolean(on) && !ctx.reducedMotion;
      loop.requestFrame();
    },
    requestRender() {
      needsRender = true;
      loop.requestFrame();
    },
    setTheme(theme) {
      applyTheme(theme);
      loop.requestFrame();
    },
    resize,
    dispose() {
      loop.dispose();
      controls.dispose();
      scene.traverse((obj) => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose?.());
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return view;
}
