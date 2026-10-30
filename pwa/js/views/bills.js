import { db } from "../db.js";
import { BILL_CATEGORIES, L, RESPONSIBLE, TENANT_PAYMENT_STATES } from "../constants.js";
import { billOutstanding, billPaid, billStatus, myShare } from "../domain/bills.js";
import { billCascade, describe, total } from "../domain/cascade.js";
import { deleteCascade } from "../cascadeDelete.js";
import { hydrateThumbs, receiptsPanel } from "./receipts.js";
import { formatDate, todayISO } from "../lib/dates.js";
import { html } from "../lib/html.js";
import { inr, sum } from "../lib/money.js";
import { actions, formHtml, navigate, refresh, toast } from "../ui/core.js";
import { actionBtn, badge, byId, card, empty, kv, optionsOf, pageHeader, paidButton, responsive, stat, tableCard } from "./common.js";
import { notFound } from "./properties.js";
import { paymentSpec } from "./payments.js";

const STATUS_FILTERS = ["unpaid", "partial", "overdue", "paid", "not_mine", "cancelled"];

export async function list({ query }) {
  const snap = await db.loadAll();
  const props = byId(snap.properties);
  const today = todayISO();
  const f = Object.fromEntries(["property", "category", "responsible", "status", "q"].map((k) => [k, query.get(k) || ""]));
  let bills = snap.bills.filter((b) =>
    (!f.property || String(b.propertyId) === f.property) && (!f.category || b.category === f.category) &&
    (!f.responsible || b.responsible === f.responsible) &&
    (!f.q || [b.name, b.billNumber, b.provider].some((x) => (x || "").toLowerCase().includes(f.q.toLowerCase()))));
  const status = (b) => billStatus(b, snap.billPayments, today);
  if (f.status) bills = bills.filter((b) => status(b) === f.status);
  bills.sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || "") || b.id - a.id);
  const sel = (name, label, opts, blank) => html`<div><label class="form-label small mb-1">${label}</label><select class="form-select" data-filter="${name}">
    <option value="">${blank}</option>${opts.map(([v, l]) => html`<option value="${v}" ${String(v) === f[name] ? "selected" : ""}>${l}</option>`)}</select></div>`;
  return { title: "Property bills", html: html`${pageHeader("Property bills", "Electricity, gas, maintenance, taxes and more – and who pays each", html`<a class="btn btn-primary" href="#/bills/new"><i class="bi bi-plus-lg"></i> Add bill</a>`)}
    <div class="card card-body mb-3 filter-bar">
      ${sel("property", "Property", snap.properties.map((p) => [p.id, p.name]), "All")}${sel("category", "Category", BILL_CATEGORIES, "All")}
      ${sel("responsible", "Who pays", RESPONSIBLE, "Anyone")}${sel("status", "Status", STATUS_FILTERS.map((k) => [k, k.replace("_", " ")]), "Any")}
      <div><label class="form-label small mb-1">Search</label><input class="form-control" data-filter="q" value="${f.q}" placeholder="name, bill no, provider"></div></div>
    <div class="row g-3 mb-3">
      <div class="col-4">${stat("My share of these bills", inr(sum(bills, myShare)), "receipt", "primary")}</div>
      <div class="col-4">${stat("Paid by me", inr(sum(bills, (b) => billPaid(b, snap.billPayments))), "check2-circle", "success")}</div>
      <div class="col-4">${stat("Still to pay", inr(sum(bills, (b) => billOutstanding(b, snap.billPayments))), "hourglass-split", "danger")}</div></div>
    ${tableCard(bills.length ? responsive(html`<table class="table table-hover"><thead><tr><th>Bill</th><th>Room</th><th>Due</th><th>Amount</th><th>Who pays</th><th>I paid</th><th>Status</th></tr></thead><tbody>
      ${bills.map((b) => html`<tr><td><a href="#/bills/${b.id}">${b.name}</a><div class="small text-muted">${L.category[b.category]}${b.billNumber ? ` · #${b.billNumber}` : ""}${b.periodLabel ? ` · ${b.periodLabel}` : ""}</div>${paidButton(b, snap.billPayments)}</td>
        <td>${props.get(b.propertyId)?.name}</td><td>${formatDate(b.dueDate)}</td><td>${inr(b.amount)}</td>
        <td>${L.responsible[b.responsible]}${["tenant", "other"].includes(b.responsible) && b.tenantPaymentState !== "not_reported" ? html`<div class="small text-muted">${b.tenantPaymentState.replace("_", " ")}</div>` : ""}</td>
        <td>${inr(billPaid(b, snap.billPayments))}</td><td>${badge(status(b))}</td></tr>`)}</tbody></table>`)
      : html`<div class="card-body">${empty("No bills match. Add the first one with “Add bill”.")}</div>`)}` };
}

function billFields(snap, editing) {
  return [
    { name: "propertyId", label: "Property", type: "select", cast: "int", required: true, options: snap.properties.map((p) => [p.id, p.name + (p.archivedAt ? " (archived)" : "")]) },
    { name: "connectionId", label: "Connection (optional)", type: "select", cast: "int", options: [[null, "— none —"], ...snap.connections.map((c) => [c.id, `${byId(snap.properties).get(c.propertyId)?.name}: ${L.connection[c.kind]} ${c.nickname || c.provider || ""} ${c.consumerNo ? "…" + c.consumerNo.slice(-4) : ""}`.trim()])] },
    { name: "category", label: "Category", type: "select", options: BILL_CATEGORIES },
    { name: "name", label: "Bill name", type: "text", required: true, max: 160 },
    { name: "provider", label: "Provider", type: "text", max: 120 }, { name: "billNumber", label: "Bill number", type: "text", max: 80 },
    { name: "periodLabel", label: "Billing period (e.g. Oct 2026)", type: "text", max: 60 },
    { name: "receivedOn", label: "Bill received on", type: "date" }, { name: "dueDate", label: "Due date", type: "date" },
    { name: "amount", label: "Bill amount (₹)", type: "money", required: true },
    { name: "responsible", label: "Who pays?", type: "select", options: RESPONSIBLE },
    { name: "ownerShare", label: "My share if shared (₹)", type: "money" },
    { name: "tenantPaymentState", label: "Tenant payment", type: "select", options: TENANT_PAYMENT_STATES },
    ...(editing ? [{ name: "isCancelled", label: "Cancelled", type: "checkbox" }] : []),
    { name: "notes", label: "Notes", type: "textarea", max: 4000 },
  ];
}

function billSpec(snap, bill, defaults) {
  const conns = byId(snap.connections);
  return { id: "bill", fields: billFields(snap, !!bill), values: bill || { category: "electricity", responsible: "owner", tenantPaymentState: "not_reported", ...defaults },
    cancelHref: "#/bills",
    validate(v) {
      const e = {};
      if (v.connectionId && conns.get(v.connectionId)?.propertyId !== v.propertyId) e.connectionId = "That connection belongs to a different property.";
      if (v.responsible === "shared") {
        if (v.ownerShare == null) e.ownerShare = "Enter my share for a shared bill.";
        else if (v.amount != null && v.ownerShare > v.amount) e.ownerShare = "My share can't be more than the bill amount.";
      }
      return e;
    },
    async onSubmit(v) {
      const saved = await db.put("bills", { ...(bill || {}), ...v, isCancelled: v.isCancelled ?? false, ownerShare: v.responsible === "shared" ? v.ownerShare : null });
      toast(bill ? "Bill updated." : "Bill added."); navigate(`/bills/${saved.id}`);
    } };
}

export async function newBill({ query }) {
  const snap = await db.loadAll();
  if (!snap.properties.length) return { title: "Add bill", html: html`${pageHeader("Add bill")}<div class="card card-body">${empty("Add a property first.")}</div>` };
  const spec = billSpec(snap, null, { propertyId: Number(query.get("property")) || snap.properties[0].id });
  return { title: "Add bill", html: html`${pageHeader("Add bill", "Record a bill, who pays it, and what you actually paid")}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}

export async function editBill({ params }) {
  const id = Number(params.id);
  const snap = await db.loadAll();
  const bill = snap.bills.find((b) => b.id === id);
  if (!bill) return notFound();
  const props = byId(snap.properties);
  const pays = snap.billPayments.filter((p) => p.billId === id).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const out = billOutstanding(bill, snap.billPayments);
  const status = billStatus(bill, snap.billPayments);
  const paySpec = paymentSpec({ id: "bill-pay", defaultAmount: out || null, outstanding: out, existing: pays,
    async onSubmit(v) { await db.put("billPayments", { billId: id, amount: v.amount, paidOn: v.paidOn, method: v.method, reference: v.reference, notes: v.notes }); toast("Payment recorded."); refresh(); } });
  const canPay = myShare(bill) > 0 && !bill.isCancelled;
  return { title: bill.name, html: html`${pageHeader(bill.name, `${props.get(bill.propertyId)?.name} · ${L.category[bill.category]}`, html`
      <a class="btn btn-outline-secondary" href="#/bills"><i class="bi bi-arrow-left"></i> All bills</a>${out > 0 ? actionBtn("pay-due", `Mark ${inr(out)} paid`, { type: "bill", id }, "btn btn-success", "check2") : ""}${actionBtn("delete-bill", "Delete", { id }, "btn btn-outline-danger", "trash")}`)}
    <div class="row g-3"><div class="col-12 col-xl-7 order-2 order-xl-1"><div class="card"><div class="card-body">${formHtml(billSpec(snap, bill))}</div></div></div>
    <div class="col-12 col-xl-5 order-1 order-xl-2">
      <div class="mb-3">${card(html`Status ${badge(status)}`, html`<div class="card-body">${kv([
        ["Bill amount", inr(bill.amount, 2)],
        ["My share", html`${inr(myShare(bill), 2)}${["tenant", "other"].includes(bill.responsible) ? html` <span class="text-muted small">(not mine – won't count as my spending)</span>` : ""}`],
        ["Paid by me", inr(billPaid(bill, snap.billPayments), 2)], ["Outstanding", inr(out, 2), out ? "money-neg" : ""]])}</div>`)}</div>
      <div class="mb-3">${card("My payments", pays.length ? responsive(html`<table class="table"><tbody>${pays.map((p) => html`<tr><td>${formatDate(p.paidOn)}<div class="small text-muted">${p.method || ""} ${p.reference || ""}</div></td><td>${inr(p.amount, 2)}</td>
        <td class="text-end">${actionBtn("delete-bill-payment", "Delete", { id: p.id })}</td></tr>`)}</tbody></table>`)
        : html`<div class="card-body">${empty("Nothing paid yet. A due date passing never marks a bill paid.")}</div>`)}</div>
      <div class="mb-3">${card("Receipts", html`<div class="card-body"><p class="small text-muted">The bill itself and/or the proof of payment (photo or PDF).</p>${receiptsPanel(snap, "bill", id)}</div>`)}</div>
      ${canPay ? card("Record a payment", html`<div class="card-body">${formHtml(paySpec)}</div>`) : ""}</div></div>`, after: (root) => hydrateThumbs(root) };
}

actions["delete-bill"] = async ({ id }) => {
  const bid = Number(id);
  const snap = await db.loadAll();
  const cascade = billCascade(snap, bid);
  if (!confirm(total(cascade) ? `Delete this bill and ${describe(cascade)}? This can't be undone. (Mark it Cancelled instead to keep it on record.)` : "Delete this bill?")) return;
  await deleteCascade(cascade, ["bills", bid]);
  toast("Bill deleted.", "info"); navigate("/bills");
};
actions["delete-bill-payment"] = async ({ id }) => {
  if (!confirm("Delete this payment?")) return;
  await db.remove("billPayments", Number(id)); toast("Payment removed.", "info"); refresh();
};
