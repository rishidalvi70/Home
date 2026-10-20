import { db } from "../db.js";
import { COLLECTORS, CONNECTION_KINDS, L, OCCUPANCY } from "../constants.js";
import { billStatus } from "../domain/bills.js";
import { obReceived, obStatus, buildRevision, revisionChange, revisionPercent, suggestedNewRent, rentFor } from "../domain/rent.js";
import { describe, propertyCascade, propertyKind, tenantCascade, total } from "../domain/cascade.js";
import { propertyReport } from "../domain/reports.js";
import { fyStart, formatDate, monthStart, todayISO } from "../lib/dates.js";
import { html } from "../lib/html.js";
import { inr } from "../lib/money.js";
import { FieldErrors, actions, formHtml, navigate, refresh, toast } from "../ui/core.js";
import { actionBtn, badge, card, empty, kv, pageHeader, responsive } from "./common.js";

const text = (name, label, extra = {}) => ({ name, label, type: "text", max: 200, ...extra });
const area = (name, label) => ({ name, label, type: "textarea", max: 4000 });

const KINDS = [["mhada", "MHADA"], ["private", "Private"]];
const isMhada = { field: "propertyKind", value: "mhada" };
/** Rooms nobody pays rent for - the "rent collected by" question doesn't apply. */
const NO_RENT = ["self_occupied", "under_development"];

export function propertyFields() {
  return [
    text("name", "Room / property name", { required: true, max: 120 }),
    { name: "propertyKind", label: "Property category", type: "select", options: KINDS, hint: "MHADA rooms have a room number and ward. Private properties only need an address." },
    { name: "occupancyStatus", label: "Occupancy", type: "select", options: OCCUPANCY },
    text("mhadaRoomNo", "MHADA room number", { max: 60, showIf: isMhada }),
    text("wardName", "Ward name", { max: 120, showIf: isMhada }),
    text("wardNumber", "Ward number", { max: 30, showIf: isMhada }),
    area("address", "Address"),
    text("propertyType", "Property type (room, flat, shop…)", { max: 60 }), text("ownership", "Ownership / relationship", { max: 120 }),
    { name: "rentCollectedBy", label: "Rent is collected by", type: "select", options: COLLECTORS, showIf: { field: "occupancyStatus", not: NO_RENT } },
    { name: "areaSqft", label: "Area (sq ft)", type: "number", min: 0 }, area("spaceDetails", "Space / room details"), area("notes", "Notes"),
  ];
}

/** Private properties don't use MHADA details - never keep stale ones. */
const cleanKind = (v) => {
  const out = v.propertyKind === "private" ? { ...v, mhadaRoomNo: null, wardName: null, wardNumber: null } : { ...v };
  out.rentCollectedBy = out.rentCollectedBy || "me"; // hidden for rooms nobody rents; "me" is the safe default
  return out;
};

/* ---------- list ---------- */
export async function list({ query }) {
  const showArchived = query.get("archived") === "1";
  const snap = await db.loadAll();
  const props = snap.properties.filter((p) => showArchived || !p.archivedAt).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id);
  const cards = props.map((p) => {
    const t = snap.tenants.find((x) => x.propertyId === p.id && x.isActive);
    return html`<div class="col-12 col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
      <div class="d-flex justify-content-between align-items-start gap-2"><div>
        <h2 class="h5 mb-1"><a class="text-decoration-none" href="#/properties/${p.id}">${p.name}</a></h2>
        <div class="text-muted small">${propertyKind(p) === "private" ? (p.address ? p.address.split("\n")[0] : "Private · address not added")
          : `${p.mhadaRoomNo ? `MHADA ${p.mhadaRoomNo}` : "MHADA no. not added"}${p.wardName || p.wardNumber ? ` · Ward ${p.wardName || ""} ${p.wardNumber || ""}` : ""}`}</div></div>
        <div class="text-end"><span class="badge badge-soft text-bg-secondary">${L.occupancy[p.occupancyStatus] || p.occupancyStatus}</span> <span class="badge badge-soft ${propertyKind(p) === "private" ? "text-bg-info" : "text-bg-primary"}">${propertyKind(p) === "private" ? "Private" : "MHADA"}</span>${p.archivedAt ? html`<br><span class="badge badge-soft text-bg-warning mt-1">Archived</span>` : ""}</div></div>
      <hr class="my-3">
      ${t ? html`<div class="d-flex justify-content-between"><span class="text-muted">Tenant</span><strong>${t.name}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Monthly rent</span><strong>${inr(t.monthlyRent)}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Rent goes to</span><strong>${L.collector[p.rentCollectedBy]}</strong></div>`
        : p.occupancyStatus === "self_occupied" ? html`<p class="text-muted mb-0">You live here.</p>` : html`<p class="text-muted mb-0">No tenant recorded.</p>`}
      <div class="mt-auto pt-3 d-flex gap-2"><a class="btn btn-sm btn-outline-primary" href="#/properties/${p.id}">Open</a><a class="btn btn-sm btn-outline-secondary" href="#/properties/${p.id}/edit">Edit</a></div>
    </div></div></div>`;
  });
  return { title: "Rooms & tenants", html: html`${pageHeader("Rooms & tenants", "Every property you own or manage", html`
    <a class="btn btn-outline-secondary" href="#/properties${showArchived ? "" : "?archived=1"}"><i class="bi bi-archive"></i> ${showArchived ? "Hide archived" : "Show archived"}</a>
    <a class="btn btn-primary" href="#/properties/new"><i class="bi bi-plus-lg"></i> Add Property / Room</a>`)}
    <div class="row g-3">${cards.length ? cards : html`<div class="col-12 card card-body">${empty("No properties yet. Click “Add Property / Room”.")}</div>`}</div>` };
}

/* ---------- add / edit ---------- */
export async function newProperty() {
  const spec = { id: "property", fields: propertyFields(), values: { propertyKind: "mhada", occupancyStatus: "vacant", rentCollectedBy: "me" }, cancelHref: "#/properties",
    async onSubmit(v) {
      const all = await db.all("properties");
      const p = await db.put("properties", { ...cleanKind(v), sortOrder: Math.max(0, ...all.map((x) => x.sortOrder || 0)) + 1, archivedAt: null });
      toast(`Added ${p.name}.`); navigate(`/properties/${p.id}`);
    } };
  return { title: "Add property", html: html`${pageHeader("Add property / room")}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}

export async function editProperty({ params }) {
  const p = await db.get("properties", Number(params.id));
  if (!p) return notFound();
  const spec = { id: "property", fields: propertyFields(), values: { ...p, propertyKind: propertyKind(p) }, cancelHref: `#/properties/${p.id}`,
    async onSubmit(v) { await db.put("properties", { ...p, ...cleanKind(v) }); toast("Property updated."); navigate(`/properties/${p.id}`); } };
  return { title: `Edit ${p.name}`, html: html`${pageHeader(`Edit ${p.name}`)}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}
export const notFound = () => ({ title: "Not found", html: html`<div class="empty-state"><i class="bi bi-signpost"></i><p>That record doesn't exist (it may have been deleted).</p><a class="btn btn-primary" href="#/">Back to dashboard</a></div>` });

/* ---------- detail ---------- */
export async function detail({ params, query }) {
  const id = Number(params.id);
  const snap = await db.loadAll();
  const prop = snap.properties.find((p) => p.id === id);
  if (!prop) return notFound();
  const today = todayISO();
  const period = query.get("period") || "all";
  const start = { month: monthStart(today), fy: fyStart(today) }[period] || null;
  const r = propertyReport(snap, id, start);
  const tenants = snap.tenants.filter((t) => t.propertyId === id).sort((a, b) => Number(b.isActive) - Number(a.isActive) || (b.startDate || "").localeCompare(a.startDate || ""));
  const conns = snap.connections.filter((c) => c.propertyId === id);
  const obligations = snap.obligations.filter((o) => o.propertyId === id).sort((a, b) => b.periodStart.localeCompare(a.periodStart)).slice(0, 12);
  const bills = snap.bills.filter((b) => b.propertyId === id).sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || "") || b.id - a.id).slice(0, 15);

  const tenantCards = tenants.map((t, i) => {
    const revs = snap.revisions.filter((x) => x.tenantId === t.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return html`<div class="${i < tenants.length - 1 ? "mb-4 pb-4 border-bottom" : ""}">
      <div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><h3 class="h6 mb-0">${t.name} ${t.isActive ? html`<span class="badge badge-soft text-bg-success">Current</span>` : html`<span class="badge badge-soft text-bg-secondary">Former</span>`}</h3>
        <div class="d-flex flex-wrap gap-2"><a class="btn btn-sm btn-outline-primary" href="#/tenants/${t.id}/increment"><i class="bi bi-graph-up-arrow"></i> Record increment</a>
          <a class="btn btn-sm btn-outline-secondary" href="#/tenants/${t.id}/edit">Edit</a>${t.isActive ? actionBtn("end-tenancy", "End tenancy", { id: t.id }, "btn btn-sm btn-outline-warning") : ""}${actionBtn("delete-tenant", "Delete", { id: t.id })}</div></div>
      <div class="row g-3"><div class="col-12 col-lg-6">${kv([
        ["Phone / email", `${t.phone || "—"}${t.email ? " · " + t.email : ""}`],
        ["Tenancy", `${formatDate(t.startDate)} → ${t.endDate ? formatDate(t.endDate) : "ongoing"}`],
        ["Monthly rent", html`<strong>${inr(t.monthlyRent)}</strong> due on day ${t.rentDueDay}`],
        ["Security deposit", html`${inr(t.securityDeposit)} <span class="text-muted small">(not income)</span>`],
        ["Planned increment", html`${t.incrementPercent != null ? `${t.incrementPercent}%` : "—"}${t.nextIncrementDate ? html` on ${formatDate(t.nextIncrementDate)}${t.nextIncrementDate <= today ? html` <span class="badge text-bg-warning">due now</span>` : ""}` : ""}`],
        ["Notes", t.notes || "—"]])}</div>
      <div class="col-12 col-lg-6"><div class="small text-muted mb-1">Rent increment history</div>
        ${revs.length ? responsive(html`<table class="table table-sm"><thead><tr><th>From</th><th>Old</th><th>New</th><th>Change</th><th></th></tr></thead><tbody>
          ${revs.map((x) => html`<tr><td>${formatDate(x.effectiveFrom)}</td><td>${inr(x.oldRent)}</td><td>${inr(x.newRent)}</td>
            <td>${inr(revisionChange(x))}${revisionPercent(x) != null ? ` (${revisionPercent(x)}%)` : ""}</td>
            <td class="text-end">${actionBtn("delete-revision", "✕", { id: x.id }, "btn btn-sm btn-outline-danger py-0")}</td></tr>
            ${x.reason ? html`<tr><td colspan="5" class="small text-muted border-0 pt-0">${x.reason}</td></tr>` : ""}`)}</tbody></table>`)
          : html`<p class="text-muted small mb-0">No increments recorded yet.</p>`}</div></div></div>`;
  });

  const body = html`${pageHeader(prop.name, `${propertyKind(prop) === "private" ? "Private" : "MHADA"} · ${L.occupancy[prop.occupancyStatus]}${prop.archivedAt ? " · archived" : ""}`, html`
    <a class="btn btn-outline-secondary" href="#/properties"><i class="bi bi-arrow-left"></i> All rooms</a>
    <a class="btn btn-primary" href="#/properties/${id}/edit"><i class="bi bi-pencil"></i> Edit</a>
    ${prop.archivedAt ? actionBtn("restore-property", "Restore", { id }, "btn btn-success", "arrow-counterclockwise") : actionBtn("archive-property", "Archive", { id }, "btn btn-outline-secondary", "archive")}
    ${actionBtn("delete-property", "Delete", { id }, "btn btn-outline-danger", "trash")}`)}
  <div class="row g-3">
    <div class="col-12 col-xl-6">${card("Details", html`<div class="card-body">${kv([
      ["Category", propertyKind(prop) === "private" ? "Private" : "MHADA"],
      ...(propertyKind(prop) === "mhada" ? [["MHADA room no.", prop.mhadaRoomNo || "—"], ["Ward", `${prop.wardName || "—"}${prop.wardNumber ? ` (${prop.wardNumber})` : ""}`]] : []),
      ["Address", prop.address || "—"], ["Property type", prop.propertyType || "—"], ["Ownership", prop.ownership || "—"],
      ["Area", prop.areaSqft ? `${prop.areaSqft} sq ft` : "—"], ["Space details", prop.spaceDetails || "—"],
      ...(NO_RENT.includes(prop.occupancyStatus) ? [] : [["Rent is collected by", L.collector[prop.rentCollectedBy] || "Me"]]), ["Notes", prop.notes || "—"]])}</div>`, "h-100")}</div>
    <div class="col-12 col-xl-6">${card(html`<div class="d-flex flex-wrap justify-content-between align-items-center gap-2"><span>Room report</span><div class="nav nav-pills small">
      ${[["all", "All time"], ["fy", "This FY"], ["month", "This month"]].map(([k, l]) => html`<a class="nav-link py-1 ${period === k ? "active" : ""}" href="#/properties/${id}?period=${k}">${l}</a>`)}</div></div>`, html`<div class="card-body">${kv([
      ["Rent expected", inr(r.rentExpected)], ["Rent received (cash)", inr(r.rentCashReceived)],
      ["Rent outstanding", inr(r.rentOutstanding), r.rentOutstanding ? "money-neg" : ""], ["I paid (bills & repairs)", inr(r.ownerTotal)],
      ...Object.entries(r.ownerByCategory).map(([c, a]) => [html`<span class="ps-3 small">– ${c}</span>`, inr(a)]),
      ["Tenant/other paid (not mine)", inr(r.tenantPaidRecorded)],
      ["Net rental cash flow", html`<strong>${inr(r.netCashFlow)}</strong>`, r.netCashFlow < 0 ? "money-neg" : "money-pos"]])}
      ${prop.rentCollectedBy && prop.rentCollectedBy !== "me" && !NO_RENT.includes(prop.occupancyStatus) ? html`<p class="small text-muted mt-3 mb-0"><i class="bi bi-info-circle"></i> Rent for this room goes to ${L.collector[prop.rentCollectedBy]}, so it isn't counted in your income on the dashboard.</p>` : ""}</div>`, "h-100")}</div>

    <div class="col-12">${card(html`<div class="d-flex justify-content-between align-items-center"><span>Electricity, gas & other connections</span><a class="btn btn-sm btn-outline-primary" href="#/properties/${id}/connections/new"><i class="bi bi-plus-lg"></i> Add</a></div>`,
      conns.length ? responsive(html`<table class="table"><thead><tr><th>Type</th><th>Provider</th><th>Nickname</th><th>Consumer no.</th><th>Meter no.</th><th></th></tr></thead><tbody>
        ${conns.map((c) => html`<tr><td>${L.connection[c.kind]}${c.isActive === false ? html` <span class="badge text-bg-secondary">inactive</span>` : ""}</td><td>${c.provider || "—"}</td><td>${c.nickname || "—"}</td><td>${c.consumerNo || "—"}</td><td>${c.meterNo || "—"}</td>
          <td class="text-end text-nowrap"><a class="btn btn-sm btn-outline-secondary" href="#/connections/${c.id}/edit">Edit</a> ${actionBtn("delete-connection", "Delete", { id: c.id })}</td></tr>`)}</tbody></table>`)
        : html`<div class="card-body">${empty("No connections yet. Add the electricity / gas consumer numbers.")}</div>`)}</div>

    <div class="col-12">${card(html`<div class="d-flex justify-content-between align-items-center"><span>Tenants & rent</span><a class="btn btn-sm btn-outline-primary" href="#/properties/${id}/tenants/new"><i class="bi bi-plus-lg"></i> Add tenant</a></div>`,
      html`<div class="card-body">${tenantCards.length ? tenantCards : empty("No tenant recorded for this room.")}</div>`)}</div>

    <div class="col-12 col-xl-6">${card(html`<div class="d-flex justify-content-between align-items-center"><span>Recent rent</span><span class="d-flex gap-2"><a class="btn btn-sm btn-outline-primary" href="#/rent/new${tenants.length ? `?tenant=${(tenants.find((t) => t.isActive) || tenants[0]).id}` : ""}"><i class="bi bi-plus-lg"></i> Add old rent</a><a class="btn btn-sm btn-outline-secondary" href="#/rent">Ledger</a></span></div>`,
      obligations.length ? responsive(html`<table class="table"><thead><tr><th>Month</th><th>Expected</th><th>Received</th><th>Status</th></tr></thead><tbody>
        ${obligations.map((o) => html`<tr><td><a href="#/rent/${o.id}">${o.periodStart.slice(0, 7)}</a></td><td>${inr(o.expectedAmount)}</td><td>${inr(obReceived(o, snap.rentPayments))}</td><td>${badge(obStatus(o, snap.rentPayments, today))}</td></tr>`)}</tbody></table>`)
        : html`<div class="card-body">${empty("No rent generated yet. Use Rent → Generate.")}</div>`, "h-100")}</div>
    <div class="col-12 col-xl-6">${card(html`<div class="d-flex justify-content-between align-items-center"><span>Recent bills</span><a class="btn btn-sm btn-outline-primary" href="#/bills/new?property=${id}"><i class="bi bi-plus-lg"></i> Add bill</a></div>`,
      bills.length ? responsive(html`<table class="table"><thead><tr><th>Bill</th><th>Amount</th><th>Who pays</th><th>Status</th></tr></thead><tbody>
        ${bills.map((b) => html`<tr><td><a href="#/bills/${b.id}">${b.name}</a><div class="small text-muted">${L.category[b.category]}${b.billNumber ? ` · #${b.billNumber}` : ""}</div></td><td>${inr(b.amount)}</td><td>${L.responsible[b.responsible]}</td><td>${badge(billStatus(b, snap.billPayments, today))}</td></tr>`)}</tbody></table>`)
        : html`<div class="card-body">${empty("No bills recorded for this room.")}</div>`, "h-100")}</div>
  </div>`;
  return { title: prop.name, html: body };
}

/* ---------- connections ---------- */
const connFields = () => [
  { name: "kind", label: "Type", type: "select", options: CONNECTION_KINDS },
  text("provider", "Provider (e.g. Adani Electricity, MGL)", { max: 120 }), text("nickname", "Nickname", { max: 120 }),
  text("consumerNo", "Consumer / connection number", { max: 60 }), text("meterNo", "Meter number", { max: 60 }),
  { name: "isActive", label: "Active", type: "checkbox", default: true }, area("notes", "Notes")];

export async function connectionForm({ params }, editing = false) {
  const conn = editing ? await db.get("connections", Number(params.id)) : null;
  const pid = editing ? conn?.propertyId : Number(params.id);
  const prop = await db.get("properties", pid);
  if (!prop) return notFound();
  const spec = { id: "connection", fields: connFields(), values: conn || { kind: "electricity", isActive: true }, cancelHref: `#/properties/${pid}`,
    async onSubmit(v) { await db.put("connections", { ...(conn || {}), ...v, propertyId: pid }); toast(editing ? "Connection updated." : "Connection added."); navigate(`/properties/${pid}`); } };
  const title = editing ? "Edit connection" : `Add connection – ${prop.name}`;
  return { title, html: html`${pageHeader(title, "A room can have several electricity or gas connections.")}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}

/* ---------- tenants & increments ---------- */
const money = (name, label, extra = {}) => ({ name, label, type: "money", ...extra });
function tenantFields(hideRent) {
  return [text("name", "Tenant name", { required: true, max: 120 }), text("phone", "Phone", { max: 40 }), text("email", "Email", { max: 120 }),
    { name: "startDate", label: "Tenancy start", type: "date" }, { name: "endDate", label: "Tenancy end", type: "date" },
    ...(hideRent ? [] : [money("monthlyRent", "Monthly rent (₹)", { required: true })]),
    { name: "rentDueDay", label: "Rent due day of month", type: "number", int: true, min: 1, max: 31, required: true },
    money("securityDeposit", "Security deposit (₹)"),
    { name: "incrementPercent", label: "Planned yearly increment (%)", type: "number", min: 0, max: 100 },
    { name: "nextIncrementDate", label: "Next increment due on", type: "date" },
    { name: "isActive", label: "Current tenant", type: "checkbox", default: true }, area("notes", "Notes")];
}
export async function tenantForm({ params }, editing = false) {
  const tenant = editing ? await db.get("tenants", Number(params.id)) : null;
  const pid = editing ? tenant?.propertyId : Number(params.id);
  const prop = await db.get("properties", pid);
  if (!prop) return notFound();
  const hasRevs = editing && (await db.all("revisions")).some((r) => r.tenantId === tenant.id);
  const spec = { id: "tenant", fields: tenantFields(hasRevs), values: tenant || { rentDueDay: 5, isActive: true }, cancelHref: `#/properties/${pid}`,
    validate: (v) => (v.endDate && v.startDate && v.endDate < v.startDate ? { endDate: "End date can't be before the start date." } : {}),
    async onSubmit(v) {
      await db.batch(["tenants", "properties"], async (tx) => {
        await tx.put("tenants", { ...(tenant || {}), ...v, propertyId: pid });
        if (!editing && v.isActive && ["vacant", "other"].includes(prop.occupancyStatus)) await tx.put("properties", { ...prop, occupancyStatus: "rented" });
      });
      toast(editing ? "Tenant updated." : "Tenant added."); navigate(`/properties/${pid}`);
    } };
  const title = editing ? `Edit tenant – ${tenant.name}` : `Add tenant – ${prop.name}`;
  return { title, html: html`${pageHeader(title, hasRevs ? "Rent has an increment history – change it with “Record increment” so the history stays correct." : "")}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}

export async function incrementForm({ params }) {
  const tenant = await db.get("tenants", Number(params.id));
  if (!tenant) return notFound();
  const revisions = (await db.all("revisions")).filter((r) => r.tenantId === tenant.id);
  const sugg = suggestedNewRent(tenant);
  const spec = { id: "increment", cancelHref: `#/properties/${tenant.propertyId}`,
    fields: [{ name: "effectiveFrom", label: "Effective from", type: "date", required: true }, money("newRent", "New monthly rent (₹)", { required: true, positive: true }),
      text("reason", "Reason", { max: 200 }), { name: "nextIncrementDate", label: "Next increment due on (optional)", type: "date" }],
    values: { effectiveFrom: tenant.nextIncrementDate || todayISO(), newRent: sugg },
    async onSubmit(v) {
      const { revision, currentRent } = buildRevision(tenant, revisions, v.effectiveFrom, v.newRent, v.reason);
      await db.batch(["revisions", "tenants"], async (tx) => {
        await tx.put("revisions", revision);
        await tx.put("tenants", { ...tenant, monthlyRent: currentRent, ...(v.nextIncrementDate ? { nextIncrementDate: v.nextIncrementDate } : {}) });
      });
      toast("Rent increment recorded. Rent already generated for earlier months is unchanged.");
      navigate(`/properties/${tenant.propertyId}`);
    } };
  const sub = `Current rent ${inr(tenant.monthlyRent)}${tenant.incrementPercent != null ? ` · planned increment ${tenant.incrementPercent}%` : ""}`;
  return { title: "Record increment", html: html`${pageHeader(`Record rent increment – ${tenant.name}`, sub)}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}

/* ---------- actions ---------- */
actions["archive-property"] = async ({ id }) => {
  if (!confirm("Archive this property? Its financial history is kept.")) return;
  const p = await db.get("properties", Number(id));
  await db.put("properties", { ...p, archivedAt: new Date().toISOString() });
  toast(`${p.name} archived. Its history is kept.`, "info"); navigate("/properties");
};
actions["restore-property"] = async ({ id }) => {
  const p = await db.get("properties", Number(id));
  await db.put("properties", { ...p, archivedAt: null }); toast(`${p.name} restored.`); refresh();
};
actions["delete-property"] = async ({ id }) => {
  const pid = Number(id);
  const snap = await db.loadAll();
  const prop = snap.properties.find((p) => p.id === pid);
  const cascade = propertyCascade(snap, pid);
  if (!total(cascade)) {
    if (!confirm(`Delete ${prop.name}? It has no other records.`)) return;
  } else {
    const typed = prompt(`Delete "${prop.name}" and ALL its records: ${describe(cascade)}?\n\nThis can't be undone. (Tip: Archive keeps the history and hides the room. Download a backup first if unsure.)\n\nType DELETE to confirm.`);
    if (typed !== "DELETE") { toast("Nothing was deleted.", "info"); return; }
  }
  await db.batch(["properties", "connections", "tenants", "revisions", "obligations", "rentPayments", "bills", "billPayments"], async (tx) => {
    for (const [store, list] of [["billPayments", cascade.billPayments], ["bills", cascade.bills], ["rentPayments", cascade.rentPayments], ["obligations", cascade.obligations],
      ["revisions", cascade.revisions], ["tenants", cascade.tenants], ["connections", cascade.connections]]) for (const x of list) await tx.remove(store, x);
    await tx.remove("properties", pid);
  });
  toast(`${prop.name} deleted.`, "info"); navigate("/properties");
};
actions["delete-connection"] = async ({ id }) => {
  const cid = Number(id);
  const used = (await db.all("bills")).some((b) => b.connectionId === cid);
  if (!confirm(used ? "Bills use this connection, so it will be marked inactive instead of deleted. Continue?" : "Delete this connection?")) return;
  if (used) { const c = await db.get("connections", cid); await db.put("connections", { ...c, isActive: false }); toast("Connection marked inactive.", "warning"); }
  else { await db.remove("connections", cid); toast("Connection deleted.", "info"); }
  refresh();
};
actions["end-tenancy"] = async ({ id }) => {
  const t = await db.get("tenants", Number(id));
  if (!confirm(`End ${t.name}'s tenancy? They become a former tenant and their history stays.`)) return;
  await db.put("tenants", { ...t, isActive: false, endDate: t.endDate || todayISO() });
  toast("Tenancy ended. They are now a former tenant.", "info"); refresh();
};
actions["delete-tenant"] = async ({ id }) => {
  const tid = Number(id);
  const snap = await db.loadAll();
  const t = snap.tenants.find((x) => x.id === tid);
  const cascade = tenantCascade(snap, tid);
  if (!total(cascade)) { if (!confirm(`Delete ${t.name}?`)) return; }
  else {
    const typed = prompt(`Delete ${t.name} and their records: ${describe(cascade)}?\n\nThis can't be undone. (To keep the history, use "End tenancy" instead.)\n\nType DELETE to confirm.`);
    if (typed !== "DELETE") { toast("Nothing was deleted.", "info"); return; }
  }
  await db.batch(["tenants", "revisions", "obligations", "rentPayments"], async (tx) => {
    for (const [store, list] of [["rentPayments", cascade.rentPayments], ["obligations", cascade.obligations], ["revisions", cascade.revisions]]) for (const x of list) await tx.remove(store, x);
    await tx.remove("tenants", tid);
  });
  toast("Tenant deleted.", "info"); refresh();
};
actions["delete-revision"] = async ({ id }) => {
  if (!confirm("Remove this increment from the history?")) return;
  const rev = await db.get("revisions", Number(id));
  const tenant = await db.get("tenants", rev.tenantId);
  const remaining = (await db.all("revisions")).filter((r) => r.tenantId === tenant.id && r.id !== rev.id);
  await db.batch(["revisions", "tenants"], async (tx) => {
    await tx.remove("revisions", rev.id);
    await tx.put("tenants", { ...tenant, monthlyRent: remaining.length ? rentFor(tenant, remaining, todayISO()) : rev.oldRent });
  });
  toast("Increment removed.", "info"); refresh();
};
