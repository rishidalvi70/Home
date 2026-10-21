import { INVESTMENT_KINDS, L } from "../constants.js";
import { addDays, addMonths, shortMonth, todayISO } from "../lib/dates.js";
import { rupees, sum } from "../lib/money.js";
import { billOutstanding } from "./bills.js";
import { obOutstanding } from "./rent.js";

const inMonth = (iso, start, end) => iso >= start && iso < end;
const add = (obj, key, amt) => { obj[key] = (obj[key] || 0) + amt; };

/** Actual cash figures for one calendar month (all amounts in paise). */
export function monthFigures(snap, start) {
  const end = addMonths(start, 1);
  const prop = new Map(snap.properties.map((p) => [p.id, p]));
  const obl = new Map(snap.obligations.map((o) => [o.id, o]));
  const mine = (propertyId) => prop.get(propertyId)?.rentCollectedBy === "me";

  let rentReceivedMine = 0, rentReceivedFamily = 0, rentExpectedMine = 0, rentExpectedFamily = 0;
  for (const p of snap.rentPayments) {
    const ob = obl.get(p.obligationId);
    if (!ob || !inMonth(p.paidOn, start, end)) continue;
    if (mine(ob.propertyId)) rentReceivedMine += p.amount; else rentReceivedFamily += p.amount;
  }
  for (const ob of snap.obligations) {
    if (ob.isCancelled || !inMonth(ob.periodStart, start, end)) continue;
    if (mine(ob.propertyId)) rentExpectedMine += ob.expectedAmount; else rentExpectedFamily += ob.expectedAmount;
  }

  const salary = sum(snap.income.filter((i) => i.kind === "salary" && inMonth(i.receivedOn, start, end)), (i) => i.amount);
  const otherIncome = sum(snap.income.filter((i) => i.kind !== "salary" && inMonth(i.receivedOn, start, end)), (i) => i.amount);

  const bills = new Map(snap.bills.map((b) => [b.id, b]));
  const byBillCategory = {};
  for (const p of snap.billPayments) {
    const b = bills.get(p.billId);
    if (b && !b.isCancelled && inMonth(p.paidOn, start, end)) add(byBillCategory, L.category[b.category] || b.category, p.amount);
  }

  const commitments = new Map(snap.commitments.map((c) => [c.id, c]));
  const byCommitment = {};
  let investments = 0;
  for (const p of snap.commitmentPayments) {
    const c = commitments.get(p.commitmentId);
    if (!c || !inMonth(p.paidOn, start, end)) continue;
    if (INVESTMENT_KINDS.has(c.kind)) investments += p.amount; else add(byCommitment, L.kind[c.kind] || c.kind, p.amount);
  }

  const everyday = {};
  for (const e of snap.expenses) if (inMonth(e.spentOn, start, end)) add(everyday, e.category, e.amount);
  const misc = sum(Object.values(everyday));

  const propertyExpenses = sum(Object.values(byBillCategory));
  const personalExpenses = sum(Object.values(byCommitment)) + misc;
  const categories = { ...byBillCategory };
  for (const [k, v] of Object.entries(byCommitment)) add(categories, k, v);
  for (const [k, v] of Object.entries(everyday)) add(categories, k, v);

  const totalIncome = salary + otherIncome + rentReceivedMine;
  const totalExpenses = propertyExpenses + personalExpenses;
  return {
    start, salary, otherIncome, rentReceivedMine, rentExpectedMine, rentExpectedFamily, rentReceivedFamily,
    totalIncome, propertyExpenses, personalExpenses, misc, byCommitment, byBillCategory, categories,
    totalExpenses, investments, remaining: totalIncome - totalExpenses - investments,
  };
}

/** Rent still unpaid for obligations due before `until`, split mine vs family-collected. */
export function outstandingRent(snap, until) {
  const prop = new Map(snap.properties.map((p) => [p.id, p]));
  let mine = 0, family = 0;
  for (const ob of snap.obligations) {
    if (ob.isCancelled || ob.dueDate >= until) continue;
    const out = obOutstanding(ob, snap.rentPayments);
    if (prop.get(ob.propertyId)?.rentCollectedBy === "me") mine += out; else family += out;
  }
  return { mine, family };
}

/** Things due in the next `days` days, plus anything overdue, oldest first. */
export function upcomingItems(snap, days, today = todayISO()) {
  const limit = addDays(today, days);
  const prop = new Map(snap.properties.map((p) => [p.id, p]));
  const tenants = new Map(snap.tenants.map((t) => [t.id, t]));
  const items = [];
  for (const b of snap.bills) {
    if (b.isCancelled || !b.dueDate || b.dueDate > limit) continue;
    const out = billOutstanding(b, snap.billPayments);
    if (out > 0) items.push({ date: b.dueDate, label: `${b.name} (${prop.get(b.propertyId)?.name ?? "?"})`, amount: out, type: "Bill", href: `#/bills/${b.id}` });
  }
  for (const c of snap.commitments) {
    if (c.status === "active" && c.nextDueDate && c.nextDueDate <= limit)
      items.push({ date: c.nextDueDate, label: c.name, amount: c.amount, type: L.kind[c.kind], href: `#/commitments/${c.id}` });
  }
  for (const ob of snap.obligations) {
    if (ob.isCancelled || ob.dueDate > limit) continue;
    const out = obOutstanding(ob, snap.rentPayments);
    if (out <= 0) continue;
    const p = prop.get(ob.propertyId);
    const who = p?.rentCollectedBy === "me" ? "" : ` – goes to ${L.collector[p?.rentCollectedBy] ?? "family"}`;
    items.push({ date: ob.dueDate, label: `Rent ${p?.name ?? "?"} (${tenants.get(ob.tenantId)?.name ?? "?"})${who}`, amount: out, type: "Rent", href: `#/rent/${ob.id}` });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items.map((i) => ({ ...i, overdue: i.date < today }));
}

/** Everything still to be paid for a month (and anything overdue from before): unpaid bills, plans, EMIs, SIPs. */
export function dueThisMonth(snap, start, today = todayISO()) {
  const end = addMonths(start, 1);
  const prop = new Map(snap.properties.map((p) => [p.id, p]));
  const items = [];
  for (const b of snap.bills) {
    if (b.isCancelled || !b.dueDate || b.dueDate >= end) continue;
    const out = billOutstanding(b, snap.billPayments);
    if (out > 0) items.push({ type: "bill", id: b.id, label: `${b.name} (${prop.get(b.propertyId)?.name ?? "?"})`, kind: "Bill", amount: out, date: b.dueDate, href: `#/bills/${b.id}`, investment: false });
  }
  for (const c of snap.commitments) {
    if (c.status !== "active" || !c.nextDueDate || c.nextDueDate >= end) continue;
    items.push({ type: "commitment", id: c.id, label: c.name, kind: L.kind[c.kind] || c.kind, amount: c.amount, date: c.nextDueDate, href: `#/commitments/${c.id}`, investment: INVESTMENT_KINDS.has(c.kind) });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items.map((i) => ({ ...i, overdue: i.date < today }));
}

export function dashboardSummary(snap, start, today = todayISO()) {
  const end = addMonths(start, 1);
  const month = monthFigures(snap, start);
  const counts = {};
  for (const p of snap.properties) if (!p.archivedAt) add(counts, p.occupancyStatus, 1);

  const due = dueThisMonth(snap, start, today);
  const dueBills = sum(due.filter((i) => i.type === "bill"), (i) => i.amount);
  const dueCommitments = sum(due.filter((i) => i.type === "commitment" && !i.investment), (i) => i.amount);
  const dueInvestments = sum(due.filter((i) => i.investment), (i) => i.amount);
  const stillToPay = dueBills + dueCommitments + dueInvestments;

  const history = [];
  for (let n = 5; n >= 0; n--) history.push(monthFigures(snap, addMonths(start, -n)));
  return {
    start, today, prevMonth: addMonths(start, -1).slice(0, 7), nextMonth: addMonths(start, 1).slice(0, 7),
    activeProperties: Object.values(counts).reduce((a, b) => a + b, 0),
    archivedProperties: snap.properties.filter((p) => p.archivedAt).length,
    counts, month, owed: outstandingRent(snap, end), dueBills, dueCommitments, dueInvestments, stillToPay,
    leftAfterDues: month.remaining - stillToPay,
    next7: upcomingItems(snap, 7, today), next30: upcomingItems(snap, 30, today),
    chart: {
      months: history.map((h) => shortMonth(h.start)),
      income: history.map((h) => rupees(h.totalIncome)),
      expenses: history.map((h) => rupees(h.totalExpenses + h.investments)),
      categories: Object.fromEntries(Object.entries(month.categories).filter(([, v]) => v).map(([k, v]) => [k, rupees(v)])),
      rentExpected: history.map((h) => rupees(h.rentExpectedMine + h.rentExpectedFamily)),
      rentReceived: history.map((h) => rupees(h.rentReceivedMine + h.rentReceivedFamily)),
    },
  };
}

