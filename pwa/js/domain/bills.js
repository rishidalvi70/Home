import { todayISO } from "../lib/dates.js";
import { sum } from "../lib/money.js";

/** The part of a bill that is mine to pay. Tenant/other-paid bills are never my spending. */
export function myShare(bill) {
  if (bill.isCancelled) return 0;
  if (bill.responsible === "owner") return bill.amount;
  if (bill.responsible === "shared") return Math.min(bill.ownerShare || 0, bill.amount);
  return 0;
}
export const billPaid = (bill, payments) => sum(payments.filter((p) => p.billId === bill.id), (p) => p.amount);
export const billOutstanding = (bill, payments) => Math.max(myShare(bill) - billPaid(bill, payments), 0);

export function billStatus(bill, payments, today = todayISO()) {
  if (bill.isCancelled) return "cancelled";
  const mine = myShare(bill);
  if (mine === 0) return "not_mine";
  const paid = billPaid(bill, payments);
  if (paid >= mine) return "paid";
  if (bill.dueDate && bill.dueDate < today) return "overdue"; // a passed due date never means paid
  return paid > 0 ? "partial" : "unpaid";
}
