import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { BackupError, createDB, validateBackup } from "../js/db.js";

let n = 0;
const fresh = () => createDB(`test-${n++}`);

test("seeds six rooms and three members once", async () => {
  const db = fresh();
  assert.equal(await db.seedIfNeeded(), true);
  const props = await db.all("properties");
  assert.deepEqual(props.map((p) => [p.name, p.occupancyStatus]), [["Room 1", "self_occupied"], ["Room 2", "rented"], ["Room 3", "rented"], ["Room 4", "rented"], ["Room 5", "rented"], ["Room 6", "under_development"]]);
  assert.equal((await db.all("members")).length, 3);
  assert.equal(await db.seedIfNeeded(), false);
  // deleting rooms must not bring them back
  for (const p of props) await db.remove("properties", p.id);
  assert.equal(await db.seedIfNeeded(), false);
  assert.equal((await db.all("properties")).length, 0);
});

test("put assigns ids, keeps createdAt, updates updatedAt", async () => {
  const db = fresh();
  const a = await db.put("income", { receivedOn: "2026-05-01", amount: 100, kind: "salary" });
  assert.ok(a.id > 0 && a.createdAt && a.updatedAt);
  await new Promise((r) => setTimeout(r, 5));
  const b = await db.put("income", { ...a, amount: 200 });
  assert.equal(b.id, a.id);
  assert.equal(b.createdAt, a.createdAt);
  assert.notEqual(b.updatedAt, a.updatedAt);
  assert.equal((await db.get("income", a.id)).amount, 200);
  assert.equal((await db.all("income")).length, 1);
});

test("batch is all-or-nothing", async () => {
  const db = fresh();
  await assert.rejects(db.batch(["income", "expenses"], async (tx) => {
    await tx.put("income", { receivedOn: "2026-05-01", amount: 1, kind: "salary" });
    throw new Error("boom");
  }), /boom/);
  assert.equal((await db.all("income")).length, 0);
  await db.batch(["income", "expenses"], async (tx) => {
    await tx.put("income", { receivedOn: "2026-05-01", amount: 1, kind: "salary" });
    await tx.put("expenses", { spentOn: "2026-05-01", amount: 1, category: "Fuel" });
  });
  assert.equal((await db.all("expenses")).length, 1);
});

async function populated() {
  const db = fresh();
  await db.seedIfNeeded();
  const [room2] = (await db.all("properties")).filter((p) => p.name === "Room 2");
  const t = await db.put("tenants", { propertyId: room2.id, name: "Asha", monthlyRent: 800000, rentDueDay: 5, isActive: true });
  const ob = await db.put("obligations", { propertyId: room2.id, tenantId: t.id, periodStart: "2026-05-01", expectedAmount: 800000, dueDate: "2026-05-05" });
  await db.put("rentPayments", { obligationId: ob.id, amount: 300000, paidOn: "2026-05-06" });
  await db.put("income", { receivedOn: "2026-05-01", kind: "salary", amount: 8500000 });
  return db;
}

test("export then import into a fresh database restores everything", async () => {
  const a = await populated();
  const backup = JSON.parse(JSON.stringify(await a.exportBackup())); // as if saved to a file
  assert.equal(backup.app, "home-finance");
  assert.equal(backup.counts.properties, 6);
  const b = fresh();
  await b.importBackup(backup);
  assert.deepEqual(await b.loadAll(), await a.loadAll());
  assert.equal(await b.seedIfNeeded(), false); // an imported database is never re-seeded
  // new records continue after the highest imported id
  const next = await b.put("income", { receivedOn: "2026-06-01", kind: "salary", amount: 1 });
  assert.ok(next.id > Math.max(...(await a.all("income")).map((i) => i.id)));
});

test("import replaces existing data", async () => {
  const a = await populated();
  const b = fresh();
  await b.seedIfNeeded();
  await b.put("expenses", { spentOn: "2026-05-01", amount: 5, category: "Fuel" });
  await b.importBackup(await a.exportBackup());
  assert.equal((await b.all("expenses")).length, 0);
  assert.equal((await b.all("income")).length, 1);
});

test("a bad import changes nothing", async () => {
  const db = await populated();
  const before = await db.loadAll();
  const good = await db.exportBackup();
  const bad = JSON.parse(JSON.stringify(good));
  bad.data.rentPayments[0].obligationId = 999;
  await assert.rejects(db.importBackup(bad), BackupError);
  assert.deepEqual(await db.loadAll(), before);
});

test("backup validation rejects damaged or foreign files", () => {
  const ok = { app: "home-finance", schemaVersion: 1, data: {} };
  assert.doesNotThrow(() => validateBackup(ok));
  const cases = [
    [null, /isn't a Home Finance/], [{ app: "other" }, /isn't a Home Finance/], [[], /isn't a Home Finance/],
    [{ ...ok, schemaVersion: 99 }, /newer version/], [{ ...ok, schemaVersion: "1" }, /newer version/],
    [{ ...ok, data: null }, /no data/], [{ ...ok, data: { income: "x" } }, /damaged/],
    [{ ...ok, data: { income: [{ receivedOn: "2026-01-01", amount: 1 }] } }, /no valid id/],
    [{ ...ok, data: { income: [{ id: 1, receivedOn: "2026-01-01", amount: 1 }, { id: 1, receivedOn: "2026-01-01", amount: 1 }] } }, /duplicate/],
    [{ ...ok, data: { income: [{ id: 1, amount: 1 }] } }, /missing "receivedOn"/],
    [{ ...ok, data: { income: [{ id: 1, receivedOn: "2026-01-01", amount: 1.5 }] } }, /invalid amount/],
    [{ ...ok, data: { income: [{ id: 1, receivedOn: "2026-01-01", amount: -5 }] } }, /invalid amount/],
    [{ ...ok, data: { tenants: [{ id: 1, propertyId: 7, name: "x", monthlyRent: 1 }] } }, /missing properties/],
    [{ ...ok, data: { properties: [{ id: 1, name: "R" }], bills: [{ id: 1, propertyId: 1, category: "gas", name: "x", amount: 1, responsible: "owner", connectionId: 5 }] } }, /missing connections/],
  ];
  for (const [input, re] of cases) assert.throws(() => validateBackup(input), re);
});

test("wipeAll empties data and stays empty", async () => {
  const db = await populated();
  await db.wipeAll();
  assert.equal((await db.all("properties")).length, 0);
  assert.equal(await db.seedIfNeeded(), false);
});

test("meta values round-trip", async () => {
  const db = fresh();
  assert.equal(await db.getMeta("lastExportAt"), null);
  await db.setMeta("lastExportAt", "2026-10-12T00:00:00Z");
  assert.equal(await db.getMeta("lastExportAt"), "2026-10-12T00:00:00Z");
});
