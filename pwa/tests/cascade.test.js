import test from "node:test";
import assert from "node:assert/strict";
import { billCascade, describe, obligationCascade, propertyCascade, propertyKind, tenantCascade, total } from "../js/domain/cascade.js";

const snap = {
  properties: [{ id: 1 }, { id: 2 }],
  connections: [{ id: 1, propertyId: 1 }, { id: 2, propertyId: 2 }],
  tenants: [{ id: 1, propertyId: 1 }, { id: 2, propertyId: 1 }, { id: 3, propertyId: 2 }],
  revisions: [{ id: 1, tenantId: 1 }, { id: 2, tenantId: 3 }],
  obligations: [{ id: 1, propertyId: 1, tenantId: 1 }, { id: 2, propertyId: 1, tenantId: 2 }, { id: 3, propertyId: 2, tenantId: 3 }],
  rentPayments: [{ id: 1, obligationId: 1 }, { id: 2, obligationId: 1 }, { id: 3, obligationId: 3 }],
  bills: [{ id: 1, propertyId: 1 }, { id: 2, propertyId: 2 }],
  billPayments: [{ id: 1, billId: 1 }, { id: 2, billId: 2 }],
};

test("property cascade includes only that room's records", () => {
  assert.deepEqual(propertyCascade(snap, 1), { tenants: [1, 2], revisions: [1], obligations: [1, 2], rentPayments: [1, 2], connections: [1], bills: [1], billPayments: [1] });
  assert.deepEqual(propertyCascade(snap, 2), { tenants: [3], revisions: [2], obligations: [3], rentPayments: [3], connections: [2], bills: [2], billPayments: [2] });
  assert.equal(total(propertyCascade({ ...snap, tenants: [], revisions: [], obligations: [], rentPayments: [], connections: [], bills: [], billPayments: [] }, 1)), 0);
});

test("tenant, obligation and bill cascades", () => {
  assert.deepEqual(tenantCascade(snap, 1), { revisions: [1], obligations: [1], rentPayments: [1, 2] });
  assert.deepEqual(tenantCascade(snap, 2), { revisions: [], obligations: [2], rentPayments: [] });
  assert.deepEqual(obligationCascade(snap, 1), { rentPayments: [1, 2] });
  assert.deepEqual(billCascade(snap, 2), { billPayments: [2] });
});

test("confirmation wording", () => {
  assert.equal(describe(propertyCascade(snap, 1)), "2 tenants, 1 rent increment, 2 rent records, 2 rent payments, 1 connection, 1 bill and 1 bill payment");
  assert.equal(describe({ rentPayments: [1] }), "1 rent payment");
  assert.equal(describe({ tenants: [], bills: [] }), "no other records");
});

test("rooms made before categories existed are MHADA", () => {
  assert.equal(propertyKind({}), "mhada");
  assert.equal(propertyKind({ propertyKind: "private" }), "private");
});
