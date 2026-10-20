// Tiny UI toolkit: hash router, delegated actions, a form engine with validation, toasts.
import { Raw, esc, html, raw } from "../lib/html.js";
import { isValidISO, todayISO } from "../lib/dates.js";
import { parseMoney, toInput } from "../lib/money.js";

export const actions = {}; // name -> async (dataset, element, event)
const forms = new Map();
const routes = [];
let current = { path: "/", query: new URLSearchParams() };
let hooks = { afterRender: () => {} };

/* ---------- toasts ---------- */
export function toast(message, type = "success") {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = `alert alert-${type} shadow-sm mb-2`;
  el.setAttribute("role", "status");
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === "danger" ? 6000 : 3500);
}

/* ---------- router ---------- */
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ re, keys, handler });
}
export const currentRoute = () => current;

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, q = ""] = h.split("?");
  return { path: path || "/", query: new URLSearchParams(q) };
}

export async function render() {
  current = parseHash();
  forms.clear();
  const view = document.getElementById("view");
  let matched = null;
  for (const r of routes) {
    const m = r.re.exec(current.path);
    if (m) { matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
  }
  try {
    const out = matched
      ? await matched.r.handler({ params: matched.params, query: current.query })
      : { title: "Not found", html: html`<div class="empty-state"><i class="bi bi-signpost"></i><p>That page doesn't exist.</p><a class="btn btn-primary" href="#/">Back to dashboard</a></div>` };
    const result = out instanceof Raw ? { html: out } : out;
    view.innerHTML = result.html.s;
    view.dataset.route = location.hash.replace(/^#/, "") || "/"; // lets tests (and debugging) know which route is on screen
    document.title = `${result.title || "Home Finance"} · Home Finance`;
    window.scrollTo(0, 0);
    result.after?.(view);
  } catch (err) {
    console.error(err);
    view.innerHTML = html`<div class="alert alert-danger">Something went wrong showing this page: ${err.message}</div>`.s;
  }
  hooks.afterRender(current);
}
export const refresh = () => render();
export function navigate(path) {
  const target = "#" + path;
  if (location.hash === target) render(); else location.hash = target;
}
export function setHooks(h) { hooks = { ...hooks, ...h }; }

/** Set one query parameter on the current page and go there (used by filter dropdowns). */
export function setQuery(name, value) {
  const q = new URLSearchParams(current.query);
  if (value) q.set(name, value); else q.delete(name);
  const s = q.toString();
  navigate(current.path + (s ? "?" + s : ""));
}

/* ---------- forms ---------- */
const MAX_PAISE = 10_000_000_000_00;

function displayValue(f, spec) {
  if (spec.raw && f.name in spec.raw) return spec.raw[f.name];
  const v = spec.values?.[f.name];
  if (v == null) return f.default ?? "";
  if (f.type === "money") return toInput(v);
  return v;
}

function visible(f, spec) {
  return !f.showIf || String(displayValue({ name: f.showIf.field }, spec) ?? "") === String(f.showIf.value);
}

function fieldHtml(f, spec) {
  const id = `${spec.id}-${f.name}`;
  const err = spec.errors?.[f.name];
  const val = displayValue(f, spec);
  const cls = (base) => base + (err ? " is-invalid" : "");
  const attrs = html`id="${id}" name="${f.name}"`;
  // Fields with showIf appear only while another field has a given value (e.g. MHADA details for MHADA rooms).
  const cond = f.showIf ? html`data-show-if="${f.showIf.field}=${f.showIf.value}" ${visible(f, spec) ? "" : raw("hidden")}` : "";
  if (f.type === "checkbox") {
    const checked = spec.raw ? spec.raw[f.name] : spec.values?.[f.name] ?? f.default;
    return html`<div class="${f.cols || "col-12 col-md-6"} d-flex align-items-end" ${cond}><div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" ${attrs} ${checked ? raw("checked") : ""}>
      <label class="form-check-label" for="${id}">${f.label}</label></div></div>`;
  }
  const cols = f.type === "textarea" ? "col-12" : f.cols || "col-12 col-md-6";
  let control;
  if (f.type === "select") {
    control = html`<select class="${cls("form-select")}" ${attrs}>${f.options.map(([v, l]) =>
      html`<option value="${v ?? ""}" ${String(v ?? "") === String(val ?? "") ? raw("selected") : ""}>${l}</option>`)}</select>`;
  } else if (f.type === "textarea") {
    control = html`<textarea class="${cls("form-control")}" rows="3" ${attrs}>${val}</textarea>`;
  } else {
    const type = f.type === "date" ? "date" : "text";
    const mode = f.type === "money" || f.type === "number" ? 'inputmode="decimal"' : "";
    control = html`<input class="${cls("form-control")}" type="${type}" ${raw(mode)} ${attrs} value="${val}" ${f.placeholder ? raw(`placeholder="${esc(f.placeholder)}"`) : ""} autocomplete="off">`;
  }
  return html`<div class="${cols}" ${cond}><label class="form-label" for="${id}">${f.label}${f.required ? html` <span class="text-danger">*</span>` : ""}</label>
    ${control}${err ? html`<div class="invalid-feedback d-block">${err}</div>` : f.hint ? html`<div class="form-text">${f.hint}</div>` : ""}</div>`;
}

function renderForm(spec) {
  return html`<form data-form="${spec.id}" novalidate class="${spec.formClass || ""}">
    <div class="row g-3">${spec.fields.map((f) => fieldHtml(f, spec))}</div>
    ${spec.errors?._form ? html`<div class="alert alert-danger mt-3 mb-0">${spec.errors._form}</div>` : ""}
    <div class="d-flex gap-2 mt-4">
      <button class="btn ${spec.submitClass || "btn-primary"}" type="submit"><i class="bi bi-${spec.icon || "check2"}"></i> ${spec.submitLabel || "Save"}</button>
      ${spec.cancelHref ? html`<a class="btn btn-outline-secondary" href="${spec.cancelHref}">Cancel</a>` : ""}
    </div></form>`;
}

/** Register a form for this page and return its HTML. */
export function formHtml(spec) { forms.set(spec.id, spec); return renderForm(spec); }

function collect(spec, formEl) {
  const fd = new FormData(formEl);
  const values = {}, raws = {}, errors = {};
  for (const f of spec.fields) {
    if (f.showIf && String(fd.get(f.showIf.field) ?? "") !== String(f.showIf.value)) {
      // Hidden by its condition: not validated, and saved empty so stale values don't linger.
      values[f.name] = f.type === "checkbox" ? false : null; raws[f.name] = f.type === "checkbox" ? false : ""; continue;
    }
    const text = f.type === "checkbox" ? null : String(fd.get(f.name) ?? "");
    raws[f.name] = f.type === "checkbox" ? fd.has(f.name) : text;
    let v;
    if (f.type === "checkbox") v = fd.has(f.name);
    else if (f.type === "money") {
      v = parseMoney(text);
      if (Number.isNaN(v)) { errors[f.name] = "Enter an amount like 1500 or 1500.50."; v = null; }
      else if (v != null && v > MAX_PAISE) { errors[f.name] = "That amount is too large."; v = null; }
      else if (v != null && f.positive && v <= 0) errors[f.name] = "Must be more than zero.";
    } else if (f.type === "number") {
      const t = text.trim();
      v = t === "" ? null : Number(t);
      if (v != null && !Number.isFinite(v)) { errors[f.name] = "Enter a number."; v = null; }
      else if (v != null && f.int && !Number.isInteger(v)) errors[f.name] = "Enter a whole number.";
      else if (v != null && f.min != null && v < f.min) errors[f.name] = `Must be at least ${f.min}.`;
      else if (v != null && f.max != null && v > f.max) errors[f.name] = `Must be at most ${f.max}.`;
    } else if (f.type === "date") {
      const t = text.trim();
      v = t === "" ? null : t;
      if (v != null && !isValidISO(v)) { errors[f.name] = "Enter a valid date."; v = null; }
    } else if (f.type === "select") {
      v = text === "" ? null : f.cast === "int" ? Number(text) : text;
      if (v != null && !f.options.some(([o]) => String(o) === String(v))) errors[f.name] = "Not a valid choice.";
    } else {
      v = text.trim() === "" ? null : text.trim();
      if (v != null && f.max && v.length > f.max) errors[f.name] = `Keep this under ${f.max} characters.`;
    }
    if (f.required && (v == null || v === "") && !errors[f.name]) errors[f.name] = "This field is required.";
    values[f.name] = v;
  }
  return { values, raws, errors };
}

async function submitForm(formEl) {
  const spec = forms.get(formEl.dataset.form);
  if (!spec) return;
  const { values, raws, errors } = collect(spec, formEl);
  let problems = { ...errors };
  if (!Object.keys(problems).length && spec.validate) problems = { ...(await spec.validate(values)) };
  if (!Object.keys(problems).length) {
    try { await spec.onSubmit(values); return; }
    catch (e) { if (e.fieldErrors) problems = e.fieldErrors; else { console.error(e); problems = { _form: e.message || "Could not save." }; } }
  }
  spec.values = values; spec.raw = raws; spec.errors = problems;
  formEl.outerHTML = renderForm(spec).s;
  document.querySelector(`[data-form="${spec.id}"] .is-invalid`)?.focus();
}
export class FieldErrors extends Error { constructor(fieldErrors) { super("Invalid"); this.fieldErrors = fieldErrors; } }

/* ---------- download helper ---------- */
export function downloadFile(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- global events ---------- */
export function startRouter() {
  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    ev.preventDefault();
    try { await fn(el.dataset, el, ev); } catch (e) { console.error(e); toast(e.message || "Something went wrong.", "danger"); }
  });
  document.addEventListener("submit", (ev) => {
    if (ev.target.matches?.("form[data-form]")) { ev.preventDefault(); submitForm(ev.target); }
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target.closest?.("[data-filter]");
    if (el) setQuery(el.dataset.filter, el.value);
    const form = ev.target.closest?.("form[data-form]");
    if (form) for (const w of form.querySelectorAll("[data-show-if]")) {
      const [field, value] = w.dataset.showIf.split("=");
      w.hidden = String(form.elements[field]?.value ?? "") !== value;
    }
  });
  window.addEventListener("hashchange", render);
  return render();
}
export { todayISO };
