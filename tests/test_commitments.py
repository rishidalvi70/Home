from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models import Commitment, FamilyMember
from app.services.commitments import monthly_cost, record_payment, set_anchor

D = Decimal


def make(kind="subscription", **kw):
    c = Commitment(kind=kind, name=kw.pop("name", "Netflix"), amount=D(kw.pop("amount", "649")),
                   frequency=kw.pop("frequency", "monthly"), next_due_date=kw.pop("next_due_date", date(2026, 1, 31)),
                   **kw)
    set_anchor(c)
    db.session.add(c)
    db.session.commit()
    return c


def test_three_family_members_are_editable_labels(app):
    with app.app_context():
        for n in ("Member 1", "Member 2", "Member 3"):
            db.session.add(FamilyMember(name=n))
        db.session.commit()
        m = FamilyMember.query.filter_by(name="Member 2").one()
        m.name = "Mom"
        db.session.add(FamilyMember(name="Member 4"))
        db.session.commit()
        assert sorted(x.name for x in FamilyMember.query) == ["Member 1", "Member 3", "Member 4", "Mom"]


def test_payment_moves_due_date_without_month_end_drift(app):
    with app.app_context():
        c = make(next_due_date=date(2026, 1, 31))
        record_payment(c, D("649"), date(2026, 1, 30))
        assert c.next_due_date == date(2026, 2, 28)
        record_payment(c, D("649"), date(2026, 2, 27))
        assert c.next_due_date == date(2026, 3, 31)
        db.session.commit()
        assert c.total_paid == D("1298")


def test_payment_date_is_separate_from_due_date(app):
    with app.app_context():
        c = make(next_due_date=date(2026, 3, 10))
        p = record_payment(c, D("649"), date(2026, 3, 2))  # paid early
        assert p.paid_on == date(2026, 3, 2) and p.for_due_date == date(2026, 3, 10)
        assert c.next_due_date == date(2026, 4, 10)


def test_logging_payment_without_advancing(app):
    with app.app_context():
        c = make(next_due_date=date(2026, 3, 10))
        record_payment(c, D("100"), date(2026, 3, 2), advance_due=False)
        assert c.next_due_date == date(2026, 3, 10)


def test_price_change_keeps_history(app):
    with app.app_context():
        c = make(amount="649")
        record_payment(c, D("649"), date(2026, 1, 31))
        c.amount = D("799")  # price rises
        record_payment(c, D("799"), date(2026, 2, 28))
        db.session.commit()
        assert sorted(p.amount for p in c.payments) == [D("649"), D("799")]
        assert c.total_paid == D("1448")


def test_cancellation_keeps_records(app):
    with app.app_context():
        c = make()
        record_payment(c, D("649"), date(2026, 1, 31))
        c.status, c.end_date = "cancelled", date(2026, 3, 1)
        db.session.commit()
        assert Commitment.query.count() == 1 and len(c.payments) == 1 and c.due_state == "cancelled"


def test_emi_counts_down_and_closes(app):
    with app.app_context():
        c = make("emi", name="Home loan", amount="10000", total_installments=3, installments_done=1,
                 next_due_date=date(2026, 5, 5))
        assert (c.installments_left, c.remaining_amount) == (2, D("20000"))
        record_payment(c, D("10000"), date(2026, 5, 5))
        assert (c.installments_left, c.status) == (1, "active")
        record_payment(c, D("10000"), date(2026, 6, 5))
        assert (c.installments_left, c.status, c.next_due_date) == (0, "closed", None)


def test_prepaid_expiry_follows_recharge_and_not_28_days_by_assumption(app):
    with app.app_context():
        c = make("mobile", name="Jio – Mom", amount="299", plan_type="prepaid", validity_days=84,
                 next_due_date=date(2026, 5, 1))
        record_payment(c, D("299"), date(2026, 5, 1))
        assert c.expiry_date == date(2026, 7, 24) and c.next_due_date == date(2026, 7, 24)
        c.expiry_date = date(2026, 7, 30)  # manual correction is kept
        db.session.commit()
        assert c.expiry_date == date(2026, 7, 30)


def test_postpaid_uses_billing_frequency(app):
    with app.app_context():
        c = make("mobile", amount="499", plan_type="postpaid", next_due_date=date(2026, 5, 20))
        record_payment(c, D("520"), date(2026, 5, 18))  # actual bill differed from plan
        assert c.next_due_date == date(2026, 6, 20) and c.payments[0].amount == D("520")


def test_lic_premium_frequencies(app):
    with app.app_context():
        c = make("insurance", name="LIC Jeevan Anand", amount="12000", frequency="half_yearly",
                 total_amount=D("1000000"), next_due_date=date(2026, 8, 31))
        record_payment(c, D("12000"), date(2026, 8, 30))
        assert c.next_due_date == date(2027, 2, 28) and c.total_paid == D("12000")


def test_one_time_has_no_next_due(app):
    with app.app_context():
        c = make(frequency="one_time", next_due_date=date(2026, 5, 1))
        record_payment(c, D("649"), date(2026, 5, 1))
        assert c.next_due_date is None


def test_monthly_and_annual_estimates(app):
    with app.app_context():
        assert monthly_cost(make(amount="1200", frequency="yearly")) == D("100.00")
        assert monthly_cost(make(amount="300", frequency="quarterly")) == D("100.00")
        assert monthly_cost(make(amount="100", frequency="weekly")) == D("433.33")
        assert monthly_cost(make(amount="500", frequency="one_time")) == D("0.00")
        assert monthly_cost(make(amount="100", frequency="custom", interval_days=30)) == D("101.39")
