const MONEY = new Set(["amount", "monthlyRent", "oldRent", "newRent", "expectedAmount", "ownerShare", "securityDeposit",
  "totalAmount", "investedAmount", "currentValue"]);

function cell(key, v) {
  if (v == null) return "";
  if (MONEY.has(key) && Number.isInteger(v)) return (v / 100).toFixed(2); // paise -> rupees
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Stop spreadsheet formula injection from text that starts with = + - @
  const safe = typeof v === "string" && /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows -> CSV text (UTF-8 with BOM so Excel shows ₹ and Indian names correctly). */
export function toCSV(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [keys.join(","), ...rows.map((r) => keys.map((k) => cell(k, r[k])).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
