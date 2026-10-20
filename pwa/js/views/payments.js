import { METHODS } from "../constants.js";
import { todayISO } from "../lib/dates.js";
import { inr } from "../lib/money.js";

/** Shared payment form. Refuses future dates, overpayment and exact duplicates. */
export function paymentSpec({ id, defaultAmount = null, outstanding = null, existing = [], advance = false, submitLabel = "Add payment", onSubmit }) {
  return {
    id, submitLabel, submitClass: "btn-success", icon: "plus-lg",
    fields: [
      { name: "amount", label: "Amount (₹)", type: "money", required: true, positive: true },
      { name: "paidOn", label: "Payment date", type: "date", required: true },
      { name: "method", label: "Payment method", type: "select", options: METHODS.map((m) => [m, m || "—"]) },
      { name: "reference", label: "Transaction reference", type: "text", max: 120 },
      { name: "notes", label: "Notes", type: "textarea", max: 4000 },
      ...(advance ? [{ name: "advanceDue", label: "Move the next due date forward", type: "checkbox", default: true }] : []),
    ],
    values: { amount: defaultAmount || null, paidOn: todayISO(), advanceDue: true },
    validate(v) {
      if (v.paidOn > todayISO()) return { paidOn: "A payment date can't be in the future." };
      if (outstanding != null && v.amount > outstanding) return { amount: `That is more than the outstanding balance (${inr(outstanding, 2)}).` };
      if (existing.some((p) => p.amount === v.amount && p.paidOn === v.paidOn && (p.reference || "") === (v.reference || "")))
        return { amount: "An identical payment is already recorded – not adding it twice." };
      return {};
    },
    onSubmit,
  };
}
