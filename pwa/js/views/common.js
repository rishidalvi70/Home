import { L } from "../constants.js";
import { html, raw } from "../lib/html.js";

export const STATUS_STYLES = {
  paid: ["success", "Paid"], partial: ["warning", "Partly paid"], unpaid: ["secondary", "Unpaid"],
  upcoming: ["primary", "Upcoming"], overdue: ["danger", "Overdue"], due_today: ["warning", "Due today"],
  cancelled: ["dark", "Cancelled"], not_mine: ["info", "Not mine to pay"], active: ["success", "Active"],
  paused: ["secondary", "Paused"], closed: ["dark", "Closed"],
};
export function badge(status) {
  const [tone, label] = STATUS_STYLES[status] || ["secondary", String(status).replace(/_/g, " ")];
  return html`<span class="badge badge-soft text-bg-${tone}">${label}</span>`;
}

export const pageHeader = (title, subtitle, actions = "") => html`<div class="page-header">
  <div><h1>${title}</h1>${subtitle ? html`<p class="text-muted mb-0">${subtitle}</p>` : ""}</div>
  <div class="page-actions">${actions}</div></div>`;

export const stat = (title, value, icon = "cash-stack", tone = "primary", sub = "") => html`<div class="stat-card">
  <div class="stat-icon tone-${tone}"><i class="bi bi-${icon}"></i></div>
  <div class="min-w-0"><div class="stat-label">${title}</div><div class="stat-value">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ""}</div></div>`;

export const empty = (message) => html`<div class="empty-state"><i class="bi bi-inbox"></i><p class="mb-0">${message}</p></div>`;
export const card = (header, body, extra = "") => html`<div class="card ${extra}">${header ? html`<div class="card-header">${header}</div>` : ""}${body}</div>`;
export const tableCard = (inner) => html`<div class="card table-card">${inner}</div>`;
export const responsive = (inner) => html`<div class="table-responsive">${inner}</div>`;

export const actionBtn = (action, label, data = {}, cls = "btn btn-sm btn-outline-danger", icon = "") => {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${String(v).replace(/"/g, "&quot;")}"`).join(" ");
  return html`<button type="button" class="${cls}" data-action="${action}" ${raw(attrs)}>${icon ? html`<i class="bi bi-${icon}"></i> ` : ""}${label}</button>`;
};
export const kv = (pairs) => html`<dl class="kv">${pairs.map(([k, v, cls]) => html`<dt>${k}</dt><dd class="${cls || ""}">${v}</dd>`)}</dl>`;
export const byId = (list) => new Map(list.map((x) => [x.id, x]));
export const optionsOf = (list, label = (x) => x.name, blank = null) => [...(blank ? [[null, blank]] : []), ...list.map((x) => [x.id, label(x)])];
export const monthNav = (label, prevHref, nextHref) => html`<div class="d-flex align-items-center gap-2 mb-3">
  <a class="btn btn-outline-secondary" href="${prevHref}" aria-label="Previous month"><i class="bi bi-chevron-left"></i></a>
  <strong class="px-2">${label}</strong>
  <a class="btn btn-outline-secondary" href="${nextHref}" aria-label="Next month"><i class="bi bi-chevron-right"></i></a></div>`;
export const kindLabel = (k) => L.kind[k] || k;
