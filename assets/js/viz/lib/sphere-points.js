// Point-placement recipes on the unit sphere. Each fills `out` (Float32Array,
// 3·maxN) and returns { count, rings } — `count` may differ from the target for
// the grid recipes, which can only produce whole rings.

import { INV_PHI } from "./golden.js";

export const METHODS = [
  { value: "grid", label: "θ × φ grid" },
  { value: "grid-sin", label: "grid, sin θ-scaled" },
  { value: "random", label: "uniform random" },
  { value: "fibonacci", label: "Fibonacci lattice" },
];

// Small seeded PRNG so "random" is reproducible until you reshuffle.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function put(out, i, theta, phi) {
  const s = Math.sin(theta);
  out[3 * i] = s * Math.cos(phi);
  out[3 * i + 1] = Math.cos(theta);
  out[3 * i + 2] = s * Math.sin(phi);
}

// θ×φ grid with N_θ rings (cell-centred, so no ring sits exactly on a pole) and
// the same N_φ on every ring.
export function gridSphere(out, target, maxN) {
  const rings = Math.max(2, Math.round(Math.sqrt(target / 2)));
  const perRing = Math.max(1, Math.round(target / rings));
  let i = 0;
  for (let a = 0; a < rings && i < maxN; a++) {
    const theta = ((a + 0.5) * Math.PI) / rings;
    for (let b = 0; b < perRing && i < maxN; b++) put(out, i++, theta, (2 * Math.PI * b) / perRing);
  }
  return { count: i, rings };
}

// Rings from pole to pole with Δθ = π/(N_θ − 1); the ring at θ gets
// nint(sin θ · 2π/Δθ) + 1 points, i.e. exactly one point at each pole.
function sinGridCount(rings) {
  const dTheta = Math.PI / (rings - 1);
  let total = 0;
  for (let a = 0; a < rings; a++) total += Math.round(Math.sin(a * dTheta) * ((2 * Math.PI) / dTheta)) + 1;
  return total;
}

export function sinGridSphere(out, target, maxN) {
  // Pick the ring count whose total lands closest to the target.
  let rings = 2;
  while (rings < 400 && sinGridCount(rings + 1) <= target) rings++;
  if (Math.abs(sinGridCount(rings + 1) - target) < Math.abs(sinGridCount(rings) - target)) rings++;
  const dTheta = Math.PI / (rings - 1);
  let i = 0;
  for (let a = 0; a < rings && i < maxN; a++) {
    const theta = a * dTheta;
    const perRing = Math.round(Math.sin(theta) * ((2 * Math.PI) / dTheta)) + 1;
    for (let b = 0; b < perRing && i < maxN; b++) put(out, i++, theta, (2 * Math.PI * b) / perRing);
  }
  return { count: i, rings };
}

export function randomSphere(out, n, seed = 1) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const y = 2 * rnd() - 1;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = 2 * Math.PI * rnd();
    out[3 * i] = r * Math.cos(phi);
    out[3 * i + 1] = y;
    out[3 * i + 2] = r * Math.sin(phi);
  }
  return { count: n, rings: 0 };
}

// Fibonacci lattice, height rule z_i = 1 - 2(i+ε)/(N-1+2ε) (Roberts' offset form).
// ε = ½ is exactly the cell-centred z_i = 1 - (2i+1)/N used in the text; ε = 0
// puts the first and last point on the poles; ε > ½ opens a small bald spot at
// each pole so the tightest pair (points 0 and 3, and their mirror images) can
// breathe. One formula for every ε so the slider has no seam.
export const FIB_EPS_DEFAULT = 0.5;

export function fibonacciSphere(out, n, gamma = INV_PHI, eps = FIB_EPS_DEFAULT) {
  const denom = Math.max(n - 1 + 2 * eps, 1e-9); // n = 1, ε = 0 would divide by zero
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + eps)) / denom;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = 2 * Math.PI * i * gamma;
    out[3 * i] = r * Math.cos(phi);
    out[3 * i + 1] = y;
    out[3 * i + 2] = r * Math.sin(phi);
  }
  return { count: n, rings: 0 };
}

export function placePoints(method, out, n, { maxN = n, seed = 1, gamma = INV_PHI, eps = FIB_EPS_DEFAULT } = {}) {
  if (method === "grid") return gridSphere(out, n, maxN);
  if (method === "grid-sin") return sinGridSphere(out, n, maxN);
  if (method === "random") return randomSphere(out, n, seed);
  return fibonacciSphere(out, n, gamma, eps);
}

// ---------------------------------------------------------------------------
// Spacing statistics. Both the nearest-neighbour pass and the covering radius
// start from the same neighbour lists, so a widget computes those once:
//
//   const lists = neighbourLists(pts, n);
//   const d = nearestNeighbourDistances(pts, n, lists);   // radians, per point
//   const hole = largestHole(pts, n, lists);              // radians
// ---------------------------------------------------------------------------

const clampAcos = (dot) => Math.acos(Math.max(-1, Math.min(1, dot)));

// Enough neighbours that the rim points of the largest empty cap are on each
// other's lists (they sit ≤ 2R apart; π(2R)² / (4π/N) ≈ 55 points for the
// worst case the sliders reach, random N = 3000 with R ≈ 2.1 ideal spacings).
export const NEIGHBOURS = 56;

// The k nearest neighbours of every point, nearest first, as parallel arrays
// idx (which point) and dot (its dot product = cos of the angular distance).
// Points are visited in order of height y, walking outward from the point's
// own rank in both directions and stopping once |Δy| exceeds the angle to the
// current k-th nearest: |Δy| never exceeds the angular distance, so nothing
// closer can lie beyond. Candidates are kept in a min-heap of size k (root =
// farthest kept, O(log k) per insertion) and sorted nearest-first at the end.
// The band holds ~√(kN) points, so this is O(N√(kN)) rather than O(N²) —
// a modest win at these N (a few ms at N = 1000, tens of ms at 3000).
export function neighbourLists(pts, n, k = NEIGHBOURS) {
  k = Math.min(k, n - 1);
  const idx = new Int32Array(n * k);
  const dot = new Float64Array(n * k);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[3 * b + 1] - pts[3 * a + 1]);
  const rank = new Int32Array(n);
  order.forEach((p, r) => (rank[p] = r));
  // A copy in that order so the walk streams through memory instead of hopping.
  const sp = new Float64Array(n * 3);
  for (let r = 0; r < n; r++) {
    const j = order[r];
    sp[3 * r] = pts[3 * j]; sp[3 * r + 1] = pts[3 * j + 1]; sp[3 * r + 2] = pts[3 * j + 2];
  }

  // heap helpers on the slice [base, base + k)
  const siftDown = (base, cnt) => {
    let s = 0;
    for (;;) {
      const l = 2 * s + 1, r = l + 1;
      let m = s;
      if (l < cnt && dot[base + l] < dot[base + m]) m = l;
      if (r < cnt && dot[base + r] < dot[base + m]) m = r;
      if (m === s) return;
      const td = dot[base + s], ti = idx[base + s];
      dot[base + s] = dot[base + m]; idx[base + s] = idx[base + m];
      dot[base + m] = td; idx[base + m] = ti;
      s = m;
    }
  };
  const siftUp = (base, s) => {
    while (s > 0) {
      const parent = (s - 1) >> 1;
      if (dot[base + parent] <= dot[base + s]) return;
      const td = dot[base + s], ti = idx[base + s];
      dot[base + s] = dot[base + parent]; idx[base + s] = idx[base + parent];
      dot[base + parent] = td; idx[base + parent] = ti;
      s = parent;
    }
  };

  for (let i = 0; i < n; i++) {
    const xi = pts[3 * i], yi = pts[3 * i + 1], zi = pts[3 * i + 2];
    const base = i * k;
    let cnt = 0;
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let r = rank[i] + dir; r >= 0 && r < n; r += dir) {
        const yj = sp[3 * r + 1];
        // Stop once |Δy| exceeds the angle to the k-th nearest, i.e. once
        // cos|Δy| < its dot; cos x ≤ 1 − x²/2 + x⁴/24 makes that test sqrt-free.
        if (cnt === k) {
          const dy = yj - yi, dy2 = dy * dy;
          if (1 - dy2 / 2 + (dy2 * dy2) / 24 < dot[base]) break;
        }
        const d = xi * sp[3 * r] + yi * yj + zi * sp[3 * r + 2];
        if (cnt < k) {
          dot[base + cnt] = d; idx[base + cnt] = order[r];
          siftUp(base, cnt++);
        } else if (d > dot[base]) {
          dot[base] = d; idx[base] = order[r];
          siftDown(base, k);
        }
      }
    }
    // nearest first: sort the k entries by decreasing dot (k is small)
    const perm = Array.from({ length: k }, (_, s) => s).sort((a, b) => dot[base + b] - dot[base + a]);
    const sd = perm.map((s) => dot[base + s]), si = perm.map((s) => idx[base + s]);
    for (let s = 0; s < k; s++) { dot[base + s] = sd[s]; idx[base + s] = si[s]; }
  }
  return { k, idx, dot };
}

// Nearest-neighbour great-circle distance (radians) for each of the first n
// points — the first column of the neighbour lists.
export function nearestNeighbourDistances(pts, n, lists = neighbourLists(pts, n, 1)) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = clampAcos(lists.dot[i * lists.k]);
  return out;
}

// Largest dot product between direction (x, y, z) and any of the n points.
function nearestDot(pts, n, x, y, z) {
  let best = -1;
  for (let j = 0; j < n; j++) {
    const d = x * pts[3 * j] + y * pts[3 * j + 1] + z * pts[3 * j + 2];
    if (d > best) best = d;
  }
  return best;
}

// Covering radius: the largest empty cap, computed exactly rather than
// estimated (random probes, the usual shortcut, under-read it by 5–10 %).
// Its centre is a Voronoi vertex — the circumcentre of a triangle of sample
// points whose circumcircle holds no other point — and every such triangle is
// a point plus two of its neighbours, so the search is local: for each point,
// each pair among its neighbours defines a circle; it is skipped unless it
// beats the record and dropped if any listed neighbour lies inside. A point
// inside is within 2R of the vertex, so once the farthest listed neighbour is
// beyond 2R the local check is conclusive; otherwise (rare) everything is
// scanned. A cheap hill-climb from a few probes and the two poles seeds the
// record within ~1 % of the answer first, so nearly every pair is rejected by
// one comparison and no square root. Assumes no empty cap exceeds a hemisphere
// (true for N ≳ 6).
export function largestHole(pts, n, lists = neighbourLists(pts, n)) {
  if (n < 2) return Math.PI;
  const K = lists.k;
  const TOL = 1e-6; // pts is Float32; a point this far "inside" is on the circle
  const ideal = Math.sqrt((4 * Math.PI) / n);

  // 1. Lower bound: climb from the poles and the deepest of a few probes.
  const rnd = mulberry32(12345);
  const seeds = [[0, 1, 0], [0, -1, 0]];
  const probes = [];
  for (let m = 0; m < 400; m++) {
    const y = 2 * rnd() - 1, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = 2 * Math.PI * rnd();
    const x = r * Math.cos(phi), z = r * Math.sin(phi);
    probes.push([nearestDot(pts, n, x, y, z), x, y, z]);
  }
  probes.sort((a, b) => a[0] - b[0]);
  for (let m = 0; m < 8; m++) seeds.push(probes[m].slice(1));
  let cosWorst = 1;
  for (let [x, y, z] of seeds) {
    let best = nearestDot(pts, n, x, y, z);
    let step = ideal * 0.5;
    for (let s = 0; s < 16; s++) {
      let bd = -1, jb = 0;
      for (let j = 0; j < n; j++) {
        const d = x * pts[3 * j] + y * pts[3 * j + 1] + z * pts[3 * j + 2];
        if (d > bd) { bd = d; jb = j; }
      }
      // step along the tangent, away from the nearest point
      let tx = x * bd - pts[3 * jb], ty = y * bd - pts[3 * jb + 1], tz = z * bd - pts[3 * jb + 2];
      const tn = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tn < 1e-12) break;
      let nx = x + (step / tn) * tx, ny = y + (step / tn) * ty, nz = z + (step / tn) * tz;
      const nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= nn; ny /= nn; nz /= nn;
      const d2 = nearestDot(pts, n, nx, ny, nz);
      if (d2 < best) { x = nx; y = ny; z = nz; best = d2; } // smaller dot = deeper
      else step *= 0.5;
    }
    if (best < cosWorst) cosWorst = best;
  }

  // 2. Exact: every empty circumcircle that beats the record. Its rim points
  // lie within 2R of each other, i.e. among the first ~4πρ² neighbours (ρ = R
  // in ideal spacings), so the pair loop can stop well short of K when the
  // holes are small — which is every recipe except random.
  const rho = clampAcos(cosWorst) / ideal;
  const KP = Math.min(K, Math.ceil(4 * Math.PI * rho * rho * 1.5) + 8);
  const A = new Float64Array(K * 3); // neighbour offsets from the current point
  const Q = new Float64Array(K * 3); // neighbour positions
  for (let i = 0; i < n; i++) {
    const xi = pts[3 * i], yi = pts[3 * i + 1], zi = pts[3 * i + 2];
    const base = i * K;
    for (let a = 0; a < K; a++) {
      const j = lists.idx[base + a];
      Q[3 * a] = pts[3 * j]; Q[3 * a + 1] = pts[3 * j + 1]; Q[3 * a + 2] = pts[3 * j + 2];
      A[3 * a] = Q[3 * a] - xi; A[3 * a + 1] = Q[3 * a + 1] - yi; A[3 * a + 2] = Q[3 * a + 2] - zi;
    }
    const far = lists.dot[base + K - 1]; // cos of the angle to the farthest listed neighbour
    const cw2 = cosWorst * cosWorst;
    for (let a = 0; a < KP; a++) {
      const ax = A[3 * a], ay = A[3 * a + 1], az = A[3 * a + 2];
      for (let b = a + 1; b < KP; b++) {
        // circumcentre direction = normal of the triangle's plane
        let cx = ay * A[3 * b + 2] - az * A[3 * b + 1];
        let cy = az * A[3 * b] - ax * A[3 * b + 2];
        let cz = ax * A[3 * b + 1] - ay * A[3 * b];
        const c2 = cx * cx + cy * cy + cz * cz;
        let cd = cx * xi + cy * yi + cz * zi; // = |c|·cos R
        if (cd * cd >= cw2 * c2) continue; // R ≤ record (or degenerate)
        const nc = Math.sqrt(c2);
        if (nc < 1e-12) continue;
        cx /= nc; cy /= nc; cz /= nc; cd /= nc;
        if (cd < 0) { cx = -cx; cy = -cy; cz = -cz; cd = -cd; }
        let inside = false;
        for (let q = 0; q < K; q++) {
          if (cx * Q[3 * q] + cy * Q[3 * q + 1] + cz * Q[3 * q + 2] > cd + TOL) { inside = true; break; }
        }
        if (inside) continue;
        if (2 * cd * cd - 1 < far && nearestDot(pts, n, cx, cy, cz) > cd + TOL) continue; // cos 2R < cos(reach): full scan
        cosWorst = cd;
      }
    }
  }
  return clampAcos(cosWorst);
}
