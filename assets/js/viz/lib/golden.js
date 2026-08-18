// The maths both "turn-fraction dial" widgets share: golden-ratio constants,
// the Fibonacci convergents used as snap presets, continued fractions, and the
// control-panel rows for N and γ so the disk and the sphere feel like one
// instrument.

export const PHI = (1 + Math.sqrt(5)) / 2;
export const INV_PHI = 1 / PHI; // 0.6180339887…

// Convergents p/q of 1/φ. Each one collapses the pattern into q straight arms.
export const SNAPS = [
  [1, 2],
  [1, 3],
  [2, 5],
  [3, 8],
  [5, 13],
  [8, 21],
  [13, 34],
];

// Continued fraction of x, at most `terms` partial quotients.
export function continuedFraction(x, terms = 8) {
  const out = [];
  let v = x;
  for (let i = 0; i < terms; i++) {
    const a = Math.floor(v);
    out.push(a);
    const frac = v - a;
    if (frac < 1e-9) break;
    v = 1 / frac;
    if (!Number.isFinite(v) || v > 1e6) break;
  }
  return out;
}

// Best rational approximation with denominator ≤ maxDen (last fitting convergent).
export function nearestFraction(x, maxDen = 100) {
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  let v = x;
  let best = [Math.round(x), 1];
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(v);
    const h = a * h1 + h0;
    const k = a * k1 + k0;
    if (k > maxDen) break;
    best = [h, k];
    h0 = h1; h1 = h; k0 = k1; k1 = k;
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  return best;
}

export function describeGamma(gamma) {
  const [p, q] = nearestFraction(gamma, 200);
  const cf = continuedFraction(gamma, 8);
  return `${p}/${q}   [${cf[0]}; ${cf.slice(1).join(", ")}${cf.length >= 8 ? ", …" : ""}]`;
}

// Control rows shared by the dial widgets. `params` are the shortcode params.
export function turnFractionControls(params, { maxN = 5000, minN = 10, defaultN = 500 } = {}) {
  return [
    { type: "range", key: "n", label: "Points N", min: minN, max: maxN, value: Math.floor(params.n ?? defaultN), scale: "log", integer: true },
    { type: "range", key: "gamma", label: "Turn fraction γ", min: 0, max: 1, step: 0.0001, value: params.gamma ?? INV_PHI, format: (g) => g.toFixed(4) },
    {
      type: "buttons",
      label: "Snap γ to",
      buttons: [
        ...SNAPS.map(([p, q]) => ({ label: `${p}/${q}`, patch: { gamma: p / q }, title: `${q} arms` })),
        { label: "1/φ", patch: { gamma: INV_PHI }, title: "the golden ratio — never snaps" },
      ],
    },
    { type: "readout", label: "γ ≈", render: (s) => describeGamma(s.gamma) },
    { type: "checkbox", key: "colorByIndex", label: "Colour by index", value: Boolean(params.colorByIndex ?? false) },
  ];
}
