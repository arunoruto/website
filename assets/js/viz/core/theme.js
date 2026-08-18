// Bridges Blowfish's colour scheme into widgets. The scheme defines colours as
// bare RGB triplets on :root (e.g. `--color-primary-500: 59, 130, 246`, see
// themes/blowfish/assets/css/schemes/*.css) and flips dark mode by toggling the
// `dark` class on <html> (themes/blowfish/assets/js/appearance.js). Widgets get
// a resolved palette so they never hard-code colours and follow the appearance
// switcher live.

const ROOT = document.documentElement;

function readVar(name) {
  const raw = getComputedStyle(ROOT).getPropertyValue(name).trim();
  const parts = raw.split(",").map((s) => Number(s.trim()));
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : [128, 128, 128];
}

const css = (rgb, alpha = 1) =>
  alpha === 1 ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

// Pack an [r, g, b] triplet into a 0xRRGGBB integer, the form three.js's Color
// constructor and setHex() take.
const hex = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

export function isDark() {
  return ROOT.classList.contains("dark");
}

// Returns a palette in three shapes per swatch: `.rgb` triplet, `.css()` string
// and `.hex` integer. Semantic slots (fg/bg/muted/…) resolve to the right
// neutral shade for the current appearance so widgets can stay theme-agnostic.
export function readTheme() {
  const dark = isDark();
  const pick = (lightVar, darkVar) => readVar(dark ? darkVar : lightVar);
  const swatch = (rgb) => ({ rgb, hex: hex(rgb), css: (a = 1) => css(rgb, a) });
  return {
    isDark: dark,
    primary: swatch(readVar("--color-primary-500")),
    primarySoft: swatch(pick("--color-primary-300", "--color-primary-400")),
    primaryStrong: swatch(pick("--color-primary-700", "--color-primary-200")),
    secondary: swatch(readVar("--color-secondary-500")),
    fg: swatch(pick("--color-neutral-800", "--color-neutral-200")),
    muted: swatch(pick("--color-neutral-500", "--color-neutral-400")),
    faint: swatch(pick("--color-neutral-300", "--color-neutral-600")),
    bg: swatch(pick("--color-neutral", "--color-neutral-800")),
    surface: swatch(pick("--color-neutral-100", "--color-neutral-700")),
  };
}

// Calls `cb(theme)` whenever the appearance switcher flips <html class="dark">.
// Returns a disposer.
export function onThemeChange(cb) {
  let last = isDark();
  const observer = new MutationObserver(() => {
    const now = isDark();
    if (now === last) return;
    last = now;
    cb(readTheme());
  });
  observer.observe(ROOT, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
