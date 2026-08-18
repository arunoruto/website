// Entry point of the interactive-figure runtime. The `viz` shortcode
// (layouts/shortcodes/viz.html) renders
//
//   <figure class="viz" data-viz-widget="NAME" data-viz-params='{...}'>
//     <div class="viz__stage">…poster / noscript…</div>
//     <div class="viz__controls"></div>
//     <figcaption>…</figcaption>
//   </figure>
//
// and loads assets/js/viz/widgets/NAME.js, which ends with
// `register("NAME", mount)`. Registering scans the page for matching figures
// and mounts each one lazily, the first time it scrolls near the viewport.
//
// A widget is `mount(root, params, ctx) -> { destroy?(), setTheme?(theme) }`
// where ctx = { stage, controlsEl, theme, onThemeChange, onResize, reducedMotion, size }.
// It may also return a Promise of that handle.

import { readTheme, onThemeChange } from "./theme.js";
import { prefersReducedMotion } from "./motion.js";

const factories = new Map();
const mounted = new WeakMap(); // figure -> handle

function parseParams(fig) {
  const raw = fig.dataset.vizParams;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid data-viz-params JSON: ${err.message}`);
  }
}

function showError(fig, err) {
  fig.dataset.vizState = "error";
  const stage = fig.querySelector(".viz__stage");
  const box = document.createElement("div");
  box.className = "viz__error";
  box.setAttribute("role", "alert");
  box.textContent = `This figure failed to load (${err.message}).`;
  stage.append(box);
  console.error(`[viz:${fig.dataset.vizWidget}]`, err);
}

async function mountFigure(fig, factory) {
  if (mounted.has(fig)) return;
  fig.dataset.vizState = "mounting";
  const stage = fig.querySelector(".viz__stage");
  const controlsEl = fig.querySelector(".viz__controls");
  const disposers = [];

  const ctx = {
    stage,
    controlsEl,
    theme: readTheme(),
    reducedMotion: prefersReducedMotion(),
    size: () => ({ width: stage.clientWidth, height: stage.clientHeight }),
    onThemeChange(cb) {
      const off = onThemeChange(cb);
      disposers.push(off);
      return off;
    },
    onResize(cb) {
      const ro = new ResizeObserver(() => cb(ctx.size()));
      ro.observe(stage);
      const off = () => ro.disconnect();
      disposers.push(off);
      return off;
    },
  };

  try {
    const handle = (await factory(fig, parseParams(fig), ctx)) || {};
    if (handle.setTheme) ctx.onThemeChange((theme) => handle.setTheme(theme));
    mounted.set(fig, {
      destroy() {
        disposers.forEach((off) => off());
        handle.destroy?.();
        mounted.delete(fig);
        delete fig.dataset.vizState;
      },
    });
    fig.dataset.vizState = "ready";
  } catch (err) {
    disposers.forEach((off) => off());
    showError(fig, err);
  }
}

const lazy = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      lazy.unobserve(entry.target);
      const fig = entry.target;
      const factory = factories.get(fig.dataset.vizWidget);
      if (factory) mountFigure(fig, factory);
    }
  },
  { rootMargin: "300px 0px" }
);

function scan(name) {
  const factory = factories.get(name);
  const figures = document.querySelectorAll(`figure.viz[data-viz-widget="${name}"]:not([data-viz-state])`);
  for (const fig of figures) {
    fig.dataset.vizState = "queued";
    if (fig.dataset.vizEager !== undefined) mountFigure(fig, factory);
    else lazy.observe(fig);
  }
}

export function register(name, factory) {
  factories.set(name, factory);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scan(name), { once: true });
  } else {
    scan(name);
  }
}

// For the lab page and debugging from the console.
export function unmount(fig) {
  mounted.get(fig)?.destroy();
}
