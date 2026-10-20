import { addDays, nextDueDate, todayISO } from "../lib/dates.js";
import { sum } from "../lib/money.js";
import { INVESTMENT_KINDS } from "../constants.js";

export const isInvestment = (c) => INVESTMENT_KINDS.has(c.kind);
export const paymentsOf = (c, payments) => payments.filter((p) => p.commitmentId === c.id);
export const totalPaid = (c, payments) => sum(paymentsOf(c, payments), (p) => p.amount);
export const installmentsPaid = (c, payments) => (c.installmentsDone || 0) + paymentsOf(c, payments).length;
export function installmentsLeft(c, payments) {
  return c.totalInstallments ? Math.max(c.totalInstallments - installmentsPaid(c, payments), 0) : null;
}
export function remainingAmount(c, payments) {
  const left = installmentsLeft(c, payments);
  return left == null ? null : left * c.amount;
}

export function dueState(c, today = todayISO()) {
  if (c.status !== "active" || !c.nextDueDate) return c.status;
  if (c.nextDueDate < today) return "overdue";
  return c.nextDueDate === today ? "due_today" : "upcoming";
}

/** Remember the day-of-month so a 31st-due item returns to the 31st after February. */
export function withAnchor(c) {
  return c.nextDueDate && !c.dueDay ? { ...c, dueDay: Number(c.nextDueDate.slice(8)) } : c;
}

/**
 * Log a real payment. Returns {commitment, payment}; nothing is saved here.
 * The next due date moves forward separately from the payment date (paying early is fine).
 */
export function recordPayment(c, existingPayments, { amount, paidOn, method = null, reference = null, notes = null, advanceDue = true }) {
  const payment = { commitmentId: c.id, amount, paidOn, forDueDate: c.nextDueDate || null, method, reference, notes };
  const next = { ...c };
  if (c.kind === "mobile" && c.planType === "prepaid" && c.validityDays) {
    // Prepaid: validity counts from the recharge date; the next recharge is due at expiry.
    next.expiryDate = addDays(paidOn, c.validityDays);
    if (advanceDue) next.nextDueDate = next.expiryDate;
  } else if (advanceDue && c.nextDueDate) {
    next.nextDueDate = nextDueDate(c.nextDueDate, c.frequency, c.intervalDays, c.dueDay);
  }
  if (advanceDue && c.frequency === "one_time") next.nextDueDate = null;
  const paidCount = installmentsPaid(c, existingPayments) + 1;
  if (c.totalInstallments && paidCount >= c.totalInstallments) {
    next.status = "closed";
    next.nextDueDate = null;
  }
  return { commitment: next, payment };
}

/** Estimated per-month cost (an estimate, not an actual payment), in paise. */
export function monthlyCost(c) {
  const f = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12 };
  if (c.frequency === "one_time") return 0;
  const factor = c.frequency === "custom" ? 365 / 12 / Math.max(c.intervalDays || 1, 1) : f[c.frequency];
  return Math.round(c.amount * factor);
}
