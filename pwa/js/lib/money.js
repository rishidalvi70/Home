// Money is stored as whole paise (integers) so there is never any floating-point drift.

/** "1,234.50" / "₹1234" -> 123450. Returns null for blank, NaN for invalid. */
export function parseMoney(input) {
  if (input == null) return null;
  const s = String(input).replace(/[₹,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** 123450 -> "1234.5" for filling a form input. */
export function toInput(paise) {
  if (paise == null) return "";
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

/** ₹ with Indian digit grouping: 123456750 -> ₹12,34,568 (or with decimals ₹12,34,567.50). */
export function inr(paise, decimals = 0) {
  if (paise == null) return "—";
  const neg = paise < 0;
  const abs = Math.abs(paise);
  let whole, frac = "";
  if (decimals === 0) {
    whole = String(Math.round(abs / 100));
  } else {
    whole = String(Math.floor(abs / 100));
    frac = "." + String(abs % 100).padStart(2, "0");
  }
  if (whole.length > 3) {
    let head = whole.slice(0, -3);
    const tail = whole.slice(-3);
    const groups = [];
    while (head.length > 2) {
      groups.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) groups.unshift(head);
    whole = [...groups, tail].join(",");
  }
  return `${neg ? "-" : ""}₹${whole}${frac}`;
}

export const sum = (items, pick = (x) => x) => items.reduce((t, x) => t + (pick(x) || 0), 0);
export const rupees = (paise) => paise / 100; // for charts only
