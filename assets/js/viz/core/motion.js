// Animation plumbing shared by every widget: honour the OS "reduce motion"
// setting, and only spend frames while the figure is actually on screen and the
// tab is visible. A long post can hold half a dozen figures; without this they
// would all be burning requestAnimationFrame at once.

const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion() {
  return reduceQuery.matches;
}

export function onReducedMotionChange(cb) {
  const handler = (e) => cb(e.matches);
  reduceQuery.addEventListener("change", handler);
  return () => reduceQuery.removeEventListener("change", handler);
}

// createLoop(el, frame) drives `frame(dtSeconds, tSeconds)` on every animation
// frame while `el` is (partially) visible and the document is not hidden.
//   loop.start() / loop.stop()   - enable / disable the loop
//   loop.requestFrame()          - draw exactly one frame even if stopped
//                                  (render-on-demand for idle widgets)
//   loop.dispose()               - tear down observers
export function createLoop(el, frame) {
  let running = false; // caller wants continuous frames
  let visible = true; // element in viewport
  let rafId = 0;
  let pending = false; // a one-off frame was requested
  let last = 0;

  const tick = (now) => {
    rafId = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    const wantsFrame = pending || (running && visible && !document.hidden);
    pending = false;
    if (wantsFrame) frame(dt, now / 1000);
    if (running && visible && !document.hidden) schedule();
    else last = 0;
  };

  const schedule = () => {
    if (!rafId) rafId = requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) schedule();
    },
    { rootMargin: "100px" }
  );
  io.observe(el);

  const onVisibility = () => {
    if (!document.hidden) schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    start() {
      running = true;
      schedule();
    },
    stop() {
      running = false;
    },
    requestFrame() {
      pending = true;
      schedule();
    },
    get running() {
      return running;
    },
    dispose() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
