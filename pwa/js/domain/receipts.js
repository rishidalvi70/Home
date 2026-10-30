// Pure rules for receipts: what each one belongs to, its folder (Room / Category / Year) and a clean file name.
import { L } from "../constants.js";
import { monthLabel } from "../lib/dates.js";
import { inr } from "../lib/money.js";

export const OWNER_STORES = { bill: "bills", rentPayment: "rentPayments", commitmentPayment: "commitmentPayments" };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];

const EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" };
export const extFor = (mime, filename = "") => EXT[mime] || (/\.([A-Za-z0-9]{1,5})$/.exec(filename)?.[1] || "bin").toLowerCase();

/** Safe for file names on any system: no slashes, no odd characters. */
export const slug = (s, fallback = "Receipt") => String(s ?? "").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || fallback;
const roomSlug = (s) => slug(String(s ?? "").replace(/\s+/g, ""));
const folderSegment = (s) => String(s ?? "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Other";

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Where a receipt belongs: room, category, date (for year/month) and a link back to the record. */
export function describeOwner(snap, r) {
  const fallbackDate = (r.addedAt || r.createdAt || "").slice(0, 10) || "1970-01-01";
  const rows = (store) => snap[store] || [];
  if (r.ownerType === "bill") {
    const b = rows("bills").find((x) => x.id === r.ownerId);
    if (b) {
      const room = rows("properties").find((p) => p.id === b.propertyId)?.name ?? "Unknown room";
      return { room, category: L.category[b.category] || b.category, nameParts: [room, L.category[b.category] || b.category], date: b.dueDate || b.receivedOn || fallbackDate, label: b.name, href: `#/bills/${b.id}`, kind: "Bill" };
    }
  } else if (r.ownerType === "rentPayment") {
    const pay = rows("rentPayments").find((x) => x.id === r.ownerId);
    const ob = pay && rows("obligations").find((o) => o.id === pay.obligationId);
    if (ob) {
      const room = rows("properties").find((p) => p.id === ob.propertyId)?.name ?? "Unknown room";
      const tenant = rows("tenants").find((t) => t.id === ob.tenantId)?.name ?? "";
      return { room, category: "Rent", nameParts: [room, "Rent"], date: pay.paidOn, label: `Rent ${monthLabel(ob.periodStart)}${tenant ? ` – ${tenant}` : ""}`, href: `#/rent/${ob.id}`, kind: "Rent payment" };
    }
  } else if (r.ownerType === "commitmentPayment") {
    const pay = rows("commitmentPayments").find((x) => x.id === r.ownerId);
    const c = pay && rows("commitments").find((x) => x.id === pay.commitmentId);
    if (c) return { room: "Personal", category: L.kind[c.kind] || c.kind, nameParts: ["Personal", c.name], date: pay.paidOn, label: c.name, href: `#/commitments/${c.id}`, kind: "Payment" };
  } else if (r.ownerType == null) {
    return { room: "Inbox", category: "Not attached yet", nameParts: ["Inbox"], date: fallbackDate, label: "Not attached to a bill or payment yet", href: "#/receipts", kind: "Inbox" };
  }
  return { room: "Unfiled", category: "Other", nameParts: ["Unfiled"], date: fallbackDate, label: "Record no longer exists", href: "#/receipts", kind: "Unfiled" };
}

/** Receipts with their owner info, a unique clean file name, and a folder path. Newest first. */
export function receiptEntries(snap, receipts) {
  const used = new Set();
  const perOwner = new Map();
  const sorted = [...receipts].sort((a, b) => a.id - b.id);
  const entries = sorted.map((r) => {
    const info = describeOwner(snap, r);
    const key = `${r.ownerType}:${r.ownerId}`;
    const index = perOwner.get(key) || 0;
    perOwner.set(key, index + 1);
    const base = `${info.nameParts.map((p, i) => (i === 0 ? roomSlug(p) : slug(p))).join("_")}_${info.date.slice(0, 7)}`;
    const ext = extFor(r.mime, r.filename);
    let name = `${base}${index ? `_${index + 1}` : ""}.${ext}`, n = index + 1;
    while (used.has(name.toLowerCase())) name = `${base}_${++n}.${ext}`;
    used.add(name.toLowerCase());
    return { ...r, info, year: info.date.slice(0, 4), name, path: `${folderSegment(info.room)}/${folderSegment(info.category)}/${info.date.slice(0, 4)}/${name}` };
  });
  return entries.sort((a, b) => (a.info.date < b.info.date ? 1 : a.info.date > b.info.date ? -1 : b.id - a.id));
}

/** Room -> Category -> Year -> entries, each level sorted for display (Inbox first, Personal last). */
export function groupReceipts(entries) {
  const rooms = new Map();
  for (const e of entries) {
    const cats = rooms.get(e.info.room) || rooms.set(e.info.room, new Map()).get(e.info.room);
    const years = cats.get(e.info.category) || cats.set(e.info.category, new Map()).get(e.info.category);
    (years.get(e.year) || years.set(e.year, []).get(e.year)).push(e);
  }
  const rank = (name) => (name === "Inbox" ? 0 : name === "Personal" ? 2 : name === "Unfiled" ? 3 : 1);
  return [...rooms.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([room, cats]) => ({
    room,
    categories: [...cats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, years]) => ({
      category, years: [...years.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, items]) => ({ year, items })),
    })),
  }));
}

/** What a receipt in the inbox can be attached to: [{value: "bill:3", label}] newest first. */
export function ownerOptions(snap, limit = 150) {
  const room = (id) => snap.properties.find((p) => p.id === id)?.name ?? "?";
  const out = [];
  for (const b of snap.bills) out.push({ value: `bill:${b.id}`, date: b.dueDate || b.receivedOn || b.createdAt?.slice(0, 10) || "", label: `Bill: ${b.name} (${room(b.propertyId)}) – ${inr(b.amount)}${b.dueDate ? `, due ${b.dueDate}` : ""}` });
  for (const p of snap.rentPayments) {
    const ob = snap.obligations.find((o) => o.id === p.obligationId);
    if (ob) out.push({ value: `rentPayment:${p.id}`, date: p.paidOn, label: `Rent paid: ${room(ob.propertyId)} ${monthLabel(ob.periodStart)} – ${inr(p.amount)} on ${p.paidOn}` });
  }
  for (const p of snap.commitmentPayments) {
    const c = snap.commitments.find((x) => x.id === p.commitmentId);
    if (c) out.push({ value: `commitmentPayment:${p.id}`, date: p.paidOn, label: `Payment: ${c.name} – ${inr(p.amount)} on ${p.paidOn}` });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
}

/** Basic check on a chosen file before it is stored. Returns an error message or null. */
export function fileProblem(file) {
  if (!file.size) return "That file is empty.";
  if (file.size > MAX_FILE_BYTES) return `That file is larger than ${formatSize(MAX_FILE_BYTES)}.`;
  if (!ALLOWED_TYPES.includes(file.type)) return "Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.";
  return null;
}
