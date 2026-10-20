import { addDays, addMonths, dueDateInMonth, todayISO } from "../lib/dates.js";
import { sum } from "../lib/money.js";

const byDate = (a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0);

/** Rent in force on a date, using the increment history (before the first change, the old rent applied). */
export function rentFor(tenant, revisions, on) {
  const revs = revisions.filter((r) => r.tenantId === tenant.id).sort(byDate);
  if (!revs.length) return tenant.monthlyRent;
  const applicable = revs.filter((r) => r.effectiveFrom <= on);
  return applicable.length ? applicable[applicable.length - 1].newRent : revs[0].oldRent;
}

/** Build an increment record and the tenant's resulting *current* rent. Nothing is saved here. */
export function buildRevision(tenant, revisions, effectiveFrom, newRent, reason, today = todayISO()) {
  const oldRent = rentFor(tenant, revisions, effectiveFrom);
  const revision = { tenantId: tenant.id, effectiveFrom, oldRent, newRent, reason: reason || null };
  const currentRent = rentFor(tenant, [...revisions, revision], today);
  return { revision, currentRent };
}

export const revisionChange = (r) => r.newRent - r.oldRent;
export const revisionPercent = (r) => (r.oldRent ? Math.round(((r.newRent - r.oldRent) / r.oldRent) * 1000) / 10 : null);

/** Suggest a new rent from the planned increment percentage, rounded to whole rupees. */
export function suggestedNewRent(tenant) {
  if (tenant.incrementPercent == null) return null;
  return Math.round((tenant.monthlyRent * (1 + tenant.incrementPercent / 100)) / 100) * 100;
}

export function tenancyCovers(tenant, periodStart) {
  const periodEnd = addMonths(periodStart, 1);
  if (tenant.startDate && tenant.startDate >= periodEnd) return false;
  if (tenant.endDate && tenant.endDate < periodStart) return false;
  return true;
}

export const obReceived = (ob, payments) => sum(payments.filter((p) => p.obligationId === ob.id), (p) => p.amount);
export const obOutstanding = (ob, payments) =>
  ob.isCancelled ? 0 : Math.max(ob.expectedAmount - obReceived(ob, payments), 0);

export function obStatus(ob, payments, today = todayISO()) {
  if (ob.isCancelled) return "cancelled";
  const got = obReceived(ob, payments);
  if (got >= ob.expectedAmount) return "paid";
  if (got > 0) return ob.dueDate >= today ? "partial" : "overdue";
  return ob.dueDate < today ? "overdue" : "upcoming";
}

/** What would be generated for a month. Nothing is saved; existing ones are flagged. */
export function previewObligations(snap, periodStart) {
  const props = new Map(snap.properties.map((p) => [p.id, p]));
  return snap.tenants
    .filter((t) => t.isActive && props.get(t.propertyId) && !props.get(t.propertyId).archivedAt && tenancyCovers(t, periodStart))
    .map((t) => ({
      tenant: t,
      property: props.get(t.propertyId),
      amount: rentFor(t, snap.revisions, periodStart),
      dueDate: dueDateInMonth(periodStart, t.rentDueDay),
      exists: snap.obligations.some((o) => o.tenantId === t.id && o.periodStart === periodStart),
    }));
}

/** Records to insert for chosen tenants; skips any that already exist. Never marks anything received. */
export function obligationsToCreate(snap, periodStart, tenantIds) {
  return previewObligations(snap, periodStart)
    .filter((r) => tenantIds.has(r.tenant.id) && !r.exists)
    .map((r) => ({
      propertyId: r.tenant.propertyId, tenantId: r.tenant.id, periodStart,
      expectedAmount: r.amount, dueDate: r.dueDate, isCancelled: false, notes: null,
    }));
}

/** Active tenants whose planned increment date is near (or already past). */
export function incrementReminders(snap, withinDays = 60, today = todayISO()) {
  const cutoff = addDays(today, withinDays);
  return snap.tenants.filter((t) => t.isActive && t.nextIncrementDate && t.nextIncrementDate <= cutoff)
    .sort((a, b) => (a.nextIncrementDate < b.nextIncrementDate ? -1 : 1));
}
