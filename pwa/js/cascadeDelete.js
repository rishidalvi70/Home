// Performs a delete computed by domain/cascade.js - everything in one all-or-nothing transaction,
// including the receipt files that belonged to what is being deleted.
import { FILE_STORE } from "./constants.js";
import { db } from "./db.js";

const STORE_FOR = { tenants: "tenants", revisions: "revisions", obligations: "obligations", rentPayments: "rentPayments", connections: "connections",
  bills: "bills", billPayments: "billPayments", receipts: "receipts" };

/** cascade: {tenants:[ids], receipts:[ids], ...}; primary: [store, id] removed last (the thing the user actually deleted). */
export async function deleteCascade(cascade, primary = null) {
  const stores = new Set([FILE_STORE, ...Object.keys(cascade).map((k) => STORE_FOR[k])]);
  if (primary) stores.add(primary[0]);
  await db.batch([...stores], async (tx) => {
    for (const [key, list] of Object.entries(cascade)) {
      for (const id of list) {
        await tx.remove(STORE_FOR[key], id);
        if (key === "receipts") await tx.remove(FILE_STORE, id);
      }
    }
    if (primary) await tx.remove(primary[0], primary[1]);
  });
}
