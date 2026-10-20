import { db } from "../db.js";
import { L } from "../constants.js";
import { obOutstanding, obReceived, obStatus, obligationsToCreate, previewObligations } from "../domain/rent.js";
import { addMonths, formatDate, monthLabel, parseMonth, todayISO } from "../lib/dates.js";
import { html } from "../lib/html.js";
import { inr, sum } from "../lib/money.js";
import { actions, formHtml, navigate, refresh, toast } from "../ui/core.js";
import { actionBtn, badge, byId, card, empty, kv, monthNav, pageHeader, responsive, stat, tableCard } from "./common.js";
import { notFound } from "./properties.js";
import { paymentSpec } from "./payments.js";

export async function ledger({ query }) {
  const start = parseMonth(query.get("month"));
  const snap = await db.loadAll();
  const props = byId(snap.properties), tenants = byId(snap.tenants);
  const rows = snap.obligations.filter((o) => o.periodStart === start)
    .sort((a, b) => (props.get(a.propertyId)?.sortOrder || 0) - (props.get(b.propertyId)?.sortOrder || 0));
  const live = rows.filter((o) => !o.isCancelled);
  const today = todayISO();
  const m = start.slice(0, 7);
  return { title: "Rent", html: html`${pageHeader("Rent", "Monthly rent owed and received", html`<a class="btn btn-primary" href="#/rent/generate?month=${m}"><i class="bi bi-magic"></i> Generate for ${monthLabel(start).slice(0, 3)} ${start.slice(0, 4)}</a>`)}
    ${monthNav(monthLabel(start), `#/rent?month=${addMonths(start, -1).slice(0, 7)}`, `#/rent?month=${addMonths(start, 1).slice(0, 7)}`)}
    <div class="row g-3 mb-3">
      <div class="col-12 col-md-4">${stat("Expected", inr(sum(live, (o) => o.expectedAmount)), "calendar-check", "primary")}</div>
      <div class="col-12 col-md-4">${stat("Received", inr(sum(live, (o) => obReceived(o, snap.rentPayments))), "cash-coin", "success")}</div>
      <div class="col-12 col-md-4">${stat("Outstanding", inr(sum(live, (o) => obOutstanding(o, snap.rentPayments))), "hourglass-split", "danger")}</div></div>
    ${tableCard(rows.length ? responsive(html`<table class="table table-hover"><thead><tr><th>Room</th><th>Tenant</th><th>Due</th><th>Expected</th><th>Received</th><th>Outstanding</th><th>Goes to</th><th>Status</th></tr></thead><tbody>
      ${rows.map((o) => html`<tr><td><a href="#/rent/${o.id}">${props.get(o.propertyId)?.name}</a></td><td>${tenants.get(o.tenantId)?.name}</td><td>${formatDate(o.dueDate)}</td>
        <td>${inr(o.expectedAmount)}</td><td>${inr(obReceived(o, snap.rentPayments))}</td><td class="${obOutstanding(o, snap.rentPayments) ? "money-neg" : ""}">${inr(obOutstanding(o, snap.rentPayments))}</td>
        <td>${L.collector[props.get(o.propertyId)?.rentCollectedBy]}</td><td>${badge(obStatus(o, snap.rentPayments, today))}</td></tr>`)}</tbody></table>`)
      : html`<div class="card-body">${empty("No rent records for this month yet. Use “Generate” to review and create them.")}</div>`)}` };
}

export async function generate({ query }) {
  const start = parseMonth(query.get("month"));
  const snap = await db.loadAll();
  const rows = previewObligations(snap, start);
  const m = start.slice(0, 7);
  return { title: "Generate rent", html: html`${pageHeader(`Generate rent – ${monthLabel(start)}`, "Review first. Nothing is saved or marked received until you confirm.", html`<a class="btn btn-outline-secondary" href="#/rent?month=${m}">Back to ledger</a>`)}
    ${monthNav(monthLabel(start), `#/rent/generate?month=${addMonths(start, -1).slice(0, 7)}`, `#/rent/generate?month=${addMonths(start, 1).slice(0, 7)}`)}
    <div id="generate-box">${tableCard(rows.length ? responsive(html`<table class="table"><thead><tr><th></th><th>Room</th><th>Tenant</th><th>Rent for the month</th><th>Due date</th><th></th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><input class="form-check-input" type="checkbox" name="tenant_id" value="${r.tenant.id}" id="t${r.tenant.id}" ${r.exists ? "disabled" : "checked"}></td>
        <td><label for="t${r.tenant.id}">${r.property.name}</label></td><td>${r.tenant.name}</td><td>${inr(r.amount)}</td><td>${formatDate(r.dueDate)}</td>
        <td>${r.exists ? html`<span class="badge badge-soft text-bg-secondary">Already exists</span>` : ""}</td></tr>`)}</tbody></table>`)
      : html`<div class="card-body">${empty("No current tenants to generate rent for this month.")}</div>`)}
    ${rows.length ? html`<button class="btn btn-primary mt-3" type="button" data-action="create-obligations" data-month="${start}"><i class="bi bi-check2"></i> Create selected rent records</button>` : ""}</div>` };
}

export async function obligation({ params }) {
  const id = Number(params.id);
  const snap = await db.loadAll();
  const ob = snap.obligations.find((o) => o.id === id);
  if (!ob) return notFound();
  const prop = snap.properties.find((p) => p.id === ob.propertyId), tenant = snap.tenants.find((t) => t.id === ob.tenantId);
  const pays = snap.rentPayments.filter((p) => p.obligationId === id).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const out = obOutstanding(ob, snap.rentPayments);
  const spec = paymentSpec({ id: "rent-pay", defaultAmount: out || null, outstanding: ob.isCancelled ? 0 : out, existing: pays,
    async onSubmit(v) {
      await db.put("rentPayments", { obligationId: id, amount: v.amount, paidOn: v.paidOn, method: v.method, reference: v.reference, notes: v.notes });
      toast("Payment recorded."); refresh();
    } });
  return { title: `Rent ${prop?.name}`, html: html`${pageHeader(`${prop?.name} – ${monthLabel(ob.periodStart)}`, `Tenant: ${tenant?.name}`, html`
      <a class="btn btn-outline-secondary" href="#/rent?month=${ob.periodStart.slice(0, 7)}"><i class="bi bi-arrow-left"></i> Ledger</a>
      ${actionBtn("toggle-obligation", ob.isCancelled ? "Reinstate" : "Cancel this month", { id }, "btn btn-outline-secondary")}`)}
    <div class="row g-3 mb-3">
      <div class="col-6 col-md-3">${stat("Expected", inr(ob.expectedAmount), "calendar-check", "primary", `Due ${formatDate(ob.dueDate)}`)}</div>
      <div class="col-6 col-md-3">${stat("Received", inr(obReceived(ob, snap.rentPayments)), "cash-coin", "success")}</div>
      <div class="col-6 col-md-3">${stat("Outstanding", inr(out), "hourglass-split", "danger")}</div>
      <div class="col-6 col-md-3">${stat("Status", badge(obStatus(ob, snap.rentPayments)), "flag", "secondary", `Rent goes to ${L.collector[prop?.rentCollectedBy]}`)}</div></div>
    <div class="row g-3"><div class="col-12 col-lg-7">${card("Payments", pays.length ? responsive(html`<table class="table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th></th></tr></thead><tbody>
        ${pays.map((p) => html`<tr><td>${formatDate(p.paidOn)}${p.paidOn > ob.dueDate ? html` <span class="badge text-bg-warning">late</span>` : ""}</td><td>${inr(p.amount, 2)}</td><td>${p.method || "—"}</td><td>${p.reference || "—"}</td>
          <td class="text-end">${actionBtn("delete-rent-payment", "Delete", { id: p.id })}</td></tr>`)}</tbody></table>`)
        : html`<div class="card-body">${empty("No payments yet. Rent is never marked received automatically.")}</div>`)}</div>
      <div class="col-12 col-lg-5">${card("Record a payment", html`<div class="card-body">${formHtml(spec)}</div>`)}</div></div>` };
}

actions["create-obligations"] = async ({ month }) => {
  const ids = new Set([...document.querySelectorAll('#generate-box input[name="tenant_id"]:checked')].map((e) => Number(e.value)));
  const snap = await db.loadAll();
  const made = obligationsToCreate(snap, month, ids);
  await db.batch(["obligations"], async (tx) => { for (const o of made) await tx.put("obligations", o); });
  toast(`Created ${made.length} rent record(s) for ${monthLabel(month)}. Nothing is marked as received.`);
  navigate(`/rent?month=${month.slice(0, 7)}`);
};
actions["toggle-obligation"] = async ({ id }) => {
  const ob = await db.get("obligations", Number(id));
  if (!ob.isCancelled && !confirm("Cancel this rent record? Payments already recorded are kept.")) return;
  await db.put("obligations", { ...ob, isCancelled: !ob.isCancelled });
  toast(ob.isCancelled ? "Rent record reinstated." : "Rent record cancelled.", "info"); refresh();
};
actions["delete-rent-payment"] = async ({ id }) => {
  if (!confirm("Delete this payment?")) return;
  await db.remove("rentPayments", Number(id)); toast("Payment removed.", "info"); refresh();
};
