import test from "node:test";
import assert from "node:assert/strict";
import { buildRevision, incrementReminders, obStatus, obOutstanding, obReceived, obligationsToCreate, previewObligations, rentFor, suggestedNewRent, revisionPercent } from "../js/domain/rent.js";
import { billOutstanding, billPaid, billStatus, myShare } from "../js/domain/bills.js";
import { dueState, installmentsLeft, monthlyCost, recordPayment, remainingAmount, totalPaid, withAnchor } from "../js/domain/commitments.js";
import { dashboardSummary, dueThisMonth, monthFigures, outstandingRent, upcomingItems } from "../js/domain/dashboard.js";
import { propertyReport } from "../js/domain/reports.js";

const R = (n) => n * 100; // rupees -> paise
const empty = () => ({ properties: [], connections: [], tenants: [], revisions: [], obligations: [], rentPayments: [],
  bills: [], billPayments: [], commitments: [], commitmentPayments: [], income: [], expenses: [], investments: [], members: [] });
const prop = (id, name, collector = "me", extra = {}) => ({ id, name, occupancyStatus: "rented", rentCollectedBy: collector, archivedAt: null, ...extra });
const tenant = (id, propertyId, rent, extra = {}) => ({ id, propertyId, name: `T${id}`, monthlyRent: R(rent), rentDueDay: 5, startDate: "2026-01-01", endDate: null, isActive: true, ...extra });

test("rent history uses the rent in force", () => {
  const t = tenant(1, 1, 5000);
  const revs = [{ tenantId: 1, effectiveFrom: "2026-04-01", oldRent: R(5000), newRent: R(5500) },
    { tenantId: 1, effectiveFrom: "2027-04-01", oldRent: R(5500), newRent: R(6000) }];
  assert.equal(rentFor(t, revs, "2026-03-01"), R(5000));
  assert.equal(rentFor(t, revs, "2026-04-01"), R(5500));
  assert.equal(rentFor(t, revs, "2027-03-31"), R(5500));
  assert.equal(rentFor(t, revs, "2027-04-01"), R(6000));
  assert.equal(revisionPercent(revs[0]), 10);
});

test("buildRevision tracks old rent and current rent", () => {
  const t = tenant(1, 1, 5000);
  const a = buildRevision(t, [], "2026-04-01", R(5500), "yearly", "2026-10-12");
  assert.equal(a.revision.oldRent, R(5000));
  assert.equal(a.currentRent, R(5500));
  const future = buildRevision(t, [a.revision], "2027-04-01", R(6000), null, "2026-10-12");
  assert.equal(future.revision.oldRent, R(5500));
  assert.equal(future.currentRent, R(5500)); // not effective yet
});

test("suggested rent from planned percent", () => {
  assert.equal(suggestedNewRent(tenant(1, 1, 5000, { incrementPercent: 5 })), R(5250));
  assert.equal(suggestedNewRent(tenant(1, 1, 5000)), null);
});

test("generation previews, never duplicates, uses that month's rent", () => {
  const s = empty();
  s.properties = [prop(1, "Room 2")];
  s.tenants = [tenant(1, 1, 5000, { rentDueDay: 31 })];
  s.revisions = [{ tenantId: 1, effectiveFrom: "2026-03-01", oldRent: R(5000), newRent: R(5500) }];
  const feb = previewObligations(s, "2026-02-01");
  assert.equal(feb.length, 1);
  assert.equal(feb[0].amount, R(5000));
  assert.equal(feb[0].dueDate, "2026-02-28");
  const made = obligationsToCreate(s, "2026-02-01", new Set([1]));
  assert.equal(made.length, 1);
  s.obligations = made.map((o, i) => ({ ...o, id: i + 1 }));
  assert.equal(obligationsToCreate(s, "2026-02-01", new Set([1])).length, 0);
  assert.equal(previewObligations(s, "2026-02-01")[0].exists, true);
  assert.equal(obligationsToCreate(s, "2026-03-01", new Set([1]))[0].expectedAmount, R(5500));
});

test("generation never marks rent received", () => {
  const s = empty();
  s.properties = [prop(1, "R")]; s.tenants = [tenant(1, 1, 5000)];
  const [ob] = obligationsToCreate(s, "2026-05-01", new Set([1]));
  assert.equal(obReceived({ ...ob, id: 1 }, []), 0);
  assert.equal(obOutstanding({ ...ob, id: 1 }, []), R(5000));
});

test("tenancy dates, former tenants and archived properties limit generation", () => {
  const s = empty();
  s.properties = [prop(1, "R")];
  s.tenants = [tenant(1, 1, 5000, { startDate: "2026-06-10", endDate: "2026-08-15" })];
  assert.equal(previewObligations(s, "2026-05-01").length, 0);
  assert.equal(previewObligations(s, "2026-06-01").length, 1);
  assert.equal(previewObligations(s, "2026-08-01").length, 1);
  assert.equal(previewObligations(s, "2026-09-01").length, 0);
  s.tenants[0].isActive = false;
  assert.equal(previewObligations(s, "2026-06-01").length, 0);
  s.tenants[0].isActive = true; s.properties[0].archivedAt = "2026-01-01";
  assert.equal(previewObligations(s, "2026-06-01").length, 0);
});

test("partial and multiple rent payments", () => {
  const ob = { id: 1, expectedAmount: R(5000), dueDate: "2026-05-05", isCancelled: false };
  const pays = [{ obligationId: 1, amount: R(2000), paidOn: "2026-05-06" }];
  assert.equal(obOutstanding(ob, pays), R(3000));
  assert.equal(obStatus(ob, pays, "2026-05-10"), "overdue");
  assert.equal(obStatus(ob, pays, "2026-05-01"), "partial");
  pays.push({ obligationId: 1, amount: R(3000), paidOn: "2026-05-20" });
  assert.equal(obOutstanding(ob, pays), 0);
  assert.equal(obStatus(ob, pays), "paid");
  assert.equal(obStatus({ ...ob, isCancelled: true }, [], "2026-06-01"), "cancelled");
  assert.equal(obStatus(ob, [], "2026-05-01"), "upcoming");
});

test("increment reminders", () => {
  const s = empty();
  s.tenants = [tenant(1, 1, 5000, { nextIncrementDate: "2026-11-01" }), tenant(2, 1, 5000, { nextIncrementDate: "2027-06-01" })];
  assert.deepEqual(incrementReminders(s, 60, "2026-10-12").map((t) => t.id), [1]);
});

const bill = (extra) => ({ id: 1, propertyId: 1, category: "electricity", name: "Light", amount: R(1000), responsible: "owner", ownerShare: null, isCancelled: false, dueDate: null, ...extra });

test("owner bill flow and statuses", () => {
  const b = bill({ dueDate: "2026-10-20" });
  assert.deepEqual([myShare(b), billOutstanding(b, []), billStatus(b, [], "2026-10-12")], [R(1000), R(1000), "unpaid"]);
  const p = [{ billId: 1, amount: R(400) }];
  assert.deepEqual([billPaid(b, p), billOutstanding(b, p), billStatus(b, p, "2026-10-12")], [R(400), R(600), "partial"]);
  p.push({ billId: 1, amount: R(600) });
  assert.equal(billStatus(b, p, "2026-10-12"), "paid");
});

test("passing a due date never marks a bill paid", () => {
  const b = bill({ dueDate: "2026-10-01" });
  assert.equal(billStatus(b, [], "2026-10-12"), "overdue");
  assert.equal(billPaid(b, []), 0);
});

test("tenant-paid, shared and cancelled bills", () => {
  assert.deepEqual([myShare(bill({ responsible: "tenant" })), billStatus(bill({ responsible: "tenant" }), [])], [0, "not_mine"]);
  assert.equal(myShare(bill({ responsible: "other" })), 0);
  assert.equal(myShare(bill({ responsible: "shared", ownerShare: R(400) })), R(400));
  assert.equal(myShare(bill({ responsible: "shared", ownerShare: R(5000) })), R(1000)); // capped
  assert.equal(myShare(bill({ responsible: "shared" })), 0);
  const c = bill({ isCancelled: true });
  assert.deepEqual([myShare(c), billOutstanding(c, []), billStatus(c, [])], [0, 0, "cancelled"]);
});

const commit = (extra) => ({ id: 1, kind: "subscription", name: "Netflix", amount: R(649), frequency: "monthly", nextDueDate: "2026-01-31", status: "active", installmentsDone: 0, ...extra });

test("payment moves due date without month-end drift", () => {
  let c = withAnchor(commit());
  assert.equal(c.dueDay, 31);
  const r1 = recordPayment(c, [], { amount: R(649), paidOn: "2026-01-30" });
  assert.equal(r1.commitment.nextDueDate, "2026-02-28");
  const r2 = recordPayment(r1.commitment, [r1.payment], { amount: R(649), paidOn: "2026-02-27" });
  assert.equal(r2.commitment.nextDueDate, "2026-03-31");
});

test("payment date is separate from due date; can log without advancing", () => {
  const c = commit({ nextDueDate: "2026-03-10" });
  const r = recordPayment(c, [], { amount: R(649), paidOn: "2026-03-02" });
  assert.deepEqual([r.payment.paidOn, r.payment.forDueDate, r.commitment.nextDueDate], ["2026-03-02", "2026-03-10", "2026-04-10"]);
  assert.equal(recordPayment(c, [], { amount: R(10), paidOn: "2026-03-02", advanceDue: false }).commitment.nextDueDate, "2026-03-10");
});

test("price change keeps history; cancellation keeps records", () => {
  const c = commit();
  const a = recordPayment(c, [], { amount: R(649), paidOn: "2026-01-31" });
  const c2 = { ...a.commitment, amount: R(799) };
  const b = recordPayment(c2, [a.payment], { amount: R(799), paidOn: "2026-02-28" });
  assert.equal(totalPaid(c, [{ ...a.payment, commitmentId: 1 }, { ...b.payment, commitmentId: 1 }]), R(1448));
  assert.equal(dueState({ ...c, status: "cancelled" }), "cancelled");
});

test("EMI counts down and closes", () => {
  const c = commit({ kind: "emi", amount: R(10000), totalInstallments: 3, installmentsDone: 1, nextDueDate: "2026-05-05" });
  assert.deepEqual([installmentsLeft(c, []), remainingAmount(c, [])], [2, R(20000)]);
  const a = recordPayment(c, [], { amount: R(10000), paidOn: "2026-05-05" });
  assert.deepEqual([a.commitment.status, installmentsLeft(a.commitment, [a.payment])], ["active", 1]);
  const b = recordPayment(a.commitment, [a.payment], { amount: R(10000), paidOn: "2026-06-05" });
  assert.deepEqual([b.commitment.status, b.commitment.nextDueDate], ["closed", null]);
});

test("prepaid expiry follows the recharge; manual correction kept", () => {
  const c = commit({ kind: "mobile", planType: "prepaid", validityDays: 84, amount: R(299), nextDueDate: "2026-05-01" });
  const r = recordPayment(c, [], { amount: R(299), paidOn: "2026-05-01" });
  assert.deepEqual([r.commitment.expiryDate, r.commitment.nextDueDate], ["2026-07-24", "2026-07-24"]);
  assert.equal({ ...r.commitment, expiryDate: "2026-07-30" }.expiryDate, "2026-07-30");
});

test("postpaid uses billing frequency; LIC half-yearly; one-time", () => {
  const post = commit({ kind: "mobile", planType: "postpaid", amount: R(499), nextDueDate: "2026-05-20" });
  const r = recordPayment(post, [], { amount: R(520), paidOn: "2026-05-18" });
  assert.deepEqual([r.commitment.nextDueDate, r.payment.amount], ["2026-06-20", R(520)]);
  const lic = withAnchor(commit({ kind: "insurance", frequency: "half_yearly", amount: R(12000), nextDueDate: "2026-08-31" }));
  assert.equal(recordPayment(lic, [], { amount: R(12000), paidOn: "2026-08-30" }).commitment.nextDueDate, "2027-02-28");
  assert.equal(recordPayment(commit({ frequency: "one_time" }), [], { amount: 1, paidOn: "2026-01-31" }).commitment.nextDueDate, null);
});

test("monthly cost estimates", () => {
  assert.equal(monthlyCost(commit({ amount: R(1200), frequency: "yearly" })), R(100));
  assert.equal(monthlyCost(commit({ amount: R(300), frequency: "quarterly" })), R(100));
  assert.equal(monthlyCost(commit({ amount: R(100), frequency: "weekly" })), 43333);
  assert.equal(monthlyCost(commit({ amount: R(500), frequency: "one_time" })), 0);
  assert.equal(monthlyCost(commit({ amount: R(100), frequency: "custom", intervalDays: 30 })), 10139);
});

function world() {
  const s = empty();
  s.properties = [prop(1, "Room 2", "me"), prop(2, "Room 3", "father")];
  s.tenants = [tenant(1, 1, 5000), tenant(2, 2, 6000)];
  s.obligations = [
    { id: 1, propertyId: 1, tenantId: 1, periodStart: "2026-05-01", expectedAmount: R(5000), dueDate: "2026-05-05", isCancelled: false },
    { id: 2, propertyId: 2, tenantId: 2, periodStart: "2026-05-01", expectedAmount: R(6000), dueDate: "2026-05-05", isCancelled: false },
  ];
  s.rentPayments = [{ id: 1, obligationId: 1, amount: R(5000), paidOn: "2026-05-06" }, { id: 2, obligationId: 2, amount: R(4000), paidOn: "2026-05-06" }];
  return s;
}

test("only rent I collect is my income", () => {
  const s = world();
  const f = monthFigures(s, "2026-05-01");
  assert.deepEqual([f.rentReceivedMine, f.rentReceivedFamily, f.totalIncome], [R(5000), R(4000), R(5000)]);
  assert.deepEqual([f.rentExpectedMine, f.rentExpectedFamily], [R(5000), R(6000)]);
  assert.deepEqual(outstandingRent(s, "2026-06-01"), { mine: 0, family: R(2000) });
});

test("security deposit is not income", () => {
  const s = empty();
  s.properties = [prop(1, "R")]; s.tenants = [tenant(1, 1, 5000, { securityDeposit: R(50000) })];
  assert.equal(monthFigures(s, "2026-05-01").totalIncome, 0);
});

test("spending is actual payments only", () => {
  const s = empty();
  s.properties = [prop(1, "Room 2")];
  s.bills = [bill({ id: 1, name: "Light" }), bill({ id: 2, category: "gas", amount: R(700), dueDate: "2026-04-01" }),
    bill({ id: 3, category: "water", amount: R(300), responsible: "tenant" })];
  s.billPayments = [{ billId: 1, amount: R(1000), paidOn: "2026-05-10" }, { billId: 1, amount: 1, paidOn: "2026-06-10" }];
  const f = monthFigures(s, "2026-05-01");
  assert.equal(f.propertyExpenses, R(1000));
  assert.deepEqual(f.byBillCategory, { Electricity: R(1000) });
  assert.equal(f.totalExpenses, R(1000));
});

test("budget: salary, expenses, SIP is investment not expense", () => {
  const s = empty();
  s.income = [{ receivedOn: "2026-05-01", kind: "salary", amount: R(80000) }, { receivedOn: "2026-05-15", kind: "interest", amount: R(500) }];
  s.expenses = [{ spentOn: "2026-05-03", category: "Groceries", amount: R(6000) }];
  s.commitments = [commit({ id: 1, kind: "subscription" }), commit({ id: 2, kind: "emi", amount: R(10000) }), commit({ id: 3, kind: "sip", amount: R(5000) })];
  s.commitmentPayments = [{ commitmentId: 1, amount: R(649), paidOn: "2026-05-07" }, { commitmentId: 2, amount: R(10000), paidOn: "2026-05-05" }, { commitmentId: 3, amount: R(5000), paidOn: "2026-05-10" }];
  const f = monthFigures(s, "2026-05-01");
  assert.deepEqual([f.salary, f.otherIncome, f.totalExpenses, f.investments], [R(80000), R(500), R(16649), R(5000)]);
  assert.equal(f.remaining, R(80500) - R(16649) - R(5000));
  assert.equal(f.categories.Groceries, R(6000));
});

test("upcoming items include overdue and family rent notes", () => {
  const s = world();
  s.rentPayments = [];
  s.commitments = [commit({ id: 1, name: "LIC", nextDueDate: "2020-01-01" })];
  const items = upcomingItems(s, 30, "2026-05-10");
  assert.ok(items.some((i) => i.label.includes("goes to Father") && i.overdue));
  assert.ok(items.some((i) => i.label === "LIC" && i.overdue));
  assert.deepEqual(items.map((i) => i.date), [...items.map((i) => i.date)].sort());
});

test("property report separates owner spend from tenant-paid bills", () => {
  const s = world();
  s.bills = [bill({ id: 1, propertyId: 1 }), bill({ id: 2, propertyId: 1, responsible: "tenant", amount: R(300), category: "gas" })];
  s.billPayments = [{ billId: 1, amount: R(700), paidOn: "2026-05-10" }];
  const r = propertyReport(s, 1);
  assert.equal(r.rentExpected, R(5000));
  assert.equal(r.rentCashReceived, R(5000));
  assert.equal(r.ownerTotal, R(700));
  assert.equal(r.tenantPaidRecorded, R(300));
  assert.equal(r.netCashFlow, R(4300));
});


test("still-to-pay lists unpaid bills, plans, EMIs and SIPs due by month end, and matches the dashboard", () => {
  const s = empty();
  s.properties = [prop(1, "Room 2")];
  s.income = [{ receivedOn: "2026-10-01", kind: "salary", amount: R(85000) }];
  s.expenses = [{ spentOn: "2026-10-03", category: "Groceries", amount: R(7000) }];
  s.bills = [bill({ id: 1, name: "Light", amount: R(1450), dueDate: "2026-10-28" }), bill({ id: 2, name: "Gas", amount: R(500), dueDate: "2026-11-02" }),
    bill({ id: 3, name: "Tenant water", responsible: "tenant", dueDate: "2026-10-10" })];
  s.commitments = [
    commit({ id: 1, name: "Netflix", amount: R(649), nextDueDate: "2026-10-25" }),
    commit({ id: 2, kind: "emi", name: "Bike loan", amount: R(4200), nextDueDate: "2026-10-28" }),
    commit({ id: 3, kind: "sip", name: "Index fund", amount: R(5000), nextDueDate: "2026-10-10" }),
    commit({ id: 4, name: "Old overdue", amount: R(100), nextDueDate: "2026-09-15" }),
    commit({ id: 5, name: "Next month", amount: R(900), nextDueDate: "2026-11-05" }),
    commit({ id: 6, name: "Cancelled", amount: R(900), nextDueDate: "2026-10-05", status: "cancelled" }),
  ];
  const due = dueThisMonth(s, "2026-10-01", "2026-10-21");
  assert.deepEqual(due.map((d) => d.label), ["Old overdue", "Index fund", "Netflix", "Light (Room 2)", "Bike loan"]);
  assert.deepEqual(due.filter((d) => d.overdue).map((d) => d.label), ["Old overdue", "Index fund"]);
  assert.equal(due.find((d) => d.label === "Index fund").investment, true);
  const total = due.reduce((n, d) => n + d.amount, 0);
  assert.equal(total, R(100 + 5000 + 649 + 1450 + 4200));
  const sum = dashboardSummary(s, "2026-10-01", "2026-10-21");
  assert.equal(sum.stillToPay, total);
  assert.equal(sum.leftAfterDues, R(85000 - 7000) - total); // nothing paid yet except the 7,000 groceries
  // paying Netflix (due date moves to next month) lowers still-to-pay and raises spending by the same amount
  const paid = recordPayment(s.commitments[0], [], { amount: R(649), paidOn: "2026-10-21" });
  s.commitments[0] = paid.commitment;
  s.commitmentPayments = [{ ...paid.payment, commitmentId: 1 }];
  const after = dashboardSummary(s, "2026-10-01", "2026-10-21");
  assert.equal(after.stillToPay, total - R(649));
  assert.equal(after.month.remaining, sum.month.remaining - R(649));
  assert.equal(after.leftAfterDues, sum.leftAfterDues);
});
