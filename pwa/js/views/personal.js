import { db } from "../db.js";
import { EXPENSE_CATEGORIES, FREQUENCIES, INCOME_KINDS, INVESTMENT_TYPES, KINDS, KIND_ICONS, L, STATUSES, METHODS } from "../constants.js";
import { dueState, installmentsLeft, isInvestment, monthlyCost, paymentsOf, recordPayment, remainingAmount, totalPaid, withAnchor } from "../domain/commitments.js";
import { dueThisMonth, monthFigures } from "../domain/dashboard.js";
import { billOutstanding } from "../domain/bills.js";
import { addMonths, formatDate, monthLabel, parseMonth, todayISO } from "../lib/dates.js";
import { html } from "../lib/html.js";
import { inr, sum } from "../lib/money.js";
import { actions, formHtml, navigate, refresh, toast } from "../ui/core.js";
import { actionBtn, badge, byId, card, empty, kv, monthNav, pageHeader, responsive, stat, tableCard } from "./common.js";
import { notFound } from "./properties.js";
import { paymentSpec } from "./payments.js";

const money = (name, label, extra = {}) => ({ name, label, type: "money", ...extra });
const text = (name, label, extra = {}) => ({ name, label, type: "text", max: 200, ...extra });
const area = (name = "notes", label = "Notes") => ({ name, label, type: "textarea", max: 4000 });
const date = (name, label, extra = {}) => ({ name, label, type: "date", ...extra });

/* ---------- overview ---------- */
export async function overview({ query }) {
  const start = parseMonth(query.get("month"));
  const snap = await db.loadAll();
  const figs = monthFigures(snap, start);
  const active = snap.commitments.filter((c) => c.status === "active");
  const by = (k) => active.filter((c) => c.kind === k);
  const holdings = snap.investments.filter((h) => h.isActive !== false);
  const emiLeft = sum(by("emi"), (c) => remainingAmount(c, snap.commitmentPayments) || 0);
  const due = dueThisMonth(snap, start, todayISO());
  const stillToPay = sum(due, (i) => i.amount);
  const leftAfterDues = figs.remaining - stillToPay;
  return { title: "Personal overview", html: html`${pageHeader("Personal overview", "Your own money this month – actual cash in and out")}
    ${monthNav(monthLabel(start), `#/personal?month=${addMonths(start, -1).slice(0, 7)}`, `#/personal?month=${addMonths(start, 1).slice(0, 7)}`)}
    <div class="row g-3">
      <div class="col-6 col-lg-3">${stat("Salary received", inr(figs.salary), "wallet2", "success")}</div>
      <div class="col-6 col-lg-3">${stat("My rent received", inr(figs.rentReceivedMine), "cash-coin", "success", "Rooms where I collect rent")}</div>
      <div class="col-6 col-lg-3">${stat("Spent (actual)", inr(figs.totalExpenses), "cart", "danger", "Bills, plans, EMIs, everyday")}</div>
      <div class="col-6 col-lg-3">${stat("Left so far", inr(figs.remaining), "piggy-bank", "primary", "Money in − what I've paid − invested")}</div>
      <div class="col-6 col-lg-3">${stat("Still to pay this month", inr(stillToPay), "hourglass-split", "warning", "Added but not yet marked paid")}</div>
      <div class="col-6 col-lg-3">${stat("Left after all dues", inr(leftAfterDues), "wallet2", leftAfterDues >= 0 ? "success" : "danger", "If everything due is paid")}</div></div>
    <p class="small text-muted mt-2 mb-0"><i class="bi bi-info-circle"></i> “Left so far” counts only payments you have actually made. A subscription, EMI or plan you add counts as spending once you mark it paid – until then it is in “Still to pay”.</p>
    <div class="section-title">Still to pay this month</div>
    ${card("", due.length ? responsive(html`<table class="table"><thead><tr><th>Due</th><th>What</th><th class="text-end">Amount</th></tr></thead><tbody>
      ${due.map((i) => html`<tr><td class="text-nowrap">${formatDate(i.date)}${i.overdue ? html` <span class="badge badge-soft text-bg-danger">overdue</span>` : ""}</td>
        <td><a href="${i.href}">${i.label}</a><div class="small text-muted">${i.kind}${i.investment ? " · investment" : ""}</div>
        <div class="mt-1">${actionBtn("pay-due", "Paid", { type: i.type, id: i.id }, "btn btn-sm btn-success", "check2")}</div></td><td class="text-end">${inr(i.amount)}</td></tr>`)}</tbody></table>`)
      : html`<div class="card-body">${empty("Nothing left to pay this month.")}</div>`)}
    <div class="section-title">Where it went</div>
    <div class="row g-3">
      <div class="col-12 col-lg-6">${card("Spending by type", Object.keys(figs.categories).length ? html`<table class="table"><tbody>
        ${Object.entries(figs.categories).map(([k, v]) => html`<tr><td>${k}</td><td class="text-end">${inr(v)}</td></tr>`)}
        <tr class="fw-bold"><td>Total spending</td><td class="text-end">${inr(figs.totalExpenses)}</td></tr><tr><td>Invested (SIPs)</td><td class="text-end">${inr(figs.investments)}</td></tr></tbody></table>`
        : html`<div class="card-body">${empty("No payments recorded this month.")}</div>`)}</div>
      <div class="col-12 col-lg-6">${card("Recurring commitments (active)", html`<table class="table"><tbody>${KINDS.map(([k, label]) => html`<tr>
        <td><i class="bi bi-${KIND_ICONS[k]} me-2"></i><a href="#/commitments?kind=${k}">${label}</a> <span class="text-muted small">(${by(k).length})</span></td>
        <td class="text-end">${by(k).length ? inr(sum(by(k), monthlyCost)) : "—"} <span class="text-muted small">/mo est.</span></td></tr>`)}</tbody></table>`)}</div></div>
    <div class="section-title">Loans & investments</div>
    <div class="row g-3">
      <div class="col-12 col-md-4">${stat("EMI still to repay", inr(emiLeft), "bank", "danger", "EMIs left × amount")}</div>
      <div class="col-12 col-md-4">${stat("Total invested", inr(sum(holdings, (h) => h.investedAmount)), "graph-up-arrow", "primary")}</div>
      <div class="col-12 col-md-4">${stat("Current value", inr(sum(holdings, (h) => h.currentValue ?? h.investedAmount)), "piggy-bank", "success", "As last updated by you")}</div></div>` };
}

/* ---------- commitments ---------- */
const HIDE = {
  mobile: ["totalAmount", "totalInstallments", "installmentsDone", "autoRenew"],
  subscription: ["totalAmount", "totalInstallments", "installmentsDone", "planType", "validityDays", "expiryDate"],
  emi: ["memberId", "autoRenew", "planType", "validityDays", "expiryDate"],
  insurance: ["totalInstallments", "installmentsDone", "planType", "validityDays", "expiryDate", "autoRenew", "memberId"],
  sip: ["totalInstallments", "installmentsDone", "planType", "validityDays", "expiryDate", "autoRenew", "memberId"],
  other: ["totalAmount", "totalInstallments", "installmentsDone", "planType", "validityDays", "expiryDate"],
};
const RELABEL = {
  mobile: { reference: "Mobile number (last digits are enough)", provider: "Operator (Jio, Airtel, Vi…)", name: "Plan name / label" },
  emi: { totalAmount: "Loan amount (₹)", reference: "Loan account (partial)", provider: "Bank / lender", amount: "EMI amount (₹)" },
  insurance: { totalAmount: "Sum assured (₹)", reference: "Policy number (partial)", amount: "Premium (₹)", endDate: "Maturity date", provider: "Insurer (LIC…)" },
  sip: { provider: "Fund house / platform", name: "Fund name", amount: "SIP amount (₹)" },
  subscription: { provider: "Service provider", name: "Service name" },
};

function commitmentFields(kind, members) {
  const all = [
    { name: "kind", label: "Type", type: "select", options: KINDS },
    text("name", "Name (e.g. Jio – Mom, LIC Jeevan Anand, Home loan)", { required: true, max: 160 }),
    text("provider", "Provider / operator / bank", { max: 120 }),
    { name: "memberId", label: "Family member", type: "select", cast: "int", options: [[null, "— none / me —"], ...members.filter((m) => m.isActive !== false).map((m) => [m.id, m.name])] },
    text("reference", "Number / policy no. (keep partial)", { max: 80 }),
    money("amount", "Amount per payment (₹)", { required: true }),
    { name: "frequency", label: "Frequency", type: "select", options: FREQUENCIES },
    { name: "intervalDays", label: "Every N days (custom only)", type: "number", int: true, min: 1, max: 3650 },
    date("nextDueDate", "Next due date"), { name: "status", label: "Status", type: "select", options: STATUSES },
    date("startDate", "Start date"), date("endDate", "End / maturity date"),
    { name: "autoRenew", label: "Auto-renews", type: "checkbox" },
    money("totalAmount", "Loan amount / sum assured (₹)"),
    { name: "totalInstallments", label: "Total installments (EMI)", type: "number", int: true, min: 1, max: 1200 },
    { name: "installmentsDone", label: "Installments already paid before tracking", type: "number", int: true, min: 0, max: 1200 },
    { name: "planType", label: "Mobile plan type", type: "select", options: [["", "—"], ["prepaid", "Prepaid"], ["postpaid", "Postpaid"]] },
    { name: "validityDays", label: "Prepaid validity (days)", type: "number", int: true, min: 1, max: 3650 },
    date("expiryDate", "Prepaid expiry date (correct by hand if needed)"), area()];
  const hide = new Set(HIDE[kind] || []);
  const relabel = RELABEL[kind] || {};
  return all.filter((f) => !hide.has(f.name)).map((f) => (relabel[f.name] ? { ...f, label: relabel[f.name] } : f));
}

export async function listCommitments({ query }) {
  const kind = KINDS.some(([k]) => k === query.get("kind")) ? query.get("kind") : "";
  const status = query.get("status") || "active";
  const member = Number(query.get("member")) || null;
  const snap = await db.loadAll();
  const members = byId(snap.members);
  const today = todayISO();
  const items = snap.commitments.filter((c) => (!kind || c.kind === kind) && (status === "all" || c.status === status) && (!member || c.memberId === member))
    .sort((a, b) => (a.nextDueDate || "9999").localeCompare(b.nextDueDate || "9999") || a.name.localeCompare(b.name));
  const live = items.filter((c) => c.status === "active");
  const perMember = {};
  for (const c of live) perMember[members.get(c.memberId)?.name || "Me / unassigned"] = (perMember[members.get(c.memberId)?.name || "Me / unassigned"] || 0) + monthlyCost(c);
  const monthly = sum(live, monthlyCost);
  const title = L.kind[kind] || "All recurring payments";
  const showMember = ["mobile", "subscription", ""].includes(kind);
  const P = snap.commitmentPayments;
  const opt = (v, cur, l) => html`<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${l}</option>`;
  return { title, html: html`${pageHeader(title, "Estimates are based on each plan's amount and frequency – they are not payments.", html`<a class="btn btn-primary" href="#/commitments/new?kind=${kind}"><i class="bi bi-plus-lg"></i> Add</a>`)}
    <div class="filter-bar mb-3">
      <div><label class="form-label small mb-1">Status</label><select class="form-select" data-filter="status">${[["active", "Active"], ["paused", "Paused"], ["cancelled", "Cancelled"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => opt(k, status, l))}</select></div>
      ${showMember ? html`<div><label class="form-label small mb-1">Family member</label><select class="form-select" data-filter="member"><option value="">Everyone</option>${snap.members.map((m) => opt(m.id, member, m.name))}</select></div>` : ""}
    <div class="row g-3 mb-3">
      <div class="col-6 col-lg-3">${stat("Estimated per month", inr(monthly), "calendar3", "primary", "Active items only")}</div>
      <div class="col-6 col-lg-3">${stat("Estimated per year", inr(monthly * 12), "calendar-range", "primary")}</div>
      ${kind === "emi" ? html`<div class="col-6 col-lg-3">${stat("Still to repay (EMIs left)", inr(sum(live, (c) => remainingAmount(c, P) || 0)), "bank", "danger")}</div>` : ""}
      ${["mobile", "subscription"].includes(kind) ? Object.entries(perMember).map(([n, a]) => html`<div class="col-6 col-lg-3">${stat(n, `${inr(a)} /mo`, "person", "secondary")}</div>`) : ""}</div>
    ${tableCard(items.length ? responsive(html`<table class="table table-hover"><thead><tr><th>Name</th>${showMember ? html`<th>Member</th>` : ""}<th>Amount</th><th>Frequency</th><th>Next due</th>
      ${kind === "mobile" ? html`<th>Plan</th><th>Expires</th>` : ""}${kind === "emi" ? html`<th>Left</th><th>Remaining</th>` : ""}${kind === "insurance" ? html`<th>Sum assured</th><th>Paid so far</th>` : ""}${kind === "sip" ? html`<th>Invested via SIP</th>` : ""}<th>Status</th></tr></thead><tbody>
      ${items.map((c) => html`<tr><td><a href="#/commitments/${c.id}">${c.name}</a><div class="small text-muted">${kind ? "" : `${L.kind[c.kind]} · `}${c.provider || ""}${c.reference ? ` · ${c.reference}` : ""}</div></td>
        ${showMember ? html`<td>${members.get(c.memberId)?.name || "—"}</td>` : ""}<td>${inr(c.amount, 2)}</td><td>${L.frequency[c.frequency]}</td><td>${formatDate(c.nextDueDate)}</td>
        ${kind === "mobile" ? html`<td>${c.planType ? c.planType[0].toUpperCase() + c.planType.slice(1) : "—"}</td><td>${formatDate(c.expiryDate)}</td>` : ""}
        ${kind === "emi" ? html`<td>${installmentsLeft(c, P) ?? "—"}</td><td>${remainingAmount(c, P) != null ? inr(remainingAmount(c, P)) : "—"}</td>` : ""}
        ${kind === "insurance" ? html`<td>${inr(c.totalAmount)}</td><td>${inr(totalPaid(c, P))}</td>` : ""}${kind === "sip" ? html`<td>${inr(totalPaid(c, P))}</td>` : ""}
        <td>${badge(dueState(c, today))}</td></tr>`)}</tbody></table>`)
      : html`<div class="card-body">${empty("Nothing here yet. Click “Add”.")}</div>`)}` };
}

function commitmentSpec(kind, snap, c) {
  const k = KINDS.some(([x]) => x === kind) ? kind : "other";
  return { id: "commitment", fields: commitmentFields(k, snap.members), cancelHref: `#/commitments?kind=${k}`,
    values: c || { kind: k, frequency: "monthly", status: "active", planType: k === "mobile" ? "prepaid" : "", installmentsDone: 0 },
    validate: (v) => (v.frequency === "custom" && !v.intervalDays ? { intervalDays: "Enter the number of days for a custom frequency." } : {}),
    async onSubmit(v) {
      let next = { ...(c || {}), ...v, planType: v.planType || null };
      if (!c && next.kind === "mobile" && next.planType === "prepaid" && next.expiryDate && !next.nextDueDate) next.nextDueDate = next.expiryDate;
      if (c && next.nextDueDate && next.nextDueDate !== c.nextDueDate) next.dueDay = Number(next.nextDueDate.slice(8)); // hand-corrected date becomes the anchor
      next = withAnchor(next);
      const saved = await db.put("commitments", next);
      toast(c ? "Saved." : `${L.kind[saved.kind]} added.`); navigate(`/commitments/${saved.id}`);
    } };
}

export async function newCommitment({ query }) {
  const snap = await db.loadAll();
  const spec = commitmentSpec(query.get("kind") || "other", snap, null);
  const label = L.kind[spec.values.kind] || "recurring payment";
  return { title: `Add ${label}`, html: html`${pageHeader(`Add – ${label}`)}<div class="card"><div class="card-body">${formHtml(spec)}</div></div>` };
}

export async function editCommitment({ params }) {
  const id = Number(params.id);
  const snap = await db.loadAll();
  const c = snap.commitments.find((x) => x.id === id);
  if (!c) return notFound();
  const pays = paymentsOf(c, snap.commitmentPayments).sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  const paySpec = paymentSpec({ id: "commit-pay", defaultAmount: c.amount, existing: pays, advance: true,
    async onSubmit(v) {
      const { commitment, payment } = recordPayment(c, pays, { amount: v.amount, paidOn: v.paidOn, method: v.method, reference: v.reference, notes: v.notes, advanceDue: v.advanceDue });
      await db.batch(["commitments", "commitmentPayments"], async (tx) => { await tx.put("commitments", commitment); await tx.put("commitmentPayments", payment); });
      toast("Payment recorded." + (commitment.nextDueDate ? ` Next due ${formatDate(commitment.nextDueDate)}.` : "")); refresh();
    } });
  const left = installmentsLeft(c, snap.commitmentPayments);
  return { title: c.name, html: html`${pageHeader(c.name, L.kind[c.kind], html`<a class="btn btn-outline-secondary" href="#/commitments?kind=${c.kind}"><i class="bi bi-arrow-left"></i> Back</a>${actionBtn("delete-commitment", "Delete", { id }, "btn btn-outline-danger", "trash")}`)}
    <div class="row g-3"><div class="col-12 col-xl-7"><div class="card"><div class="card-body">${formHtml(commitmentSpec(c.kind, snap, c))}</div></div></div>
    <div class="col-12 col-xl-5">
      <div class="mb-3">${card(html`Summary ${badge(dueState(c))}`, html`<div class="card-body">${kv([
        ["Next due", formatDate(c.nextDueDate)],
        ["Total paid so far", html`${inr(totalPaid(c, snap.commitmentPayments), 2)} <span class="text-muted small">(${pays.length} payments)</span>`],
        ...(c.kind === "emi" && left != null ? [["Installments left", `${left} of ${c.totalInstallments}`], ["Still to repay", inr(remainingAmount(c, snap.commitmentPayments))]] : []),
        ...(c.kind === "mobile" && c.planType === "prepaid" ? [["Plan expires", formatDate(c.expiryDate)]] : [])])}</div>`)}</div>
      <div class="mb-3">${card("Payment history", pays.length ? responsive(html`<table class="table"><tbody>${pays.map((p) => html`<tr><td>${formatDate(p.paidOn)}<div class="small text-muted">${p.method || ""} ${p.reference || ""}</div></td><td>${inr(p.amount, 2)}</td>
        <td class="text-end">${actionBtn("delete-commitment-payment", "Delete", { id: p.id })}</td></tr>`)}</tbody></table>`) : html`<div class="card-body">${empty("No payments recorded yet.")}</div>`)}</div>
      ${c.status === "active" ? card("Record a payment", html`<div class="card-body">${formHtml(paySpec)}</div>`) : ""}</div></div>` };
}

actions["delete-commitment"] = async ({ id }) => {
  const c = await db.get("commitments", Number(id));
  const has = (await db.all("commitmentPayments")).some((p) => p.commitmentId === c.id);
  if (!confirm("Delete? If it has payments it is marked cancelled instead and the history stays.")) return;
  if (has) { await db.put("commitments", { ...c, status: "cancelled" }); toast("It has payment history, so it was marked cancelled instead of deleted.", "warning"); }
  else { await db.remove("commitments", c.id); toast("Deleted.", "info"); }
  navigate(`/commitments?kind=${c.kind}`);
};
actions["delete-commitment-payment"] = async ({ id }) => {
  if (!confirm("Delete this payment? Check the next due date is still right afterwards.")) return;
  await db.remove("commitmentPayments", Number(id)); toast("Payment removed. Check the next due date is still right.", "info"); refresh();
};

/* ---------- simple lists ---------- */
function simple({ slug, store, title, singular, fields, columns, order, monthField, defaults = {}, beforeDelete }) {
  const listPath = `/${slug}`;
  const spec = (row, fresh = defaults) => ({ id: slug, fields: typeof fields === "function" ? fields() : fields, values: row || fresh, cancelHref: `#${listPath}`,
    async onSubmit(v) { await db.put(store, { ...(row || {}), ...v }); toast(row ? "Saved." : `${singular} added.`); navigate(listPath); } });
  return {
    list: async ({ query }) => {
      const start = monthField ? parseMonth(query.get("month")) : null;
      let rows = await db.all(store);
      if (monthField) rows = rows.filter((r) => r[monthField] >= start && r[monthField] < addMonths(start, 1));
      rows.sort(order);
      const total = monthField ? sum(rows, (r) => r.amount) : null;
      return { title, html: html`${pageHeader(title, "", html`<a class="btn btn-primary" href="#${listPath}/new"><i class="bi bi-plus-lg"></i> Add ${singular.toLowerCase()}</a>`)}
        ${monthField ? html`<div class="d-flex flex-wrap align-items-center gap-2 mb-3"><a class="btn btn-outline-secondary" href="#${listPath}?month=${addMonths(start, -1).slice(0, 7)}" aria-label="Previous month"><i class="bi bi-chevron-left"></i></a>
          <strong class="px-2">${monthLabel(start)}</strong><a class="btn btn-outline-secondary" href="#${listPath}?month=${addMonths(start, 1).slice(0, 7)}" aria-label="Next month"><i class="bi bi-chevron-right"></i></a>
          <span class="ms-auto fw-bold">Total: ${inr(total, 2)}</span></div>` : ""}
        ${tableCard(rows.length ? responsive(html`<table class="table table-hover"><thead><tr>${columns.map(([h]) => html`<th>${h}</th>`)}<th></th></tr></thead><tbody>
          ${rows.map((r) => html`<tr>${columns.map(([, cell]) => html`<td>${cell(r)}</td>`)}<td class="text-end text-nowrap"><a class="btn btn-sm btn-outline-secondary" href="#${listPath}/${r.id}">Edit</a> ${actionBtn(`delete-${slug}`, "Delete", { id: r.id })}</td></tr>`)}</tbody></table>`)
          : html`<div class="card-body">${empty("Nothing here yet.")}</div>`)}` };
    },
    newForm: async ({ query }) => {
      const fresh = typeof defaults === "function" ? await defaults(query) : defaults;
      return { title: `Add ${singular.toLowerCase()}`, html: html`${pageHeader(`Add ${singular.toLowerCase()}`, fresh.hint || "")}<div class="card"><div class="card-body">${formHtml(spec(null, fresh))}</div></div>` };
    },
    editForm: async ({ params }) => {
      const row = await db.get(store, Number(params.id));
      if (!row) return notFound();
      return { title: `Edit ${singular.toLowerCase()}`, html: html`${pageHeader(`Edit ${singular.toLowerCase()}`)}<div class="card"><div class="card-body">${formHtml(spec(row))}</div></div>` };
    },
    register() {
      actions[`delete-${slug}`] = async ({ id }) => {
        if (!confirm("Delete this entry?")) return;
        const row = await db.get(store, Number(id));
        const handled = beforeDelete ? await beforeDelete(row) : false;
        if (!handled) { await db.remove(store, row.id); toast("Deleted.", "info"); }
        refresh();
      };
    },
  };
}

export const income = simple({ slug: "income", store: "income", title: "Salary & income", singular: "Income", monthField: "receivedOn",
  // Prefill from the last entry of the same type so a monthly salary is: open, check the amount, Save.
  async defaults(query) {
    const kind = INCOME_KINDS.some(([k]) => k === query.get("kind")) ? query.get("kind") : "salary";
    const last = (await db.all("income")).filter((i) => i.kind === kind).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.id - a.id)[0];
    return { receivedOn: todayISO(), kind, source: last?.source ?? null, amount: last?.amount ?? null,
      hint: last ? `Prefilled from your last ${L.income[kind].toLowerCase()} (${formatDate(last.receivedOn)}) – change the amount if it differs.` : "" };
  },
  fields: () => [date("receivedOn", "Date received", { required: true }), { name: "kind", label: "Type", type: "select", options: INCOME_KINDS }, text("source", "Source (e.g. employer)", { max: 120 }), money("amount", "Amount (₹)", { required: true, positive: true }), area()],
  columns: [["Date", (r) => formatDate(r.receivedOn)], ["Type", (r) => L.income[r.kind]], ["Source", (r) => r.source || "—"], ["Amount", (r) => inr(r.amount, 2)]],
  order: (a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.id - a.id });
export const expenses = simple({ slug: "expenses", store: "expenses", title: "Everyday expenses", singular: "Expense", monthField: "spentOn",
  defaults: { spentOn: todayISO(), category: "Miscellaneous" },
  fields: () => [date("spentOn", "Date", { required: true }), { name: "category", label: "Category", type: "select", options: EXPENSE_CATEGORIES.map((c) => [c, c]) }, text("description", "Description"), money("amount", "Amount (₹)", { required: true, positive: true }),
    { name: "method", label: "Payment method", type: "select", options: METHODS.map((m) => [m, m || "—"]) }, area()],
  columns: [["Date", (r) => formatDate(r.spentOn)], ["Category", (r) => r.category], ["Description", (r) => r.description || "—"], ["Method", (r) => r.method || "—"], ["Amount", (r) => inr(r.amount, 2)]],
  order: (a, b) => b.spentOn.localeCompare(a.spentOn) || b.id - a.id });
export const investments = simple({ slug: "investments", store: "investments", title: "Investments", singular: "Investment",
  defaults: { kind: "mutual_fund", isActive: true, valueAsOf: todayISO() },
  fields: () => [text("name", "Name (fund / company)", { required: true, max: 160 }), { name: "kind", label: "Type", type: "select", options: INVESTMENT_TYPES }, text("platform", "Platform / broker", { max: 120 }),
    money("investedAmount", "Total invested (₹)", { required: true }), money("currentValue", "Current value (₹)"), date("valueAsOf", "Value as of"), { name: "isActive", label: "Still held", type: "checkbox", default: true }, area()],
  columns: [["Name", (r) => r.name], ["Type", (r) => L.investment[r.kind]], ["Platform", (r) => r.platform || "—"], ["Invested", (r) => inr(r.investedAmount)], ["Current value", (r) => inr(r.currentValue)],
    ["Gain / loss", (r) => (r.currentValue == null ? "—" : `${inr(r.currentValue - r.investedAmount)}${r.investedAmount ? ` (${(((r.currentValue - r.investedAmount) / r.investedAmount) * 100).toFixed(1)}%)` : ""}`)],
    ["Held", (r) => (r.isActive === false ? "Sold" : "Yes")]],
  order: (a, b) => Number(b.isActive !== false) - Number(a.isActive !== false) || a.name.localeCompare(b.name) });
export const members = simple({ slug: "members", store: "members", title: "Family members", singular: "Family member", defaults: { isActive: true },
  fields: () => [text("name", "Name", { required: true, max: 80 }), { name: "isActive", label: "Active", type: "checkbox", default: true }],
  columns: [["Name", (r) => r.name], ["Active", (r) => (r.isActive === false ? "No" : "Yes")]], order: (a, b) => a.id - b.id,
  async beforeDelete(row) {
    if ((await db.all("commitments")).some((c) => c.memberId === row.id)) {
      await db.put("members", { ...row, isActive: false }); toast("Plans are linked to this member, so they were marked inactive instead.", "warning"); return true;
    }
    toast("Deleted.", "info"); await db.remove("members", row.id); return true;
  } });
for (const s of [income, expenses, investments, members]) s.register();

/** One tap: the item was paid in full today. Plans move to their next due date; bills record the outstanding amount. */
actions["pay-due"] = async ({ type, id }) => {
  const snap = await db.loadAll();
  const today = todayISO();
  if (type === "bill") {
    const b = snap.bills.find((x) => x.id === Number(id));
    const out = billOutstanding(b, snap.billPayments);
    if (!out || !confirm(`Mark ${inr(out, 2)} for "${b.name}" as paid today?`)) return;
    await db.put("billPayments", { billId: b.id, amount: out, paidOn: today, method: null, reference: null, notes: "Marked paid" });
    toast(`${inr(out)} marked as paid.`);
  } else {
    const c = snap.commitments.find((x) => x.id === Number(id));
    if (!confirm(`Record ${inr(c.amount, 2)} for "${c.name}" as paid today? Its next due date moves forward.\n\nFor a different amount or date, open it and use "Record a payment".`)) return;
    const { commitment, payment } = recordPayment(c, paymentsOf(c, snap.commitmentPayments), { amount: c.amount, paidOn: today, notes: "Marked paid", advanceDue: true });
    await db.batch(["commitments", "commitmentPayments"], async (tx) => { await tx.put("commitments", commitment); await tx.put("commitmentPayments", payment); });
    toast(`${inr(c.amount)} marked as paid.${commitment.nextDueDate ? ` Next due ${formatDate(commitment.nextDueDate)}.` : ""}`);
  }
  refresh();
};
