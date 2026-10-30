// Receipts: attach photos/PDFs to bills and payments, browse them as Room > Category > Year folders,
// receive files shared from other Android apps, and download everything as a folder zip.
import { FILE_STORE } from "../constants.js";
import { db } from "../db.js";
import { deleteCascade } from "../cascadeDelete.js";
import { formatSize, groupReceipts, ownerOptions, receiptEntries } from "../domain/receipts.js";
import { todayISO } from "../lib/dates.js";
import { prepareReceipt } from "../lib/files.js";
import { html } from "../lib/html.js";
import { buildZip } from "../lib/zip.js";
import { actions, downloadFile, fileActions, refresh, toast } from "../ui/core.js";
import { actionBtn, card, empty, pageHeader } from "./common.js";

/* ---------- storing files ---------- */

/** Prepare and save files. Returns how many were saved; problems are reported in a toast. */
export async function storeFiles(files, ownerType, ownerId, { quiet = false } = {}) {
  const ok = [], problems = [];
  for (const f of files) { try { ok.push(await prepareReceipt(f)); } catch (e) { problems.push(e.message); } }
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const adding = ok.reduce((n, p) => n + p.size, 0);
  if (est?.quota && est.usage + adding > est.quota * 0.9) {
    toast("There isn't enough free space on this phone for those files. Download a backup and free some space.", "danger");
    return 0;
  }
  if (ok.length) {
    await db.batch(["receipts", FILE_STORE], async (tx) => {
      for (const p of ok) {
        const id = await tx.put("receipts", { ownerType, ownerId, filename: p.filename, mime: p.mime, size: p.size, addedAt: new Date().toISOString() });
        await tx.put(FILE_STORE, { id, blob: p.blob });
      }
    });
  }
  if (problems.length) toast(problems.join(" "), "danger");
  if (ok.length && !quiet) toast(`${ok.length} receipt${ok.length === 1 ? "" : "s"} added.`);
  return ok.length;
}

/** Files shared into the app from Android's Share menu wait in a cache (written by the service worker). */
export async function importSharedFiles() {
  if (typeof caches === "undefined") return 0;
  const cache = await caches.open("hf-inbox");
  const keys = await cache.keys();
  if (!keys.length) return 0;
  const files = [];
  for (const k of keys) {
    const res = await cache.match(k);
    if (!res) continue;
    const blob = await res.blob();
    files.push(new File([blob], decodeURIComponent(res.headers.get("x-filename") || "shared"), { type: res.headers.get("content-type") || blob.type || "" }));
  }
  const n = await storeFiles(files, null, null, { quiet: true });
  for (const k of keys) await cache.delete(k); // handled (even ones that were refused, so they don't loop forever)
  if (n) toast(`${n} file${n === 1 ? "" : "s"} received. Attach ${n === 1 ? "it" : "them"} to a bill or payment below.`, "info");
  return n;
}

/* ---------- small pieces used on other pages ---------- */

const isImage = (r) => r.mime.startsWith("image/");

export const attachButtons = (ownerType, ownerId) => html`<div class="d-flex flex-wrap gap-2">
  <label class="btn btn-sm btn-outline-primary mb-0"><i class="bi bi-camera"></i> Take photo
    <input type="file" accept="image/*" capture="environment" hidden data-file-action="attach" data-owner-type="${ownerType}" data-owner-id="${ownerId}"></label>
  <label class="btn btn-sm btn-outline-secondary mb-0"><i class="bi bi-paperclip"></i> Attach file
    <input type="file" accept="image/*,application/pdf" multiple hidden data-file-action="attach" data-owner-type="${ownerType}" data-owner-id="${ownerId}"></label></div>`;

function fileRow(e) {
  return html`<div class="d-flex align-items-start gap-3 py-2 receipt-row" data-receipt-row="${e.id}">
    ${isImage(e) ? html`<img class="receipt-thumb" data-receipt-thumb="${e.id}" alt="Receipt photo" width="48" height="48">` : html`<span class="receipt-thumb receipt-pdf"><i class="bi bi-file-earmark-pdf"></i></span>`}
    <div class="min-w-0 flex-grow-1"><div class="fw-semibold text-break">${e.name}</div><div class="small text-muted">${formatSize(e.size)} · added ${(e.addedAt || "").slice(0, 10)}</div>
      <div class="d-flex flex-wrap gap-1 mt-1">${actionBtn("open-receipt", "Open", { id: e.id }, "btn btn-sm btn-outline-primary")}
        ${actionBtn("download-receipt", "Save", { id: e.id }, "btn btn-sm btn-outline-secondary")}${actionBtn("delete-receipt", "Delete", { id: e.id }, "btn btn-sm btn-outline-danger")}</div></div></div>`;
}

/** Receipts attached to one bill/payment, with attach buttons. */
export function receiptsPanel(snap, ownerType, ownerId) {
  const mine = receiptEntries(snap, (snap.receipts || []).filter((r) => r.ownerType === ownerType && r.ownerId === ownerId));
  return html`<div>${mine.length ? mine.map(fileRow) : html`<p class="text-muted small mb-2">No receipt attached yet.</p>`}<div class="mt-2">${attachButtons(ownerType, ownerId)}</div></div>`;
}

/** Same, but laid out compactly for the row of a payment table. */
export const receiptsInline = receiptsPanel;

/* ---------- thumbnails ---------- */
let thumbUrls = [];
const revokeThumbs = () => { thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = []; };
window.addEventListener("hashchange", revokeThumbs);

/** Fills in photo thumbnails after a page is drawn (the bytes live in IndexedDB, not in the page). */
export async function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll("img[data-receipt-thumb]")) {
    const blob = await db.getFile(Number(img.dataset.receiptThumb));
    if (!blob || !img.isConnected) continue;
    const url = URL.createObjectURL(blob);
    thumbUrls.push(url);
    img.src = url;
  }
}

/* ---------- the Receipts screen ---------- */
export async function library({ query }) {
  const snap = await db.loadAll();
  const all = receiptEntries(snap, snap.receipts);
  const f = { room: query.get("room") || "", category: query.get("category") || "", year: query.get("year") || "", q: (query.get("q") || "").toLowerCase() };
  const inbox = all.filter((e) => e.ownerType == null);
  const shown = all.filter((e) => e.ownerType != null).filter((e) =>
    (!f.room || e.info.room === f.room) && (!f.category || e.info.category === f.category) && (!f.year || e.year === f.year) &&
    (!f.q || [e.name, e.filename, e.info.label, e.info.room, e.info.category].some((x) => (x || "").toLowerCase().includes(f.q))));
  const filed = all.filter((e) => e.ownerType != null);
  const options = (list) => [...new Set(list)].sort();
  const sel = (name, label, values, blank) => html`<div><label class="form-label small mb-1">${label}</label><select class="form-select" data-filter="${name}">
    <option value="">${blank}</option>${values.map((v) => html`<option value="${v}" ${v === f[name] ? "selected" : ""}>${v}</option>`)}</select></div>`;
  const groups = groupReceipts(shown);
  const pickable = ownerOptions(snap);
  const bytes = all.reduce((n, e) => n + e.size, 0);

  const inboxCard = inbox.length ? card(html`Inbox – ${inbox.length} file${inbox.length === 1 ? "" : "s"} waiting to be attached`, html`<div class="card-body">
    <p class="small text-muted">Files shared to this app from other apps (Android: Share → Home Finance). Choose what each one belongs to.</p>
    ${inbox.map((e) => html`<div class="pb-3 mb-3 border-bottom">${fileRow(e)}
      <div class="d-flex flex-wrap gap-2 mt-2"><select class="form-select form-select-sm flex-grow-1" data-inbox-for="${e.id}" aria-label="Attach to">
        <option value="">Attach to…</option>${pickable.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select>
        ${actionBtn("attach-inbox", "Attach", { id: e.id }, "btn btn-sm btn-primary", "paperclip")}</div></div>`)}</div>`, "mb-3 border-warning") : "";

  return { title: "Receipts", after: (root) => hydrateThumbs(root), html: html`${pageHeader("Receipts", "Bills and payment proofs, filed as Room › Category › Year", html`
      ${filed.length ? actionBtn("download-folder-zip", "Download as folder (zip)", {}, "btn btn-outline-primary", "download") : ""}`)}
    ${inboxCard}
    <div class="card card-body mb-3 filter-bar">
      ${sel("room", "Room / place", options(filed.map((e) => e.info.room)), "All")}${sel("category", "Category", options(filed.map((e) => e.info.category)), "All")}
      ${sel("year", "Year", options(filed.map((e) => e.year)).reverse(), "All")}
      <div><label class="form-label small mb-1">Search</label><input class="form-control" data-filter="q" value="${query.get("q") || ""}" placeholder="name, bill, room"></div></div>
    <p class="small text-muted">${all.length} receipt${all.length === 1 ? "" : "s"} · ${formatSize(bytes)} on this phone. To add one, open a bill or a payment and tap <strong>Take photo</strong> or <strong>Attach file</strong>.</p>
    ${groups.length ? groups.map((g) => card(html`<i class="bi bi-folder2-open"></i> ${g.room}`, html`<div class="card-body">${g.categories.map((c) => html`
      <div class="mb-3"><div class="fw-semibold"><i class="bi bi-folder"></i> ${c.category}</div>
        ${c.years.map((y) => html`<div class="ps-3 mt-2"><div class="small text-muted text-uppercase">${y.year}</div>${y.items.map((e) => html`${fileRow(e)}<div class="small ps-5 pb-1"><a href="${e.info.href}">${e.info.kind}: ${e.info.label}</a></div>`)}</div>`)}</div>`)}</div>`, "mb-3"))
      : card("", html`<div class="card-body">${empty(filed.length ? "No receipts match these filters." : "No receipts yet. Open a bill or a payment and attach a photo or PDF.")}</div>`)}` };
}

/* ---------- actions ---------- */
fileActions.attach = async (input) => {
  const files = [...input.files];
  const { ownerType, ownerId } = input.dataset;
  input.value = "";
  if (!files.length) return;
  if (await storeFiles(files, ownerType, Number(ownerId))) refresh(); // nothing saved = nothing changed on screen
};

actions["open-receipt"] = async ({ id }) => {
  const win = window.open("", "_blank"); // opened first so the browser treats it as a direct tap
  const blob = await db.getFile(Number(id));
  if (!blob) { win?.close(); toast("That file is missing.", "danger"); return; }
  const url = URL.createObjectURL(blob);
  if (win) win.location.href = url;
  else { const a = Object.assign(document.createElement("a"), { href: url, target: "_blank" }); a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
};

async function entryFor(id) {
  const snap = await db.loadAll();
  return receiptEntries(snap, snap.receipts).find((e) => e.id === id);
}

actions["download-receipt"] = async ({ id }) => {
  const [e, blob] = await Promise.all([entryFor(Number(id)), db.getFile(Number(id))]);
  if (!e || !blob) { toast("That file is missing.", "danger"); return; }
  downloadFile(e.name, blob.slice(0, blob.size, e.mime), e.mime);
};

actions["delete-receipt"] = async ({ id }) => {
  const e = await entryFor(Number(id));
  if (!e || !confirm(`Delete this receipt (${e.name})? ${e.ownerType ? "The bill or payment it belongs to stays." : ""}`)) return;
  await deleteCascade({ receipts: [e.id] });
  toast("Receipt deleted.", "info"); refresh();
};

actions["attach-inbox"] = async ({ id }) => {
  const choice = document.querySelector(`select[data-inbox-for="${id}"]`)?.value;
  if (!choice) { toast("Choose what this receipt belongs to first.", "warning"); return; }
  const [type, ownerId] = choice.split(":");
  const r = await db.get("receipts", Number(id));
  await db.put("receipts", { ...r, ownerType: type, ownerId: Number(ownerId) });
  toast("Receipt attached."); refresh();
};

actions["download-folder-zip"] = async () => {
  const snap = await db.loadAll();
  const entries = receiptEntries(snap, snap.receipts);
  const files = new Map((await db.allFiles()).map((f) => [f.id, f.blob]));
  const zip = await buildZip(entries.filter((e) => files.has(e.id)).map((e) => ({ name: e.path, data: files.get(e.id) })));
  downloadFile(`home-finance-receipts-${todayISO()}.zip`, zip, "application/zip");
  toast("Receipts folder downloaded (organised by room, category and year).");
};

