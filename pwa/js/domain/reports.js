import { L } from "../constants.js";
import { obOutstanding, obReceived } from "./rent.js";
import { sum } from "../lib/money.js";

/** Room-level numbers. Cash uses payment dates; rent due uses obligation periods.
 * Tenant-paid and other-party bills are listed separately and never counted as owner spend. */
export function propertyReport(snap, propertyId, start = null, end = null) {
  const inRange = (iso) => (!start || iso >= start) && (!end || iso < end);
  const obs = snap.obligations.filter((o) => o.propertyId === propertyId && !o.isCancelled && inRange(o.periodStart));
  const obIds = new Set(snap.obligations.filter((o) => o.propertyId === propertyId).map((o) => o.id));
  const rentCash = sum(snap.rentPayments.filter((p) => obIds.has(p.obligationId) && inRange(p.paidOn)), (p) => p.amount);

  const bills = snap.bills.filter((b) => b.propertyId === propertyId && !b.isCancelled);
  const ownerByCategory = {};
  for (const b of bills) {
    for (const p of snap.billPayments.filter((x) => x.billId === b.id && inRange(x.paidOn)))
      ownerByCategory[L.category[b.category] || b.category] = (ownerByCategory[L.category[b.category] || b.category] || 0) + p.amount;
  }
  const tenantPaid = sum(bills.filter((b) => ["tenant", "other"].includes(b.responsible) && inRange(b.dueDate || "0000-00-00")), (b) => b.amount);
  const ownerTotal = sum(Object.values(ownerByCategory));
  return {
    rentExpected: sum(obs, (o) => o.expectedAmount),
    rentReceivedForPeriods: sum(obs, (o) => obReceived(o, snap.rentPayments)),
    rentOutstanding: sum(obs, (o) => obOutstanding(o, snap.rentPayments)),
    rentCashReceived: rentCash, ownerByCategory, ownerTotal, tenantPaidRecorded: tenantPaid,
    netCashFlow: rentCash - ownerTotal,
  };
}

