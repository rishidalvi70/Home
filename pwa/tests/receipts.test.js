import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { describeOwner, extFor, fileProblem, formatSize, groupReceipts, ownerOptions, receiptEntries, slug } from "../js/domain/receipts.js";
import { billCascade, commitmentPaymentCascade, describe, obligationCascade, propertyCascade, rentPaymentCascade, tenantCascade } from "../js/domain/cascade.js";
import { BackupError, createDB } from "../js/db.js";
import { buildZip, readZip } from "../js/lib/zip.js";

const snap = () => ({
  properties: [{ id: 1, name: "Room 2" }, { id: 2, name: "Room 3" }],
  tenants: [{ id: 1, propertyId: 1, name: "Asha" }], revisions: [], connections: [],
  obligations: [{ id: 1, propertyId: 1, tenantId: 1, periodStart: "2026-10-01", expectedAmount: 800000, dueDate: "2026-10-05" }],
  rentPayments: [{ id: 1, obligationId: 1, amount: 800000, paidOn: "2026-10-07" }],
  bills: [{ id: 1, propertyId: 1, category: "electricity", name: "Light bill", amount: 145000, dueDate: "2026-10-24" }, { id: 2, propertyId: 2, category: "gas", name: "Gas", amount: 50000, dueDate: "2025-12-02" }],
  billPayments: [], commitments: [{ id: 1, kind: "insurance", name: "LIC Jeevan Anand", amount: 1200000 }],
  commitmentPayments: [{ id: 1, commitmentId: 1, amount: 1200000, paidOn: "2026-08-30" }],
  receipts: [
    { id: 1, ownerType: "bill", ownerId: 1, filename: "IMG_001.jpg", mime: "image/jpeg", size: 2000 },
    { id: 2, ownerType: "bill", ownerId: 1, filename: "scan.pdf", mime: "application/pdf", size: 5000 },
    { id: 3, ownerType: "bill", ownerId: 2, filename: "gas.pdf", mime: "application/pdf", size: 7000 },
    { id: 4, ownerType: "rentPayment", ownerId: 1, filename: "upi.png", mime: "image/png", size: 900 },
    { id: 5, ownerType: "commitmentPayment", ownerId: 1, filename: "lic.pdf", mime: "application/pdf", size: 12000 },
    { id: 6, ownerType: null, ownerId: null, filename: "shared.pdf", mime: "application/pdf", size: 100, addedAt: "2026-10-20T10:00:00Z" },
  ],
});

test("each receipt knows its room, category, year and clean file name", () => {
  const e = receiptEntries(snap(), snap().receipts);
  const byId = Object.fromEntries(e.map((x) => [x.id, x]));
  assert.equal(byId[1].name, "Room2_Electricity_2026-10.jpg");
  assert.equal(byId[2].name, "Room2_Electricity_2026-10_2.pdf"); // second file for the same bill
  assert.equal(byId[3].name, "Room3_Gas_2025-12.pdf");
  assert.equal(byId[4].name, "Room2_Rent_2026-10.png");
  assert.equal(byId[5].name, "Personal_LIC-Jeevan-Anand_2026-08.pdf");
  assert.equal(byId[5].path, "Personal/LIC - Insurance/2026/Personal_LIC-Jeevan-Anand_2026-08.pdf");
  assert.equal(byId[1].path, "Room 2/Electricity/2026/Room2_Electricity_2026-10.jpg");
  assert.equal(byId[6].info.room, "Inbox");
  assert.equal(byId[6].year, "2026");
  assert.equal(new Set(e.map((x) => x.name.toLowerCase())).size, e.length); // all names unique
});

test("two bills in the same room, category and month still get different names", () => {
  const s = snap();
  s.bills.push({ id: 3, propertyId: 1, category: "electricity", name: "Light bill (2nd meter)", amount: 1, dueDate: "2026-10-26" });
  s.receipts.push({ id: 7, ownerType: "bill", ownerId: 3, filename: "b.pdf", mime: "application/pdf", size: 1 });
  const names = receiptEntries(s, s.receipts).map((x) => x.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
});

test("records that were deleted leave receipts 'Unfiled', not lost", () => {
  const s = snap();
  s.bills = [];
  const e = receiptEntries(s, [s.receipts[0]])[0];
  assert.equal(e.info.room, "Unfiled");
  assert.match(e.name, /^Unfiled_/);
});

test("folder view groups Room > Category > Year, with Inbox first and Personal last", () => {
  const g = groupReceipts(receiptEntries(snap(), snap().receipts));
  assert.deepEqual(g.map((x) => x.room), ["Inbox", "Room 2", "Room 3", "Personal"]);
  const room2 = g.find((x) => x.room === "Room 2");
  assert.deepEqual(room2.categories.map((c) => c.category), ["Electricity", "Rent"]);
  assert.deepEqual(room2.categories[0].years.map((y) => [y.year, y.items.length]), [["2026", 2]]);
});

test("describing owners and attach options", () => {
  const s = snap();
  assert.equal(describeOwner(s, s.receipts[3]).label, "Rent October 2026 – Asha");
  assert.equal(describeOwner(s, s.receipts[4]).href, "#/commitments/1");
  const opts = ownerOptions(s);
  assert.deepEqual(opts.map((o) => o.value), ["bill:1", "rentPayment:1", "commitmentPayment:1", "bill:2"]);
  assert.match(opts[0].label, /Light bill \(Room 2\) – ₹1,450/);
});

test("file checks and names", () => {
  assert.equal(fileProblem({ size: 10, type: "application/pdf" }), null);
  assert.equal(fileProblem({ size: 10, type: "image/jpeg" }), null);
  assert.match(fileProblem({ size: 0, type: "image/jpeg" }), /empty/);
  assert.match(fileProblem({ size: 30 * 1024 * 1024, type: "application/pdf" }), /larger than/);
  assert.match(fileProblem({ size: 10, type: "application/zip" }), /Only photos/);
  assert.match(fileProblem({ size: 10, type: "text/html" }), /Only photos/);
  assert.equal(extFor("image/jpeg"), "jpg");
  assert.equal(extFor("application/octet-stream", "Bill.PDF"), "pdf");
  assert.equal(extFor("application/octet-stream", "weird"), "bin");
  assert.equal(slug("../../etc/passwd"), "etc-passwd");
  assert.equal(slug("LIC / Jeevan Anand"), "LIC-Jeevan-Anand");
  assert.equal(slug(""), "Receipt");
  assert.equal(formatSize(900), "900 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(5 * 1048576), "5.0 MB");
});

test("deleting something deletes the receipts attached to it (and says so)", () => {
  const s = snap();
  assert.deepEqual(billCascade(s, 1), { billPayments: [], receipts: [1, 2] });
  assert.deepEqual(rentPaymentCascade(s, 1), { receipts: [4] });
  assert.deepEqual(commitmentPaymentCascade(s, 1), { receipts: [5] });
  assert.deepEqual(obligationCascade(s, 1).receipts, [4]);
  assert.deepEqual(tenantCascade(s, 1).receipts, [4]);
  assert.deepEqual(propertyCascade(s, 1).receipts.sort(), [1, 2, 4]);
  assert.deepEqual(propertyCascade(s, 2).receipts, [3]);
  assert.match(describe(propertyCascade(s, 1)), /3 receipts/);
  assert.equal(describe({ receipts: [1] }), "1 receipt");
});

let n = 0;
const fresh = () => createDB(`rcpt-${n++}`);
const blob = (text, type = "application/pdf") => new Blob([text], { type });

async function withReceipt(db) {
  await db.seedIfNeeded();
  const [room] = await db.all("properties");
  const bill = await db.put("bills", { propertyId: room.id, category: "gas", name: "Gas", amount: 1000, responsible: "owner" });
  const r = await db.put("receipts", { ownerType: "bill", ownerId: bill.id, filename: "gas.pdf", mime: "application/pdf", size: 8, addedAt: "2026-10-01T00:00:00Z" });
  await db.batch(["receiptFiles"], async (tx) => { await tx.put("receiptFiles", { id: r.id, blob: blob("%PDF-1.4") }); });
  return { bill, r };
}

test("receipt files are stored apart from records and counted", async () => {
  const db = fresh();
  const { r } = await withReceipt(db);
  assert.equal((await db.loadAll()).receipts.length, 1);
  assert.equal("blob" in (await db.loadAll()).receipts[0], false); // lists never carry file bytes
  assert.equal(await (await db.getFile(r.id)).text(), "%PDF-1.4");
  assert.deepEqual(await db.fileStats(), { count: 1, bytes: 8 });
  assert.equal(await db.getFile(999), null);
});

test("backup with receipts: export is zip-ready, import restores files exactly", async () => {
  const a = fresh();
  const { r } = await withReceipt(a);
  const backup = JSON.parse(JSON.stringify(await a.exportBackup()));
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.counts.receipts, 1);
  // pack and unpack like the real backup does
  const files = await a.allFiles();
  const zip = await buildZip([{ name: "backup.json", data: JSON.stringify(backup) }, ...files.map((f) => ({ name: `receipts/${f.id}.pdf`, data: f.blob }))]);
  const z = await readZip(zip);
  const restored = JSON.parse(await (await z.read("backup.json")).text());
  const map = new Map([[r.id, await z.read(`receipts/${r.id}.pdf`)]]);
  const b = fresh();
  await b.importBackup(restored, map);
  assert.deepEqual(await b.loadAll(), await a.loadAll());
  assert.equal(await (await b.getFile(r.id)).text(), "%PDF-1.4");
});

test("a backup that mentions receipts cannot be restored without their files", async () => {
  const a = fresh();
  await withReceipt(a);
  const backup = JSON.parse(JSON.stringify(await a.exportBackup()));
  const b = fresh();
  await b.seedIfNeeded();
  const before = await b.loadAll();
  await assert.rejects(b.importBackup(backup), (e) => e instanceof BackupError && /\.zip/.test(e.message));
  await assert.rejects(b.importBackup(backup, new Map()), (e) => e instanceof BackupError && /missing from the backup/.test(e.message));
  assert.deepEqual(await b.loadAll(), before); // nothing changed
});

test("old (version 1) backups without receipts still import", async () => {
  const b = fresh();
  await b.importBackup({ app: "home-finance", schemaVersion: 1, data: { properties: [{ id: 1, name: "Room 1" }] } });
  assert.equal((await b.all("properties")).length, 1);
  assert.equal((await b.all("receipts")).length, 0);
});

test("a receipt pointing at a missing record is rejected", async () => {
  const b = fresh();
  const bad = { app: "home-finance", schemaVersion: 2, data: { receipts: [{ id: 1, ownerType: "bill", ownerId: 99, filename: "x.pdf", mime: "application/pdf", size: 1 }] } };
  await assert.rejects(b.importBackup(bad, new Map([[1, blob("x")]])), /missing record/);
  bad.data.receipts[0].ownerType = "spaceship";
  await assert.rejects(b.importBackup(bad, new Map([[1, blob("x")]])), /unknown kind/);
});

test("erasing everything also erases receipt files", async () => {
  const db = fresh();
  await withReceipt(db);
  await db.wipeAll();
  assert.deepEqual(await db.fileStats(), { count: 0, bytes: 0 });
  assert.equal((await db.all("receipts")).length, 0);
});
