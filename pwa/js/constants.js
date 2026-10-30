export const labelsOf = (pairs) => Object.fromEntries(pairs);

export const OCCUPANCY = [["self_occupied", "Self-occupied"], ["rented", "Rented"], ["under_development", "Under development"],
  ["vacant", "Vacant"], ["under_renovation", "Under renovation"], ["other", "Other"]];
export const COLLECTORS = [["me", "Me"], ["father", "Father"], ["mother", "Mother"], ["other", "Someone else"]];
export const CONNECTION_KINDS = [["electricity", "Electricity"], ["gas", "Gas"], ["water", "Water"],
  ["internet", "Internet"], ["other", "Other"]];
export const BILL_CATEGORIES = [["electricity", "Electricity"], ["gas", "Gas"], ["water", "Water"], ["internet", "Internet"],
  ["maintenance", "Maintenance"], ["property_tax", "Property tax"], ["mhada", "MHADA"], ["repairs", "Repairs"],
  ["development", "Development"], ["other", "Other"]];
export const RESPONSIBLE = [["owner", "I pay"], ["tenant", "Tenant pays"], ["shared", "Shared"], ["other", "Someone else pays"]];
export const TENANT_PAYMENT_STATES = [["not_reported", "Not reported"], ["reported", "Reported by tenant"], ["confirmed", "Confirmed"]];
export const KINDS = [["mobile", "Mobile plan"], ["subscription", "Subscription"], ["emi", "EMI / Loan"],
  ["insurance", "LIC / Insurance"], ["sip", "SIP / Mutual fund"], ["other", "Other recurring"]];
export const KIND_ICONS = { mobile: "phone", subscription: "tv", emi: "bank", insurance: "shield-check",
  sip: "graph-up-arrow", other: "arrow-repeat" };
export const INVESTMENT_KINDS = new Set(["sip"]); // money into investments is not an expense
export const FREQUENCIES = [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"],
  ["half_yearly", "Half-yearly"], ["yearly", "Yearly"], ["custom", "Custom (every N days)"], ["one_time", "One-time"]];
export const STATUSES = [["active", "Active"], ["paused", "Paused"], ["cancelled", "Cancelled"], ["closed", "Closed"]];
export const INCOME_KINDS = [["salary", "Salary"], ["bonus", "Bonus"], ["interest", "Interest / dividends"], ["other", "Other income"]];
export const EXPENSE_CATEGORIES = ["Groceries", "Medical", "Travel", "Fuel", "Shopping", "Dining", "Education",
  "Household", "Gifts", "Miscellaneous"];
export const INVESTMENT_TYPES = [["mutual_fund", "Mutual fund"], ["equity", "Equity / shares"], ["fd", "Fixed deposit"],
  ["ppf_epf", "PPF / EPF / NPS"], ["gold", "Gold"], ["other", "Other"]];
export const METHODS = ["", "Cash", "UPI", "Bank transfer", "Cheque", "Card", "Auto-debit", "Other"];

export const L = {
  occupancy: labelsOf(OCCUPANCY), collector: labelsOf(COLLECTORS), connection: labelsOf(CONNECTION_KINDS),
  category: labelsOf(BILL_CATEGORIES), responsible: labelsOf(RESPONSIBLE), kind: labelsOf(KINDS),
  frequency: labelsOf(FREQUENCIES), income: labelsOf(INCOME_KINDS), investment: labelsOf(INVESTMENT_TYPES),
};

export const SCHEMA_VERSION = 2; // 2 = receipts. Backups from version 1 still import.
export const STORES = ["properties", "connections", "tenants", "revisions", "obligations", "rentPayments", "bills",
  "billPayments", "commitments", "commitmentPayments", "income", "expenses", "investments", "members", "receipts"];
// Receipt files (photos/PDFs) live in their own store so lists never load them; they travel in the .zip backup.
export const FILE_STORE = "receiptFiles";

export const INITIAL_PROPERTIES = [["Room 1", "self_occupied"], ["Room 2", "rented"], ["Room 3", "rented"],
  ["Room 4", "rented"], ["Room 5", "rented"], ["Room 6", "under_development"]];
export const INITIAL_MEMBERS = ["Member 1", "Member 2", "Member 3"];
