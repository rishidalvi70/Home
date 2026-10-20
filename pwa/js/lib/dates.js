// Dates are plain 'YYYY-MM-DD' strings so there are no time-zone surprises.
const pad = (n) => String(n).padStart(2, "0");

export function parse(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
export const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

export function isValidISO(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parse(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function todayISO() {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** Add calendar months, clamping to month end. `anchorDay` stops 31st-of-month dues drifting to 28th. */
export function addMonths(iso, months, anchorDay = null) {
  const { y, m, d } = parse(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (((index % 12) + 12) % 12) + 1;
  return toISO(ny, nm, Math.min(anchorDay || d, daysInMonth(ny, nm)));
}

export function addDays(iso, days) {
  const { y, m, d } = parse(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function diffDays(a, b) {
  const pa = parse(a), pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

const MONTHS_PER = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

/** The due date after `current`, or null for one-time items. */
export function nextDueDate(current, frequency, intervalDays = null, anchorDay = null) {
  if (frequency === "one_time") return null;
  if (frequency === "weekly") return addDays(current, 7);
  if (frequency === "custom") return addDays(current, Math.max(intervalDays || 1, 1));
  return addMonths(current, MONTHS_PER[frequency], anchorDay);
}

export const monthStart = (iso) => iso.slice(0, 8) + "01";
export const monthKey = (iso) => iso.slice(0, 7);
export const dueDateInMonth = (periodStart, dueDay) => {
  const { y, m } = parse(periodStart);
  return toISO(y, m, Math.min(dueDay, daysInMonth(y, m)));
};

/** '2026-10' -> '2026-10-01'; falls back on bad input. */
export function parseMonth(value, fallback = monthStart(todayISO())) {
  const mt = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!mt) return fallback;
  const m = Number(mt[2]);
  return m >= 1 && m <= 12 ? `${mt[1]}-${mt[2]}-01` : fallback;
}

/** Indian financial year starts 1 April. */
export function fyStart(iso) {
  const { y, m } = parse(iso);
  return toISO(m >= 4 ? y : y - 1, 4, 1);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
export function formatDate(iso) {
  if (!iso) return "—";
  const { y, m, d } = parse(iso);
  return `${pad(d)} ${MON[m - 1]} ${y}`;
}
export const monthLabel = (iso) => `${MONTH[parse(iso).m - 1]} ${parse(iso).y}`;
export const shortMonth = (iso) => `${MON[parse(iso).m - 1]} ${String(parse(iso).y).slice(2)}`;
