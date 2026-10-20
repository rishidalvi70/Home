import test from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, daysInMonth, diffDays, dueDateInMonth, fyStart, isValidISO, nextDueDate, parseMonth } from "../js/lib/dates.js";
import { inr, parseMoney, toInput } from "../js/lib/money.js";
import { esc, html, raw } from "../js/lib/html.js";

test("add months clamps month end and handles leap years", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonths("2028-02-29", 12), "2029-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -2), "2025-11-15");
});

test("anchor day prevents drift", () => {
  const feb = nextDueDate("2026-01-31", "monthly", null, 31);
  const mar = nextDueDate(feb, "monthly", null, 31);
  assert.deepEqual([feb, mar], ["2026-02-28", "2026-03-31"]);
  assert.equal(nextDueDate(feb, "monthly"), "2026-03-28"); // without anchor it drifts
});

test("next due by frequency", () => {
  const d = "2026-10-12";
  const exp = { weekly: "2026-10-19", monthly: "2026-11-12", quarterly: "2027-01-12", half_yearly: "2027-04-12", yearly: "2027-10-12" };
  for (const [f, e] of Object.entries(exp)) assert.equal(nextDueDate(d, f), e, f);
  assert.equal(nextDueDate(d, "custom", 45), "2026-11-26");
  assert.equal(nextDueDate(d, "one_time"), null);
});

test("misc date helpers", () => {
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(dueDateInMonth("2026-02-01", 31), "2026-02-28");
  assert.equal(dueDateInMonth("2028-02-01", 30), "2028-02-29");
  assert.equal(addDays("2026-02-27", 2), "2026-03-01");
  assert.equal(diffDays("2026-03-01", "2026-03-31"), 30);
  assert.equal(parseMonth("2026-10"), "2026-10-01");
  assert.equal(parseMonth("garbage", "2026-01-01"), "2026-01-01");
  assert.equal(parseMonth("2026-13", "2026-01-01"), "2026-01-01");
  assert.equal(fyStart("2026-03-31"), "2025-04-01");
  assert.equal(fyStart("2026-04-01"), "2026-04-01");
  assert.ok(isValidISO("2028-02-29") && !isValidISO("2027-02-29") && !isValidISO("2026-1-1") && !isValidISO(null));
});

test("money parsing is exact", () => {
  assert.equal(parseMoney("1,234.50"), 123450);
  assert.equal(parseMoney("₹ 80000"), 8000000);
  assert.equal(parseMoney("0.1"), 10);
  assert.equal(parseMoney("0.29"), 29); // classic float trap (0.29*100 = 28.999…)
  assert.equal(parseMoney("19.99"), 1999);
  assert.equal(parseMoney(""), null);
  for (const bad of ["abc", "-5", "1.234", "1e3", "12.", "."]) assert.ok(Number.isNaN(parseMoney(bad)), bad);
  assert.equal(toInput(123450), "1234.50");
  assert.equal(toInput(500000), "5000");
});

test("indian rupee formatting", () => {
  assert.equal(inr(123456750), "₹12,34,568");
  assert.equal(inr(123456750, 2), "₹12,34,567.50");
  assert.equal(inr(99900), "₹999");
  assert.equal(inr(100000), "₹1,000");
  assert.equal(inr(-10000000), "-₹1,00,000");
  assert.equal(inr(null), "—");
  assert.equal(inr(0), "₹0");
});

test("html helper escapes by default", () => {
  assert.equal(html`<p>${"<script>alert(1)</script>"}</p>`.s, "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal(html`<b>${raw("<i>x</i>")}</b>`.s, "<b><i>x</i></b>");
  assert.equal(html`${[html`<a>`, "&"]}`.s, "<a>&amp;");
  assert.equal(esc(`"'`), "&quot;&#39;");
  assert.equal(html`${null}${false}${0}`.s, "0");
});
