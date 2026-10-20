import { STORES } from "./constants.js";
import { db } from "./db.js";
import { diffDays, todayISO } from "./lib/dates.js";
import { html } from "./lib/html.js";
import { actions, route, setHooks, startRouter, toast } from "./ui/core.js";
import * as backup from "./views/backup.js";
import * as bills from "./views/bills.js";
import { dashboard } from "./views/dashboard.js";
import * as personal from "./views/personal.js";
import * as props from "./views/properties.js";
import * as rent from "./views/rent.js";

route("/", dashboard);
route("/properties", props.list);
route("/properties/new", props.newProperty);
route("/properties/:id", props.detail);
route("/properties/:id/edit", props.editProperty);
route("/properties/:id/connections/new", (c) => props.connectionForm(c, false));
route("/connections/:id/edit", (c) => props.connectionForm(c, true));
route("/properties/:id/tenants/new", (c) => props.tenantForm(c, false));
route("/tenants/:id/edit", (c) => props.tenantForm(c, true));
route("/tenants/:id/increment", props.incrementForm);
route("/rent", rent.ledger);
route("/rent/generate", rent.generate);
route("/rent/:id", rent.obligation);
route("/bills", bills.list);
route("/bills/new", bills.newBill);
route("/bills/:id", bills.editBill);
route("/personal", personal.overview);
route("/commitments", personal.listCommitments);
route("/commitments/new", personal.newCommitment);
route("/commitments/:id", personal.editCommitment);
for (const [slug, mod] of [["income", personal.income], ["expenses", personal.expenses], ["investments", personal.investments], ["members", personal.members]]) {
  route(`/${slug}`, mod.list); route(`/${slug}/new`, mod.newForm); route(`/${slug}/:id`, mod.editForm);
}
route("/backup", backup.page);

const NAV = [
  ["/", "speedometer2", "Dashboard", (p) => p === "/"],
  ["heading", "Properties"],
  ["/properties", "buildings", "Rooms & tenants", (p) => /^\/(properties|tenants|connections)/.test(p)],
  ["/rent", "cash-coin", "Rent", (p) => p.startsWith("/rent")],
  ["/bills", "receipt", "Property bills", (p) => p.startsWith("/bills")],
  ["heading", "Personal"],
  ["/personal", "pie-chart", "Overview", (p) => p === "/personal"],
  ["/commitments?kind=mobile", "phone", "Mobile plans", (p, q) => p.startsWith("/commitments") && q.get("kind") === "mobile"],
  ["/commitments?kind=subscription", "tv", "Subscriptions", (p, q) => p.startsWith("/commitments") && q.get("kind") === "subscription"],
  ["/commitments?kind=emi", "bank", "EMIs & loans", (p, q) => p.startsWith("/commitments") && q.get("kind") === "emi"],
  ["/commitments?kind=insurance", "shield-check", "LIC & insurance", (p, q) => p.startsWith("/commitments") && q.get("kind") === "insurance"],
  ["/commitments?kind=sip", "graph-up-arrow", "SIPs", (p, q) => p.startsWith("/commitments") && q.get("kind") === "sip"],
  ["/commitments?kind=other", "arrow-repeat", "Other recurring", (p, q) => p.startsWith("/commitments") && q.get("kind") === "other"],
  ["/income", "wallet2", "Salary & income", (p) => p.startsWith("/income")],
  ["/expenses", "basket", "Everyday expenses", (p) => p.startsWith("/expenses")],
  ["/investments", "piggy-bank", "Investments", (p) => p.startsWith("/investments")],
  ["/members", "people", "Family members", (p) => p.startsWith("/members")],
  ["heading", "Data"],
  ["/backup", "shield-lock", "Backup & data", (p) => p === "/backup"],
];

function renderNav(path, query) {
  const markup = html`<div class="brand d-none d-lg-flex"><i class="bi bi-house-heart-fill"></i> Home Finance</div><nav class="nav-list">${NAV.map((n) =>
    n[0] === "heading" ? html`<div class="nav-heading">${n[1]}</div>`
      : html`<a class="nav-link-item ${n[3](path, query) ? "active" : ""}" href="#${n[0]}" ${n[3](path, query) ? html`aria-current="page"` : ""}><i class="bi bi-${n[1]}"></i><span>${n[2]}</span></a>`)}</nav>`.s;
  for (const id of ["nav-desktop", "nav-drawer"]) { const el = document.getElementById(id); if (el) el.innerHTML = markup; }
}

async function updateBackupBanner() {
  const banner = document.getElementById("backup-banner");
  if (!banner) return;
  const snap = await db.loadAll();
  const hasData = STORES.filter((s) => s !== "properties" && s !== "members").some((s) => snap[s].length);
  const last = await db.getMeta("lastExportAt");
  const days = last ? diffDays(last.slice(0, 10), todayISO()) : null;
  const stale = hasData && (days == null || days > 30);
  banner.hidden = !stale;
  if (stale) banner.innerHTML = html`<i class="bi bi-exclamation-triangle"></i> ${days == null ? "You haven't backed up yet." : `Your last backup was ${days} days ago.`} Your data lives only on this phone. <a href="#/backup" class="alert-link">Back up now</a>`.s;
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const announce = (worker) => {
      const banner = document.getElementById("update-banner");
      banner.hidden = false;
      banner.querySelector("[data-action=apply-update]").onclick = () => worker.postMessage("SKIP_WAITING");
    };
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) announce(w); });
    });
  }).catch((e) => console.warn("Service worker not registered:", e));
  // Reload only when an *update* takes over - not on the very first install, which has no previous controller.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

async function boot() {
  try {
    await db.seedIfNeeded();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    document.getElementById("view").innerHTML = html`<div class="alert alert-danger"><strong>This browser can't store data for the app.</strong> Private/incognito windows and some strict privacy modes block it. Open the app in a normal Chrome or Safari window. (${e.message})</div>`.s;
    return;
  }
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-bs-theme", next);
    try { localStorage.setItem("theme", next); } catch {}
    document.dispatchEvent(new Event("themechange"));
  });
  setHooks({ afterRender: ({ path, query }) => { renderNav(path, query); updateBackupBanner();
    document.getElementById("navDrawer")?.classList.contains("show") && window.bootstrap?.Offcanvas.getInstance(document.getElementById("navDrawer"))?.hide(); } });
  setupServiceWorker();
  await startRouter();
}
window.addEventListener("online", () => document.getElementById("offline-pill")?.setAttribute("hidden", ""));
window.addEventListener("offline", () => document.getElementById("offline-pill")?.removeAttribute("hidden"));
boot();
export { actions, toast };
