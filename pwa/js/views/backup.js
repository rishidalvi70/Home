import { db, validateBackup, BackupError } from "../db.js";
import { extFor, formatSize } from "../domain/receipts.js";
import { ZipError, buildZip, readZip } from "../lib/zip.js";
import { STORES } from "../constants.js";
import { formatDate } from "../lib/dates.js";
import { toCSV } from "../lib/csv.js";
import { html } from "../lib/html.js";
import { actions, downloadFile, navigate, refresh, toast } from "../ui/core.js";
import { card, kv, pageHeader } from "./common.js";

const NAMES = { properties: "Rooms", connections: "Connections", tenants: "Tenants", revisions: "Rent increments", obligations: "Rent records",
  rentPayments: "Rent payments", bills: "Bills", billPayments: "Bill payments", commitments: "Plans & subscriptions", commitmentPayments: "Plan payments",
  income: "Income", expenses: "Everyday expenses", investments: "Investments", members: "Family members" };

export const stamp = () => new Date().toISOString();
export const backupFilename = (ext = "json") => `home-finance-backup-${stamp().slice(0, 10)}.${ext}`;

export async function page() {
  const lastExport = await db.getMeta("lastExportAt");
  const snap = await db.loadAll();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const total = STORES.filter((s) => s !== "receipts").reduce((n, s) => n + snap[s].length, 0);
  const fileInfo = await db.fileStats();
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(["{}"], "x.json", { type: "application/json" })] }));
  return { title: "Backup & data", html: html`${pageHeader("Backup & data", "Your records live only on this phone. A backup file is your safety net.")}
    <div class="row g-3">
      <div class="col-12 col-lg-6">${card("Back up", html`<div class="card-body">
        <p class="mb-2">${lastExport ? html`Last backup: <strong>${formatDate(lastExport.slice(0, 10))}</strong>` : html`<strong class="text-danger">You haven't made a backup yet.</strong>`}</p>
        <p class="text-muted small">Saves all ${total} records${fileInfo.count ? html` <strong>and ${fileInfo.count} receipt file${fileInfo.count === 1 ? "" : "s"} (${formatSize(fileInfo.bytes)})</strong> into one <code>.zip</code> file` : " to one file"}. Keep a copy somewhere safe, such as Google Drive or email to yourself. If this phone is lost, reset or the browser data is cleared, the file is the only way back.</p>
        <div class="d-flex flex-wrap gap-2"><button class="btn btn-primary" type="button" data-action="download-backup"><i class="bi bi-download"></i> Download backup</button>
        ${canShare ? html`<button class="btn btn-outline-primary" type="button" data-action="share-backup"><i class="bi bi-share"></i> Share / save to Drive</button>` : ""}</div></div>`)}</div>
      <div class="col-12 col-lg-6">${card("Restore from a backup", html`<div class="card-body">
        <p class="text-muted small">Choose a backup file made by this app (<code>.zip</code> or <code>.json</code>). <strong>This replaces everything currently on this phone, including receipts.</strong> A damaged file is rejected and nothing changes.</p>
        <input class="form-control mb-2" type="file" id="restore-file" accept=".json,.zip,application/json,application/zip">
        <button class="btn btn-warning" type="button" data-action="restore-backup"><i class="bi bi-upload"></i> Restore</button></div>`)}</div>
      <div class="col-12 col-lg-6">${card("Export to Excel / CSV", html`<div class="card-body"><p class="text-muted small">Each list as a spreadsheet file (amounts in rupees). For viewing and sharing – use the backup file above to restore.</p>
        <div class="d-flex flex-wrap gap-2">${STORES.filter((s) => snap[s].length).map((s) => html`<button class="btn btn-sm btn-outline-secondary" type="button" data-action="export-csv" data-store="${s}">${NAMES[s]} (${snap[s].length})</button>`)}</div></div>`)}</div>
      <div class="col-12 col-lg-6">${card("Storage on this phone", html`<div class="card-body">${kv([
        ["Protected from automatic clean-up", persisted == null ? "Unknown" : persisted ? "Yes" : "Not yet"],
        ["Space used", est?.usage != null ? `${(est.usage / 1048576).toFixed(1)} MB` : "—"]])}
        ${persisted === false ? html`<button class="btn btn-sm btn-outline-primary mt-2" type="button" data-action="persist-storage">Ask the browser to protect my data</button>` : ""}
        <p class="small text-muted mt-3 mb-0">Clearing this site's data, uninstalling the app, or resetting the phone erases your records. iPhone Safari may also clear data from sites not opened for a long time. Back up regularly.</p></div>`)}</div>
      <div class="col-12 col-lg-6">${card("Install as an app", html`<div class="card-body"><p class="mb-1"><strong>Android (Chrome):</strong> menu ⋮ → <em>Install app</em> (or <em>Add to Home screen</em>).</p>
        <p class="mb-0"><strong>iPhone / iPad (Safari):</strong> Share → <em>Add to Home Screen</em>.</p></div>`)}</div>
      <div class="col-12 col-lg-6">${card("Erase everything", html`<div class="card-body"><p class="text-muted small">Deletes all records from this phone. Make a backup first.</p>
        <button class="btn btn-outline-danger" type="button" data-action="erase-all"><i class="bi bi-trash"></i> Erase all data</button></div>`)}</div>
    </div>` };
}

/** JSON when there are no receipts (as before); a .zip holding backup.json + the receipt files when there are. */
async function makeBackupFile() {
  const backup = await db.exportBackup();
  const json = JSON.stringify(backup, null, 2);
  const files = await db.allFiles();
  if (!files.length) return { blob: new Blob([json], { type: "application/json" }), filename: backupFilename("json"), type: "application/json" };
  const meta = new Map(backup.data.receipts.map((r) => [r.id, r]));
  const zip = await buildZip([{ name: "backup.json", data: json },
    ...files.filter((f) => meta.has(f.id)).map((f) => ({ name: `receipts/${f.id}.${extFor(meta.get(f.id).mime, meta.get(f.id).filename)}`, data: f.blob }))]);
  return { blob: zip, filename: backupFilename("zip"), type: "application/zip" };
}

/** Reads a chosen file (.zip or .json) into {backup, files|null}. Throws BackupError with a readable message. */
async function readBackupFile(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) { // "PK" = a zip
    let zip;
    try {
      zip = await readZip(file);
      if (!zip.names.includes("backup.json")) throw new BackupError("This zip has no backup.json inside - it isn't a Home Finance backup.");
      const backup = JSON.parse(await (await zip.read("backup.json")).text());
      validateBackup(backup);
      const files = new Map();
      for (const r of backup.data.receipts || []) {
        const name = zip.names.find((n) => new RegExp(`^receipts/${r.id}\\.`).test(n));
        if (!name) continue; // reported by importBackup as a missing file
        files.set(r.id, (await zip.read(name)).slice(0, undefined, r.mime));
      }
      return { backup, files };
    } catch (e) {
      if (e instanceof ZipError) throw new BackupError(e.message);
      if (e instanceof SyntaxError) throw new BackupError("The backup.json inside this zip is damaged.");
      throw e;
    }
  }
  try { return { backup: JSON.parse(await file.text()), files: null }; }
  catch { throw new BackupError("That file isn't a valid backup (not readable as JSON)."); }
}

actions["download-backup"] = async () => {
  const { blob, filename, type } = await makeBackupFile();
  downloadFile(filename, blob, type);
  await db.setMeta("lastExportAt", stamp());
  toast("Backup downloaded. Keep the file somewhere safe."); refresh();
};
actions["share-backup"] = async () => {
  const { blob, filename, type } = await makeBackupFile();
  const file = new File([blob], filename, { type });
  try { await navigator.share({ files: [file], title: "Home Finance backup" }); }
  catch (e) { if (e.name === "AbortError") return; throw e; }
  await db.setMeta("lastExportAt", stamp());
  toast("Backup shared."); refresh();
};
actions["restore-backup"] = async () => {
  const file = document.getElementById("restore-file")?.files?.[0];
  if (!file) { toast("Choose a backup file first.", "warning"); return; }
  let read;
  try { read = await readBackupFile(file); validateBackup(read.backup); }
  catch (e) { if (e instanceof BackupError) { toast(e.message, "danger"); return; } throw e; }
  const { backup, files } = read;
  const n = Object.values(backup.counts || {}).reduce((a, b) => a + b, 0) || STORES.reduce((t, s) => t + (backup.data[s]?.length || 0), 0);
  const nr = backup.data.receipts?.length || 0;
  if (!confirm(`Replace ALL data on this phone with this backup (${n - nr} records${nr ? ` and ${nr} receipt file${nr === 1 ? "" : "s"}` : ""}, made ${backup.exportedAt ? formatDate(backup.exportedAt.slice(0, 10)) : "on an unknown date"})? This can't be undone.`)) return;
  try { await db.importBackup(backup, files); }
  catch (e) { if (e instanceof BackupError) { toast(e.message, "danger"); return; } throw e; }
  await db.setMeta("lastExportAt", backup.exportedAt || stamp());
  toast("Backup restored."); navigate("/");
};
actions["export-csv"] = async ({ store }) => {
  if (!STORES.includes(store)) return;
  downloadFile(`home-finance-${store}-${stamp().slice(0, 10)}.csv`, toCSV(await db.all(store)), "text/csv;charset=utf-8");
};
actions["persist-storage"] = async () => {
  const ok = navigator.storage?.persist ? await navigator.storage.persist() : false;
  toast(ok ? "Your data is now protected from automatic clean-up." : "The browser didn't grant that. Installing the app to your home screen often helps.", ok ? "success" : "warning"); refresh();
};
actions["erase-all"] = async () => {
  if (prompt("This deletes ALL records on this phone. Type ERASE to confirm.") !== "ERASE") { toast("Nothing was erased.", "info"); return; }
  await db.wipeAll(); await db.setMeta("lastExportAt", null); toast("All data erased.", "info"); navigate("/");
};
