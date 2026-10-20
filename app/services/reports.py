from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models import Bill, BillPayment, Property, RentObligation, RentPayment
from app.models.bill import CATEGORY_LABELS

ZERO = Decimal("0.00")


def property_report(prop: Property, start: date | None = None, end: date | None = None) -> dict:
    """Room-level numbers. Cash uses payment dates; rent due uses obligation periods.

    Tenant-paid and other-party bills are listed separately and never counted as owner spend.
    """
    ob_q = RentObligation.query.filter_by(property_id=prop.id, is_cancelled=False)
    if start:
        ob_q = ob_q.filter(RentObligation.period_start >= start)
    if end:
        ob_q = ob_q.filter(RentObligation.period_start < end)
    obligations = ob_q.all()
    expected = sum((o.expected_amount for o in obligations), ZERO)
    received_for_periods = sum((o.received for o in obligations), ZERO)
    outstanding = sum((o.outstanding for o in obligations), ZERO)

    pay_q = (db.session.query(func.coalesce(func.sum(RentPayment.amount), 0)).join(RentObligation)
             .filter(RentObligation.property_id == prop.id))
    if start:
        pay_q = pay_q.filter(RentPayment.paid_on >= start)
    if end:
        pay_q = pay_q.filter(RentPayment.paid_on < end)
    rent_cash = pay_q.scalar() or ZERO

    owner_by_cat = defaultdict(lambda: ZERO)
    q = (db.session.query(Bill.category, func.sum(BillPayment.amount)).join(Bill)
         .filter(Bill.property_id == prop.id, Bill.is_cancelled.is_(False)))
    if start:
        q = q.filter(BillPayment.paid_on >= start)
    if end:
        q = q.filter(BillPayment.paid_on < end)
    for cat, total in q.group_by(Bill.category):
        owner_by_cat[CATEGORY_LABELS.get(cat, cat)] += total

    bill_q = Bill.query.filter(Bill.property_id == prop.id, Bill.is_cancelled.is_(False),
                               Bill.responsible.in_(["tenant", "other"]))
    tenant_paid = sum((b.amount for b in bill_q if (not start or (b.due_date or date.min) >= start)
                       and (not end or (b.due_date or date.min) < end)), ZERO)

    owner_total = sum(owner_by_cat.values(), ZERO)
    return {
        "rent_expected": expected, "rent_received_for_periods": received_for_periods,
        "rent_outstanding": outstanding, "rent_cash_received": rent_cash,
        "owner_by_category": dict(owner_by_cat), "owner_total": owner_total,
        "tenant_paid_recorded": tenant_paid,
        "net_cash_flow": rent_cash - owner_total,
    }
