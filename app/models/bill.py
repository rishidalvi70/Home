from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models.mixins import TimestampMixin

ZERO = Decimal("0.00")

BILL_CATEGORIES = [
    ("electricity", "Electricity"),
    ("gas", "Gas"),
    ("water", "Water"),
    ("internet", "Internet"),
    ("maintenance", "Maintenance"),
    ("property_tax", "Property tax"),
    ("mhada", "MHADA"),
    ("repairs", "Repairs"),
    ("development", "Development"),
    ("other", "Other"),
]
CATEGORY_LABELS = dict(BILL_CATEGORIES)

RESPONSIBLE = [
    ("owner", "I pay"),
    ("tenant", "Tenant pays"),
    ("shared", "Shared"),
    ("other", "Someone else pays"),
]
RESPONSIBLE_LABELS = dict(RESPONSIBLE)

TENANT_PAYMENT_STATES = [("not_reported", "Not reported"), ("reported", "Reported by tenant"),
                         ("confirmed", "Confirmed")]


class Bill(TimestampMixin, db.Model):
    """A property expense/bill. `amount_paid` (from BillPayment rows) is only what *I* paid.

    Tenant-paid and other-party bills are recorded for the file but never count as my spend.
    """

    __tablename__ = "bill"
    __table_args__ = (db.CheckConstraint("amount >= 0", name="ck_bill_amount_nonneg"),)

    id = db.Column(db.Integer, primary_key=True)
    property_id = db.Column(db.Integer, db.ForeignKey("property.id"), nullable=False, index=True)
    connection_id = db.Column(db.Integer, db.ForeignKey("utility_connection.id"))
    category = db.Column(db.String(30), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    provider = db.Column(db.String(120))
    bill_number = db.Column(db.String(80))
    period_label = db.Column(db.String(60))  # e.g. "Oct 2026"
    received_on = db.Column(db.Date)
    due_date = db.Column(db.Date)
    amount = db.Column(db.Numeric(14, 2), nullable=False)
    responsible = db.Column(db.String(10), nullable=False, default="owner")
    owner_share = db.Column(db.Numeric(14, 2))  # only for shared bills
    tenant_payment_state = db.Column(db.String(20), nullable=False, default="not_reported")
    is_cancelled = db.Column(db.Boolean, nullable=False, default=False)
    notes = db.Column(db.Text)

    connection = db.relationship("UtilityConnection")
    payments = db.relationship("BillPayment", back_populates="bill",
                               order_by="BillPayment.paid_on", cascade="all, delete-orphan")

    @property
    def category_label(self):
        return CATEGORY_LABELS.get(self.category, self.category)

    @property
    def responsible_label(self):
        return RESPONSIBLE_LABELS.get(self.responsible, self.responsible)

    @property
    def my_share(self) -> Decimal:
        """The part of this bill that is mine to pay."""
        if self.is_cancelled:
            return ZERO
        if self.responsible == "owner":
            return self.amount
        if self.responsible == "shared":
            return min(self.owner_share or ZERO, self.amount)
        return ZERO

    @property
    def paid(self) -> Decimal:
        return sum((p.amount for p in self.payments), ZERO)

    @property
    def outstanding(self) -> Decimal:
        return max(self.my_share - self.paid, ZERO)

    @property
    def status(self) -> str:
        if self.is_cancelled:
            return "cancelled"
        if self.my_share == 0:
            return "not_mine"
        if self.paid >= self.my_share:
            return "paid"
        if self.due_date and self.due_date < date.today():
            return "overdue"
        return "partial" if self.paid > 0 else "unpaid"

    # defined last: the name would otherwise shadow @property above
    property = db.relationship("Property")


class BillPayment(TimestampMixin, db.Model):
    __tablename__ = "bill_payment"
    __table_args__ = (db.CheckConstraint("amount > 0", name="ck_bill_payment_positive"),)

    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.Integer, db.ForeignKey("bill.id"), nullable=False, index=True)
    amount = db.Column(db.Numeric(14, 2), nullable=False)
    paid_on = db.Column(db.Date, nullable=False)
    method = db.Column(db.String(40))
    reference = db.Column(db.String(120))
    notes = db.Column(db.Text)

    bill = db.relationship("Bill", back_populates="payments")
