from datetime import date, timedelta
from decimal import Decimal

from app.extensions import db
from app.models import Commitment, CommitmentPayment
from app.services.dates import next_due_date


def record_payment(c: Commitment, amount: Decimal, paid_on: date, *, method=None, reference=None,
                   notes=None, advance_due: bool = True) -> CommitmentPayment:
    """Log a real payment. The next due date moves forward separately from the payment date."""
    pay = CommitmentPayment(commitment=c, amount=amount, paid_on=paid_on, method=method,
                            reference=reference, notes=notes, for_due_date=c.next_due_date)
    db.session.add(pay)

    if c.kind == "mobile" and c.plan_type == "prepaid" and c.validity_days:
        # Prepaid: validity counts from the recharge date; the next recharge is due at expiry.
        c.expiry_date = paid_on + timedelta(days=c.validity_days)
        if advance_due:
            c.next_due_date = c.expiry_date
    elif advance_due and c.next_due_date:
        c.next_due_date = next_due_date(c.next_due_date, c.frequency, c.interval_days, c.due_day)
    if advance_due and c.frequency == "one_time":
        c.next_due_date = None

    db.session.flush()
    if c.total_installments and c.installments_paid >= c.total_installments:
        c.status = "closed"
        c.next_due_date = None
    return pay


def set_anchor(c: Commitment) -> None:
    if c.next_due_date and not c.due_day:
        c.due_day = c.next_due_date.day


def monthly_cost(c: Commitment) -> Decimal:
    """Estimated per-month cost (an estimate, not an actual payment)."""
    per = {"weekly": Decimal(52) / 12, "monthly": Decimal(1), "quarterly": Decimal(1) / 3,
           "half_yearly": Decimal(1) / 6, "yearly": Decimal(1) / 12}
    if c.frequency == "custom":
        factor = Decimal(365) / 12 / max(c.interval_days or 1, 1)
    elif c.frequency == "one_time":
        return Decimal("0.00")
    else:
        factor = per[c.frequency]
    return (c.amount * factor).quantize(Decimal("0.01"))
