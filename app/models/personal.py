from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models.mixins import TimestampMixin

ZERO = Decimal("0.00")

KINDS = [
    ("mobile", "Mobile plan"),
    ("subscription", "Subscription"),
    ("emi", "EMI / Loan"),
    ("insurance", "LIC / Insurance"),
    ("sip", "SIP / Mutual fund"),
    ("other", "Other recurring"),
]
KIND_LABELS = dict(KINDS)
KIND_ICONS = {"mobile": "phone", "subscription": "tv", "emi": "bank", "insurance": "shield-check",
              "sip": "graph-up-arrow", "other": "arrow-repeat"}
# Money going into investments is tracked separately from expenses.
INVESTMENT_KINDS = {"sip"}

FREQUENCIES = [
    ("weekly", "Weekly"), ("monthly", "Monthly"), ("quarterly", "Quarterly"),
    ("half_yearly", "Half-yearly"), ("yearly", "Yearly"),
    ("custom", "Custom (every N days)"), ("one_time", "One-time"),
]
FREQUENCY_LABELS = dict(FREQUENCIES)
STATUSES = [("active", "Active"), ("paused", "Paused"), ("cancelled", "Cancelled"), ("closed", "Closed")]


class FamilyMember(TimestampMixin, db.Model):
    """A label for whose plan/subscription it is. Not a login."""

    __tablename__ = "family_member"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


class Commitment(TimestampMixin, db.Model):
    """A recurring payment of mine: mobile plan, subscription, EMI, LIC, SIP, ..."""

    __tablename__ = "commitment"
    __table_args__ = (db.CheckConstraint("amount >= 0", name="ck_commitment_amount_nonneg"),)

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(20), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    provider = db.Column(db.String(120))
    member_id = db.Column(db.Integer, db.ForeignKey("family_member.id"))
    reference = db.Column(db.String(80))  # policy no / mobile no / loan a/c (keep it partial)
    amount = db.Column(db.Numeric(14, 2), nullable=False)
    frequency = db.Column(db.String(20), nullable=False, default="monthly")
    interval_days = db.Column(db.Integer)  # for frequency == "custom"
    due_day = db.Column(db.Integer)  # anchor day of month so month-ends don't drift
    next_due_date = db.Column(db.Date)
    status = db.Column(db.String(20), nullable=False, default="active")
    start_date = db.Column(db.Date)
    end_date = db.Column(db.Date)
    auto_renew = db.Column(db.Boolean, nullable=False, default=False)
    # EMI: loan amount + tenure. Insurance: sum assured. SIP/other: optional target.
    total_amount = db.Column(db.Numeric(14, 2))
    total_installments = db.Column(db.Integer)
    installments_done = db.Column(db.Integer, nullable=False, default=0)  # paid before tracking began
    # Mobile
    plan_type = db.Column(db.String(10))  # prepaid / postpaid
    validity_days = db.Column(db.Integer)
    expiry_date = db.Column(db.Date)  # prepaid expiry - can be corrected by hand
    notes = db.Column(db.Text)

    member = db.relationship("FamilyMember")
    payments = db.relationship("CommitmentPayment", back_populates="commitment",
                               order_by="CommitmentPayment.paid_on.desc()", cascade="all, delete-orphan")

    @property
    def kind_label(self):
        return KIND_LABELS.get(self.kind, self.kind)

    @property
    def is_investment(self):
        return self.kind in INVESTMENT_KINDS

    @property
    def total_paid(self) -> Decimal:
        return sum((p.amount for p in self.payments), ZERO)

    @property
    def installments_paid(self) -> int:
        return (self.installments_done or 0) + len(self.payments)

    @property
    def installments_left(self):
        if not self.total_installments:
            return None
        return max(self.total_installments - self.installments_paid, 0)

    @property
    def remaining_amount(self):
        left = self.installments_left
        return None if left is None else left * self.amount

    @property
    def due_state(self) -> str:
        if self.status != "active" or not self.next_due_date:
            return self.status
        today = date.today()
        if self.next_due_date < today:
            return "overdue"
        if self.next_due_date == today:
            return "due_today"
        return "upcoming"


class CommitmentPayment(TimestampMixin, db.Model):
    __tablename__ = "commitment_payment"
    __table_args__ = (db.CheckConstraint("amount > 0", name="ck_commitment_payment_positive"),)

    id = db.Column(db.Integer, primary_key=True)
    commitment_id = db.Column(db.Integer, db.ForeignKey("commitment.id"), nullable=False, index=True)
    amount = db.Column(db.Numeric(14, 2), nullable=False)  # the amount charged at that time
    paid_on = db.Column(db.Date, nullable=False)
    for_due_date = db.Column(db.Date)  # which due date this settled
    method = db.Column(db.String(40))
    reference = db.Column(db.String(120))
    notes = db.Column(db.Text)

    commitment = db.relationship("Commitment", back_populates="payments")


INCOME_KINDS = [("salary", "Salary"), ("bonus", "Bonus"), ("interest", "Interest / dividends"),
                ("other", "Other income")]
INCOME_LABELS = dict(INCOME_KINDS)


class IncomeEntry(TimestampMixin, db.Model):
    __tablename__ = "income_entry"
    __table_args__ = (db.CheckConstraint("amount > 0", name="ck_income_positive"),)

    id = db.Column(db.Integer, primary_key=True)
    received_on = db.Column(db.Date, nullable=False, index=True)
    kind = db.Column(db.String(20), nullable=False, default="salary")
    source = db.Column(db.String(120))
    amount = db.Column(db.Numeric(14, 2), nullable=False)
    notes = db.Column(db.Text)


EXPENSE_CATEGORIES = ["Groceries", "Medical", "Travel", "Fuel", "Shopping", "Dining", "Education",
                      "Household", "Gifts", "Miscellaneous"]


class PersonalExpense(TimestampMixin, db.Model):
    """One-off personal spending that isn't a recurring commitment or a property bill."""

    __tablename__ = "personal_expense"
    __table_args__ = (db.CheckConstraint("amount > 0", name="ck_pexpense_positive"),)

    id = db.Column(db.Integer, primary_key=True)
    spent_on = db.Column(db.Date, nullable=False, index=True)
    category = db.Column(db.String(60), nullable=False, default="Miscellaneous")
    description = db.Column(db.String(200))
    amount = db.Column(db.Numeric(14, 2), nullable=False)
    method = db.Column(db.String(40))
    notes = db.Column(db.Text)


INVESTMENT_TYPES = [("mutual_fund", "Mutual fund"), ("equity", "Equity / shares"), ("fd", "Fixed deposit"),
                    ("ppf_epf", "PPF / EPF / NPS"), ("gold", "Gold"), ("other", "Other")]
INVESTMENT_LABELS = dict(INVESTMENT_TYPES)


class Investment(TimestampMixin, db.Model):
    """A holding: what I put in and what it's worth now (updated by hand)."""

    __tablename__ = "investment"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    kind = db.Column(db.String(20), nullable=False, default="mutual_fund")
    platform = db.Column(db.String(120))
    invested_amount = db.Column(db.Numeric(14, 2), nullable=False, default=ZERO)
    current_value = db.Column(db.Numeric(14, 2))
    value_as_of = db.Column(db.Date)
    notes = db.Column(db.Text)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    @property
    def kind_label(self):
        return INVESTMENT_LABELS.get(self.kind, self.kind)

    @property
    def gain(self):
        if self.current_value is None:
            return None
        return self.current_value - self.invested_amount
