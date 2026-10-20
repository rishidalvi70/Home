import { db } from "../db.js";
import { dashboardSummary } from "../domain/dashboard.js";
import { formatDate, monthLabel, parseMonth, todayISO } from "../lib/dates.js";
import { html } from "../lib/html.js";
import { inr } from "../lib/money.js";
import { drawCharts } from "../ui/charts.js";
import { card, empty, pageHeader, responsive, stat } from "./common.js";

const chart = (cfg, label) => html`<div class="chart-box"><canvas data-chart="${JSON.stringify(cfg)}" aria-label="${label}" role="img"></canvas></div>`;

function upcoming(items, today) {
  if (!items.length) return html`<div class="card-body">${empty("Nothing due in this window.")}</div>`;
  return responsive(html`<table class="table"><thead><tr><th>Due</th><th>What</th><th class="d-none d-sm-table-cell">Type</th><th class="text-end">Amount</th></tr></thead><tbody>
    ${items.map((i) => html`<tr><td class="text-nowrap">${formatDate(i.date)}${i.overdue ? html` <span class="badge badge-soft text-bg-danger">overdue</span>` : i.date === today ? html` <span class="badge badge-soft text-bg-warning">today</span>` : ""}</td>
      <td><a href="${i.href}">${i.label}</a></td><td class="d-none d-sm-table-cell">${i.type}</td><td class="text-end">${inr(i.amount)}</td></tr>`)}</tbody></table>`);
}

export async function dashboard({ query }) {
  const snap = await db.loadAll();
  const start = parseMonth(query.get("month"));
  const s = dashboardSummary(snap, start, todayISO());
  const m = s.month;
  const c = s.chart;
  const body = html`
  ${pageHeader("Dashboard", "Actual money in and out – calculated from your records", html`
    <a class="btn btn-primary" href="#/income/new?kind=salary"><i class="bi bi-plus-lg"></i> Add salary</a>
    <a class="btn btn-outline-secondary" href="#/?month=${s.prevMonth}" aria-label="Previous month"><i class="bi bi-chevron-left"></i></a>
    <strong class="px-1">${monthLabel(start)}</strong>
    <a class="btn btn-outline-secondary" href="#/?month=${s.nextMonth}" aria-label="Next month"><i class="bi bi-chevron-right"></i></a>`)}
  <div class="row g-3">
    <div class="col-6 col-xl-3">${stat("Money in", inr(m.totalIncome), "arrow-down-circle", "success", `Salary ${inr(m.salary)} · my rent ${inr(m.rentReceivedMine)}`)}</div>
    <div class="col-6 col-xl-3">${stat("Spent (paid)", inr(m.totalExpenses), "arrow-up-circle", "danger", "Only payments actually made")}</div>
    <div class="col-6 col-xl-3">${stat("Invested (SIPs)", inr(m.investments), "graph-up-arrow", "primary")}</div>
    <div class="col-6 col-xl-3">${stat("Left so far", inr(m.remaining), "piggy-bank", "primary", "In − spent − invested")}</div>
    <div class="col-6 col-xl-3">${stat("Still to pay this month", inr(s.stillToPay), "hourglass-split", "warning", "Bills + plans + EMIs + SIPs not yet paid")}</div>
    <div class="col-6 col-xl-3">${stat("Left after all dues", inr(s.leftAfterDues), "wallet2", s.leftAfterDues >= 0 ? "success" : "danger", "If everything due is paid")}</div>
    <div class="col-6 col-xl-3">${stat("My rent still to collect", inr(s.owed.mine), "cash-coin", "danger", "Outstanding up to this month")}</div>
    <div class="col-6 col-xl-3">${stat("Family-collected rent owed", inr(s.owed.family), "people", "secondary", "Collected by father / mother")}</div>
  </div>

  <div class="section-title">Rent</div>
  <div class="row g-3">
    <div class="col-12 col-lg-6">${card("Rooms where I collect rent", html`<div class="card-body"><dl class="kv"><dt>Expected this month</dt><dd>${inr(m.rentExpectedMine)}</dd><dt>Received this month</dt><dd>${inr(m.rentReceivedMine)}</dd></dl></div>`)}</div>
    <div class="col-12 col-lg-6">${card("Rooms collected by family", html`<div class="card-body"><dl class="kv"><dt>Expected this month</dt><dd>${inr(m.rentExpectedFamily)}</dd><dt>Received this month</dt><dd>${inr(m.rentReceivedFamily)}</dd></dl>
      <p class="small text-muted mb-0">Tracked for the record – not counted as your income.</p></div>`)}</div>
  </div>

  <div class="section-title">Spending this month (actual payments)</div>
  <div class="row g-3">
    <div class="col-6 col-lg-3">${stat("Property bills", inr(m.propertyExpenses), "buildings", "primary", "Only bills I paid")}</div>
    ${["Mobile plan", "Subscription", "EMI / Loan", "LIC / Insurance"].map((k) => html`<div class="col-6 col-lg-3">${stat(k, inr(m.byCommitment[k] || 0), "receipt", "secondary")}</div>`)}
    <div class="col-6 col-lg-3">${stat("Everyday / misc", inr(m.misc), "basket", "secondary")}</div>
  </div>

  <div class="section-title">Trends</div>
  <div class="row g-3">
    <div class="col-12 col-xl-6">${card("Income vs spending (6 months)", html`<div class="card-body">${chart({ type: "bar", labels: c.months, datasets: [{ label: "Income", data: c.income, color: "#16a34a" }, { label: "Spent + invested", data: c.expenses, color: "#e11d48" }] }, "Income versus spending by month")}</div>`)}</div>
    <div class="col-12 col-xl-6">${card("Spending by category", html`<div class="card-body">${Object.keys(c.categories).length
      ? chart({ type: "doughnut", labels: Object.keys(c.categories), datasets: [{ label: "Spent", data: Object.values(c.categories) }] }, "Spending by category")
      : empty("No payments this month yet.")}</div>`)}</div>
    <div class="col-12 col-xl-6">${card("Rent expected vs collected (all rooms)", html`<div class="card-body">${chart({ type: "bar", labels: c.months, datasets: [{ label: "Expected", data: c.rentExpected, color: "#6366f1" }, { label: "Collected", data: c.rentReceived, color: "#16a34a" }] }, "Rent expected versus collected")}</div>`)}</div>
    <div class="col-12 col-xl-6">${card("Properties", html`<div class="card-body"><div class="row g-2">
      <div class="col-6"><div class="stat-label">Active</div><div class="stat-value" data-testid="active-properties">${s.activeProperties}</div></div>
      <div class="col-6"><div class="stat-label">Archived</div><div class="stat-value">${s.archivedProperties}</div></div>
      ${Object.entries(s.counts).map(([k, n]) => html`<div class="col-6"><div class="stat-label">${k.replace(/_/g, " ")}</div><div class="stat-value">${n}</div></div>`)}
    </div></div>`)}</div>
  </div>

  <div class="section-title">Upcoming payments</div>
  <div class="row g-3">
    <div class="col-12 col-xl-6">${card("Next 7 days (and overdue)", upcoming(s.next7, s.today))}</div>
    <div class="col-12 col-xl-6">${card("Next 30 days (and overdue)", upcoming(s.next30, s.today))}</div>
  </div>`;
  return { title: "Dashboard", html: body, after: (root) => drawCharts(root) };
}
