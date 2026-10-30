// All data lives in the browser's IndexedDB on this device. Nothing is sent anywhere.
import { FILE_STORE, INITIAL_MEMBERS, INITIAL_PROPERTIES, SCHEMA_VERSION, STORES } from "./constants.js";

const DB_VERSION = 2;

const REQUIRED = {
  properties: ["name"], connections: ["propertyId", "kind"], tenants: ["propertyId", "name", "monthlyRent"],
  revisions: ["tenantId", "effectiveFrom", "oldRent", "newRent"],
  obligations: ["propertyId", "tenantId", "periodStart", "expectedAmount", "dueDate"],
  rentPayments: ["obligationId", "amount", "paidOn"], bills: ["propertyId", "category", "name", "amount", "responsible"],
  billPayments: ["billId", "amount", "paidOn"], commitments: ["kind", "name", "amount", "frequency"],
  commitmentPayments: ["commitmentId", "amount", "paidOn"], income: ["receivedOn", "amount"],
  expenses: ["spentOn", "amount"], investments: ["name"], members: ["name"], receipts: ["filename", "mime", "size"],
};
const RECEIPT_OWNERS = { bill: "bills", rentPayment: "rentPayments", commitmentPayment: "commitmentPayments" };
const MONEY_FIELDS = new Set(["amount", "monthlyRent", "oldRent", "newRent", "expectedAmount", "ownerShare",
  "securityDeposit", "totalAmount", "invested", "investedAmount", "currentValue"]);
const PARENTS = {
  connections: { propertyId: "properties" }, tenants: { propertyId: "properties" }, revisions: { tenantId: "tenants" },
  obligations: { propertyId: "properties", tenantId: "tenants" }, rentPayments: { obligationId: "obligations" },
  bills: { propertyId: "properties" }, billPayments: { billId: "bills" }, commitmentPayments: { commitmentId: "commitments" },
};
const OPTIONAL_PARENTS = {
  bills: { connectionId: "connections" }, commitments: { memberId: "members" },
};

export class BackupError extends Error {}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
});
const stamp = () => new Date().toISOString();

export function createDB(name = "home-finance") {
  let opened;
  const open = () => (opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains(FILE_STORE)) d.createObjectStore(FILE_STORE, { keyPath: "id" }); // id = the receipt's id
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database is blocked by another tab"));
  }));

  const api = {
    async all(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAll()); },
    async get(store, id) { const d = await open(); return wrap(d.transaction(store).objectStore(store).get(id)); },
    async put(store, obj) {
      const d = await open();
      const now = stamp();
      const row = { ...obj, createdAt: obj.createdAt || now, updatedAt: now };
      const tx = d.transaction(store, "readwrite");
      const id = await wrap(tx.objectStore(store).put(row));
      await done(tx);
      return { ...row, id };
    },
    async remove(store, id) { const d = await open(); const tx = d.transaction(store, "readwrite"); tx.objectStore(store).delete(id); await done(tx); },

    /** Several writes that succeed or fail together. `fn` gets {put, remove} and may only await those. */
    async batch(stores, fn) {
      const d = await open();
      const tx = d.transaction(stores, "readwrite");
      const now = stamp();
      const tools = {
        put: (store, obj) => wrap(tx.objectStore(store).put({ ...obj, createdAt: obj.createdAt || now, updatedAt: now })),
        remove: (store, id) => wrap(tx.objectStore(store).delete(id)),
      };
      try { await fn(tools); } catch (e) { try { tx.abort(); } catch {} throw e; }
      await done(tx);
    },

    /** A receipt file's bytes, or null. */
    async getFile(id) { const d = await open(); const r = await wrap(d.transaction(FILE_STORE).objectStore(FILE_STORE).get(id)); return r ? r.blob : null; },
    /** Every receipt file, for the zip backup: [{id, blob}] */
    async allFiles() { const d = await open(); return wrap(d.transaction(FILE_STORE).objectStore(FILE_STORE).getAll()); },
    async fileStats() {
      const d = await open();
      const rows = await wrap(d.transaction(FILE_STORE).objectStore(FILE_STORE).getAll());
      return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.blob?.size || 0), 0) };
    },

    async loadAll() {
      const d = await open();
      const tx = d.transaction(STORES);
      const rows = await Promise.all(STORES.map((s) => wrap(tx.objectStore(s).getAll())));
      return Object.fromEntries(STORES.map((s, i) => [s, rows[i]]));
    },
    async getMeta(key, fallback = null) {
      const d = await open(); const r = await wrap(d.transaction("meta").objectStore("meta").get(key));
      return r ? r.value : fallback;
    },
    async setMeta(key, value) { const d = await open(); const tx = d.transaction("meta", "readwrite"); tx.objectStore("meta").put({ key, value }); await done(tx); },

    /** First run only: the six starter rooms and three member labels. Deleting them later never re-creates them. */
    async seedIfNeeded() {
      if (await api.getMeta("seeded")) return false;
      const existing = await api.all("properties");
      if (!existing.length) {
        await api.batch(["properties", "members"], async (tx) => {
          for (const [i, [n, status]] of INITIAL_PROPERTIES.entries())
            await tx.put("properties", { name: n, propertyKind: "mhada", occupancyStatus: status, rentCollectedBy: "me", sortOrder: i + 1, archivedAt: null });
          for (const m of INITIAL_MEMBERS) await tx.put("members", { name: m, isActive: true });
        });
      }
      await api.setMeta("seeded", true);
      return true;
    },

    async exportBackup() {
      const data = await api.loadAll();
      return {
        app: "home-finance", schemaVersion: SCHEMA_VERSION, exportedAt: stamp(),
        counts: Object.fromEntries(STORES.map((s) => [s, data[s].length])), data,
      };
    },

    /** Replace everything with a backup. All-or-nothing: any problem leaves current data untouched. */
    async importBackup(backup, files = null) {
      const rows = validateBackup(backup);
      if (rows.receipts.length) {
        if (!files) throw new BackupError("This backup includes receipts, so choose the .zip file (the .json inside it can't restore the receipt files).");
        for (const r of rows.receipts) if (!(files.get(r.id) instanceof Blob)) throw new BackupError(`A receipt file is missing from the backup (${r.filename}).`);
      }
      const d = await open();
      const tx = d.transaction([...STORES, FILE_STORE, "meta"], "readwrite");
      for (const s of STORES) {
        const os = tx.objectStore(s);
        os.clear();
        for (const row of rows[s]) os.put(row);
      }
      tx.objectStore(FILE_STORE).clear();
      for (const r of rows.receipts) tx.objectStore(FILE_STORE).put({ id: r.id, blob: files.get(r.id) });
      tx.objectStore("meta").put({ key: "seeded", value: true });
      await done(tx);
    },

    async wipeAll() {
      const d = await open();
      const tx = d.transaction([...STORES, FILE_STORE, "meta"], "readwrite");
      for (const s of STORES) tx.objectStore(s).clear();
      tx.objectStore(FILE_STORE).clear();
      tx.objectStore("meta").put({ key: "seeded", value: true }); // an erased app stays empty
      await done(tx);
    },
    close() { if (opened) opened.then((d) => d.close()); opened = null; },
  };
  return api;
}

/** Throws BackupError with a plain-English reason unless the file is a sound backup. Returns rows per store. */
export function validateBackup(b) {
  if (!b || typeof b !== "object" || b.app !== "home-finance") throw new BackupError("This isn't a Home Finance backup file.");
  if (!Number.isInteger(b.schemaVersion) || b.schemaVersion > SCHEMA_VERSION)
    throw new BackupError("This backup was made by a newer version of the app. Update the app first.");
  if (!b.data || typeof b.data !== "object") throw new BackupError("The backup has no data section.");
  const rows = {};
  for (const s of STORES) {
    const list = b.data[s] ?? [];
    if (!Array.isArray(list)) throw new BackupError(`"${s}" in the backup is damaged.`);
    const ids = new Set();
    for (const row of list) {
      if (!row || typeof row !== "object" || !Number.isInteger(row.id) || row.id < 1) throw new BackupError(`A record in "${s}" has no valid id.`);
      if (ids.has(row.id)) throw new BackupError(`"${s}" has a duplicate record (id ${row.id}).`);
      ids.add(row.id);
      for (const f of REQUIRED[s]) if (row[f] === undefined || row[f] === null || row[f] === "")
        throw new BackupError(`A record in "${s}" is missing "${f}".`);
      for (const [f, v] of Object.entries(row)) if (MONEY_FIELDS.has(f) && v != null && (!Number.isInteger(v) || v < 0))
        throw new BackupError(`A record in "${s}" has an invalid amount in "${f}".`);
    }
    rows[s] = list;
  }
  for (const r of rows.receipts) {
    if (!Number.isInteger(r.size) || r.size < 0) throw new BackupError(`A receipt has an invalid size (${r.filename}).`);
    if (r.ownerType != null && !RECEIPT_OWNERS[r.ownerType]) throw new BackupError(`A receipt belongs to an unknown kind of record (${r.filename}).`);
  }
  const idSet = (s) => new Set(rows[s].map((r) => r.id));
  for (const r of rows.receipts) {
    if (r.ownerType != null && !idSet(RECEIPT_OWNERS[r.ownerType]).has(r.ownerId)) throw new BackupError(`A receipt points to a missing record (${r.filename}).`);
  }
  for (const [store, links] of Object.entries(PARENTS))
    for (const [field, parent] of Object.entries(links)) {
      const ok = idSet(parent);
      for (const r of rows[store]) if (!ok.has(r[field])) throw new BackupError(`A record in "${store}" points to a missing ${parent} record.`);
    }
  for (const [store, links] of Object.entries(OPTIONAL_PARENTS))
    for (const [field, parent] of Object.entries(links)) {
      const ok = idSet(parent);
      for (const r of rows[store]) if (r[field] != null && !ok.has(r[field])) throw new BackupError(`A record in "${store}" points to a missing ${parent} record.`);
    }
  return rows;
}

export const db = createDB();
