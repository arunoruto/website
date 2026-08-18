// Declarative control panels for widgets. A widget hands over a spec and gets a
// state object back; the DOM, labels, live value readouts and two-way sync are
// handled here so every figure on the site looks and behaves the same.
//
//   const c = buildControls(ctx.controlsEl, [
//     { type: "range",    key: "n",     label: "Points", min: 10, max: 5000, value: 500, scale: "log", integer: true },
//     { type: "range",    key: "gamma", label: "γ",      min: 0,  max: 1,    value: 0.618, step: 0.0001, format: v => v.toFixed(4) },
//     { type: "checkbox", key: "spin",  label: "Auto-rotate", value: true },
//     { type: "select",   key: "mode",  label: "Colour", value: "flat", options: [{ value: "flat", label: "Flat" }] },
//     { type: "buttons",  label: "Snap γ to", buttons: [{ label: "1/2", patch: { gamma: 0.5 } }] },
//     { type: "readout",  label: "γ ≈", render: s => s.gamma.toFixed(6) },
//   ], (state, changedKeys) => redraw());
//
//   c.state        - current values (read-only by convention; use c.set)
//   c.set(patch)   - update values, sync inputs, fire onChange
//   c.update()     - refresh readouts/active buttons without changing state

let uid = 0;
const nextId = (key) => `viz-ctl-${key}-${++uid}`;

const LOG_STEPS = 1000;

function toRaw(item, value) {
  if (item.scale !== "log") return value;
  const t = Math.log(value / item.min) / Math.log(item.max / item.min);
  return Math.round(Math.max(0, Math.min(1, t)) * LOG_STEPS);
}

function fromRaw(item, raw) {
  let value = raw;
  if (item.scale === "log") value = item.min * Math.pow(item.max / item.min, raw / LOG_STEPS);
  if (item.integer) value = Math.round(value);
  return Math.max(item.min, Math.min(item.max, value));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "text") node.textContent = v;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

export function buildControls(container, spec, onChange) {
  // controls="none" renders no panel; keep the state machinery, drop the DOM.
  if (!container) container = document.createElement("div");
  const state = {};
  const inputs = new Map(); // key -> { item, input, output }
  const readouts = []; // { item, output }
  const buttonGroups = []; // { item, buttons: [{ def, button }] }

  for (const item of spec) {
    if (item.key !== undefined && item.value !== undefined) state[item.key] = item.value;
  }

  const format = (item, v) => (item.format ? item.format(v) : item.integer ? String(v) : String(+v.toPrecision(4)));

  const refresh = () => {
    for (const { item, input, output } of inputs.values()) {
      const v = state[item.key];
      if (item.type === "range") {
        input.value = toRaw(item, v);
        input.setAttribute("aria-valuetext", format(item, v));
        output.textContent = format(item, v);
      } else if (item.type === "checkbox") {
        input.checked = Boolean(v);
      } else if (item.type === "select") {
        input.value = String(v);
      }
    }
    for (const { item, output } of readouts) output.textContent = item.render(state);
    for (const { buttons } of buttonGroups) {
      for (const { def, button } of buttons) {
        const active = def.isActive ? def.isActive(state) : def.patch && Object.entries(def.patch).every(([k, v]) => state[k] === v);
        button.classList.toggle("is-active", Boolean(active));
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
    }
  };

  const set = (patch, { silent = false } = {}) => {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (state[k] === v) continue;
      state[k] = v;
      changed.push(k);
    }
    refresh();
    if (changed.length && !silent && onChange) onChange(state, changed);
  };

  for (const item of spec) {
    const row = el("div", { class: `viz__control viz__control--${item.type}` });

    if (item.type === "range") {
      if (item.scale === "log" && !(item.min > 0)) throw new Error(`viz controls: log-scale range "${item.key}" needs min > 0`);
      const id = nextId(item.key);
      const input = el("input", {
        type: "range",
        id,
        min: item.scale === "log" ? 0 : item.min,
        max: item.scale === "log" ? LOG_STEPS : item.max,
        step: item.scale === "log" ? 1 : item.step ?? (item.integer ? 1 : "any"),
      });
      const output = el("output", { for: id, class: "viz__value" });
      input.addEventListener("input", () => set({ [item.key]: fromRaw(item, Number(input.value)) }));
      row.append(el("label", { for: id, class: "viz__label", text: item.label }), input, output);
      inputs.set(item.key, { item, input, output });
    } else if (item.type === "checkbox") {
      const id = nextId(item.key);
      const input = el("input", { type: "checkbox", id });
      input.addEventListener("change", () => set({ [item.key]: input.checked }));
      row.append(el("label", { for: id, class: "viz__label", text: item.label }), input);
      inputs.set(item.key, { item, input });
    } else if (item.type === "select") {
      const id = nextId(item.key);
      const input = el(
        "select",
        { id },
        item.options.map((o) => el("option", { value: o.value, text: o.label ?? o.value }))
      );
      input.addEventListener("change", () => {
        const opt = item.options.find((o) => String(o.value) === input.value);
        set({ [item.key]: opt ? opt.value : input.value });
      });
      row.append(el("label", { for: id, class: "viz__label", text: item.label }), input);
      inputs.set(item.key, { item, input });
    } else if (item.type === "buttons") {
      const group = el("div", { class: "viz__buttons", role: "group", "aria-label": item.label });
      const buttons = item.buttons.map((def) => {
        const button = el("button", { type: "button", class: "viz__button", text: def.label });
        if (def.title) button.title = def.title;
        button.addEventListener("click", () => {
          if (def.patch) set(def.patch);
          if (def.onClick) def.onClick(state, set);
        });
        group.append(button);
        return { def, button };
      });
      row.append(el("span", { class: "viz__label", text: item.label }), group);
      buttonGroups.push({ item, buttons });
    } else if (item.type === "readout") {
      const output = el("output", { class: "viz__value viz__value--readout" });
      row.append(el("span", { class: "viz__label", text: item.label }), output);
      readouts.push({ item, output });
    } else {
      throw new Error(`viz controls: unknown control type "${item.type}"`);
    }
    container.append(row);
  }

  refresh();
  return { el: container, state, set, update: refresh };
}
