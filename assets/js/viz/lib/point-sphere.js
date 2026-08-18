// Shared renderer for "points on a sphere" widgets: an InstancedMesh of small
// spheres sitting on an opaque shell (so only the near hemisphere shows), lit
// from the camera, themed from ctx.theme. Widgets only supply positions.
//
//   const ps = createPointSphere(ctx, { maxN: 5000, shell: true });
//   ps.setPoints(positions /* Float32Array xyz, unit sphere */, n, colorFn?);
//   ps.view                // the three-scene view (controls, requestRender, …)
//   ps.setTheme(theme); ps.dispose();

import { makeScene, THREE } from "../core/three-scene.js";

export function createPointSphere(ctx, { maxN = 5000, shell = true, cameraDistance = 3.1, elevation = 28 } = {}) {
  const view = makeScene(ctx, { cameraDistance, elevation });
  const { scene, camera } = view;

  // Lighting rides with the camera so shading stays put while orbiting.
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 2, 3);
  camera.add(key);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  // Material stays white: per-instance colours (multiplied in) carry the theme.
  const pointGeo = new THREE.SphereGeometry(1, 12, 8);
  const pointMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const points = new THREE.InstancedMesh(pointGeo, pointMat, maxN);
  points.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  points.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 3), 3);
  points.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(points);

  // Opaque inner shell: without it the back points shine through and any
  // structure reads as a mess.
  const shellMat = new THREE.MeshLambertMaterial({ color: ctx.theme.surface.hex });
  const shellMesh = new THREE.Mesh(new THREE.SphereGeometry(0.985, 48, 32), shellMat);
  shellMesh.visible = shell;
  scene.add(shellMesh);

  const m = new THREE.Matrix4();
  const tmp = new THREE.Color();
  let theme = ctx.theme;
  let last = { positions: null, n: 0, colorFn: null };

  // positions: flat xyz array on the unit sphere; n: how many to draw;
  // colorFn(i, n, theme) -> hex, defaults to theme.primary.
  function setPoints(positions, n, colorFn = null) {
    last = { positions, n, colorFn };
    // Mean spacing between neighbours is ~sqrt(4π/N); size the dots relative to it.
    const spacing = Math.sqrt((4 * Math.PI) / Math.max(n, 1));
    const radius = Math.min(0.12, 0.27 * spacing);
    for (let i = 0; i < n; i++) {
      m.makeScale(radius, radius, radius);
      m.setPosition(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      points.setMatrixAt(i, m);
      tmp.setHex(colorFn ? colorFn(i, n, theme) : theme.primary.hex);
      points.setColorAt(i, tmp);
    }
    points.count = n;
    points.instanceMatrix.needsUpdate = true;
    points.instanceColor.needsUpdate = true;
    view.requestRender();
  }

  return {
    view,
    THREE,
    setPoints,
    setShell(on) {
      shellMesh.visible = Boolean(on);
      view.requestRender();
    },
    setTheme(next) {
      theme = next;
      shellMat.color.setHex(next.surface.hex);
      view.setTheme(next);
      if (last.positions) setPoints(last.positions, last.n, last.colorFn); // colours are baked per point
    },
    dispose() {
      view.dispose();
    },
  };
}
