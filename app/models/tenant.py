from decimal import Decimal

from app.extensions import db
from app.models.mixins import TimestampMixin

ZERO = Decimal("0.00")


class Tenant(TimestampMixin, db.Model):
    __tablename__ = "tenant"
    __table_args__ = (db.CheckConstraint("rent_due_day BETWEEN 1 AND 31", name="ck_tenant_due_day"),)

    id = db.Column(db.Integer, primary_key=True)
    property_id = db.Column(db.Integer, db.ForeignKey("property.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(40))
    email = db.Column(db.String(120))
    start_date = db.Column(db.Date)
    end_date = db.Column(db.Date)
    monthly_rent = db.Column(db.Numeric(14, 2), nullable=False, default=ZERO)  # current rent
    rent_due_day = db.Column(db.Integer, nullable=False, default=5)
    security_deposit = db.Column(db.Numeric(14, 2))  # kept apart from rental income
    # Expected periodic increment (informational; actual changes go in RentRevision)
    increment_percent = db.Column(db.Numeric(5, 2))
    next_increment_date = db.Column(db.Date)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    notes = db.Column(db.Text)

    property = db.relationship("Property", back_populates="tenants")
    revisions = db.relationship("RentRevision", back_populates="tenant",
                                order_by="RentRevision.effective_from.desc()",
                                cascade="all, delete-orphan")
    obligations = db.relationship("RentObligation", back_populates="tenant")


class RentRevision(TimestampMixin, db.Model):
    """History of rent increases (or decreases) for a tenancy."""

    __tablename__ = "rent_revision"

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenant.id"), nullable=False, index=True)
    effective_from = db.Column(db.Date, nullable=False)
    old_rent = db.Column(db.Numeric(14, 2), nullable=False)
    new_rent = db.Column(db.Numeric(14, 2), nullable=False)
    reason = db.Column(db.String(200))

    tenant = db.relationship("Tenant", back_populates="revisions")

    @property
    def change(self) -> Decimal:
        return self.new_rent - self.old_rent

    @property
    def percent(self):
        if not self.old_rent:
            return None
        return (self.change / self.old_rent * 100).quantize(Decimal("0.1"))


class RentObligation(TimestampMixin, db.Model):
    """What a tenant owes for one month. Payments are stored separately."""

    __tablename__ = "rent_obligation"
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "period_start", name="uq_rent_tenant_period"),
    )

    id = db.Column(db.Integer, primary_key=True)
    property_id = db.Column(db.Integer, db.ForeignKey("property.id"), nullable=False, index=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenant.id"), nullable=False, index=True)
    period_start = db.Column(db.Date, nullable=False)  # first day of the rental month
    expected_amount = db.Column(db.Numeric(14, 2), nullable=False)
    due_date = db.Column(db.Date, nullable=False)
    is_cancelled = db.Column(db.Boolean, nullable=False, default=False)
    notes = db.Column(db.Text)

    tenant = db.relationship("Tenant", back_populates="obligations")
    payments = db.relationship("RentPayment", back_populates="obligation",
                               order_by="RentPayment.paid_on", cascade="all, delete-orphan")

    @property
    def received(self) -> Decimal:
        return sum((p.amount for p in self.payments), ZERO)

    @property
    def outstanding(self) -> Decimal:
        return ZERO if self.is_cancelled else max(self.expected_amount - self.received, ZERO)

    @property
    def status(self) -> str:
        from datetime import date

        if self.is_cancelled:
            return "cancelled"
        if self.received >= self.expected_amount:
            return "paid"
        if self.received > 0:
            return "partial" if self.due_date >= date.today() else "overdue"
        return "overdue" if self.due_date < date.today() else "upcoming"

    # defined last: the name would otherwise shadow @property above
    property = db.relationship("Property")


class RentPayment(TimestampMixin, db.Model):
    __tablename__ = "rent_payment"
    __table_args__ = (db.CheckConstraint("amount > 0", name="ck_rent_payment_positive"),)

    id = db.Column(db.Integer, primary_key=True)
    obligation_id = db.Column(db.Integer, db.ForeignKey("rent_obligation.id"), nullable=False, index=True)
    amount = db.Column(db.Numeric(14, 2), nullable=False)
    paid_on = db.Column(db.Date, nullable=False)
    method = db.Column(db.String(40))
    reference = db.Column(db.String(120))
    notes = db.Column(db.Text)

    obligation = db.relationship("RentObligation", back_populates="payments")
