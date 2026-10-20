from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Bill, BillPayment, Property

D = Decimal


def bill(responsible="owner", amount="1000", share=None, **kw):
    prop = Property.query.filter_by(name="Room 2").one()
    b = Bill(property=prop, category=kw.pop("category", "electricity"), name=kw.pop("name", "Oct light"),
             amount=D(amount), responsible=responsible, owner_share=D(share) if share else None, **kw)
    db.session.add(b)
    db.session.commit()
    return b


def pay(b, amount, on=None):
    db.session.add(BillPayment(bill=b, amount=D(amount), paid_on=on or date.today()))
    db.session.commit()


def test_owner_bill_flow(app, seeded):
    with app.app_context():
        b = bill(due_date=date.today() + timedelta(days=5))
        assert (b.my_share, b.outstanding, b.status) == (D("1000"), D("1000"), "unpaid")
        pay(b, "400")
        assert (b.paid, b.outstanding, b.status) == (D("400"), D("600"), "partial")
        pay(b, "600")
        assert (b.outstanding, b.status) == (D("0"), "paid")


def test_due_date_passing_does_not_mark_paid(app, seeded):
    with app.app_context():
        b = bill(due_date=date.today() - timedelta(days=10))
        assert b.status == "overdue" and b.paid == 0


def test_tenant_paid_bill_is_not_my_expense(app, seeded):
    with app.app_context():
        b = bill("tenant", tenant_payment_state="reported")
        assert (b.my_share, b.outstanding, b.status) == (D("0"), D("0"), "not_mine")


def test_shared_bill_splits_responsibility(app, seeded):
    with app.app_context():
        b = bill("shared", amount="1000", share="400")
        assert b.my_share == D("400")
        pay(b, "400")
        assert b.status == "paid"


def test_shared_share_cannot_exceed_amount(app, seeded):
    with app.app_context():
        assert bill("shared", amount="1000", share="2000").my_share == D("1000")


def test_cancelled_bill_counts_nothing(app, seeded):
    with app.app_context():
        b = bill()
        b.is_cancelled = True
        assert (b.my_share, b.outstanding, b.status) == (D("0"), D("0"), "cancelled")


def test_money_columns_are_fixed_precision(app, seeded):
    with app.app_context():
        b = bill(amount="0.10")
        pay(b, "0.10")
        db.session.refresh(b)
        assert b.paid == D("0.10") and isinstance(b.amount, Decimal)


def test_zero_or_negative_payment_rejected_by_database(app, seeded):
    with app.app_context():
        b = bill()
        db.session.add(BillPayment(bill=b, amount=D("0"), paid_on=date.today()))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()
