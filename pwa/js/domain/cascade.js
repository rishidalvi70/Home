// What a delete would remove. Pure functions so the numbers shown in the confirmation are the numbers deleted.
const ids = (rows) => rows.map((r) => r.id);
const receiptsOf = (snap, type, idList) => {
  const wanted = new Set(idList);
  return ids((snap.receipts || []).filter((r) => r.ownerType === type && wanted.has(r.ownerId)));
};

/** Everything that hangs off an obligation: its payments. */
export function obligationCascade(snap, obligationId) {
  const rentPayments = ids(snap.rentPayments.filter((p) => p.obligationId === obligationId));
  return { rentPayments, receipts: receiptsOf(snap, "rentPayment", rentPayments) };
}

/** One rent payment and the receipts attached to it. */
export const rentPaymentCascade = (snap, id) => ({ receipts: receiptsOf(snap, "rentPayment", [id]) });
/** One plan/EMI/LIC payment and the receipts attached to it. */
export const commitmentPaymentCascade = (snap, id) => ({ receipts: receiptsOf(snap, "commitmentPayment", [id]) });

/** A tenant, their increment history, rent records and the payments against them. */
export function tenantCascade(snap, tenantId) {
  const obligations = snap.obligations.filter((o) => o.tenantId === tenantId);
  const obIds = new Set(ids(obligations));
  const rentPayments = ids(snap.rentPayments.filter((p) => obIds.has(p.obligationId)));
  return {
    revisions: ids(snap.revisions.filter((r) => r.tenantId === tenantId)),
    obligations: ids(obligations),
    rentPayments,
    receipts: receiptsOf(snap, "rentPayment", rentPayments),
  };
}

/** A bill and its payments. */
export function billCascade(snap, billId) {
  return { billPayments: ids(snap.billPayments.filter((p) => p.billId === billId)), receipts: receiptsOf(snap, "bill", [billId]) };
}

/** A room and everything recorded against it (tenants, rent, connections, bills and all their payments). */
export function propertyCascade(snap, propertyId) {
  const tenants = snap.tenants.filter((t) => t.propertyId === propertyId);
  const obligations = snap.obligations.filter((o) => o.propertyId === propertyId);
  const obIds = new Set(ids(obligations));
  const bills = snap.bills.filter((b) => b.propertyId === propertyId);
  const billIds = new Set(ids(bills));
  const tIds = new Set(ids(tenants));
  const rentPayments = ids(snap.rentPayments.filter((p) => obIds.has(p.obligationId)));
  return {
    tenants: ids(tenants),
    revisions: ids(snap.revisions.filter((r) => tIds.has(r.tenantId))),
    obligations: ids(obligations),
    rentPayments,
    connections: ids(snap.connections.filter((c) => c.propertyId === propertyId)),
    bills: ids(bills),
    billPayments: ids(snap.billPayments.filter((p) => billIds.has(p.billId))),
    receipts: [...receiptsOf(snap, "rentPayment", rentPayments), ...receiptsOf(snap, "bill", [...billIds])],
  };
}

export const total = (cascade) => Object.values(cascade).reduce((n, list) => n + list.length, 0);

const NAMES = { tenants: ["tenant", "tenants"], revisions: ["rent increment", "rent increments"], obligations: ["rent record", "rent records"],
  rentPayments: ["rent payment", "rent payments"], connections: ["connection", "connections"], bills: ["bill", "bills"], billPayments: ["bill payment", "bill payments"],
  receipts: ["receipt", "receipts"] };

/** "2 tenants, 5 rent records and 4 rent payments" for confirmation messages. */
export function describe(cascade) {
  const parts = Object.entries(cascade).filter(([, l]) => l.length).map(([k, l]) => `${l.length} ${NAMES[k][l.length === 1 ? 0 : 1]}`);
  if (!parts.length) return "no other records";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Rooms with no category yet (made before MHADA/Private existed) count as MHADA, as originally set up. */
export const propertyKind = (p) => p.propertyKind || "mhada";
