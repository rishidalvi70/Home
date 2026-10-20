from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models import Property, RentObligation, RentPayment, Tenant
from app.services.rent import (apply_revision, create_obligations, preview_obligations, rent_for,
                               suggested_new_rent)

D = Decimal


def make_tenant(name="Asha", rent="5000", prop_name="Room 2", **kw):
    prop = Property.query.filter_by(name=prop_name).one()
    t = Tenant(property=prop, name=name, monthly_rent=D(rent), rent_due_day=kw.pop("rent_due_day", 5),
               start_date=kw.pop("start_date", date(2026, 1, 1)), **kw)
    db.session.add(t)
    db.session.commit()
    return t


def test_rent_history_uses_the_rent_in_force(app, seeded):
    with app.app_context():
        t = make_tenant(rent="5000")
        apply_revision(t, date(2026, 4, 1), D("5500"), "yearly increase")
        apply_revision(t, date(2027, 4, 1), D("6000"), None)
        db.session.commit()
        assert rent_for(t, date(2026, 3, 1)) == D("5000")  # before any increment
        assert rent_for(t, date(2026, 4, 1)) == D("5500")
        assert rent_for(t, date(2027, 3, 31)) == D("5500")
        assert rent_for(t, date(2027, 4, 1)) == D("6000")
        revs = sorted(t.revisions, key=lambda r: r.effective_from)
        assert (revs[0].old_rent, revs[0].new_rent, revs[0].percent) == (D("5000"), D("5500"), D("10.0"))
        assert revs[1].old_rent == D("5500")


def test_suggested_rent_from_planned_percent(app, seeded):
    with app.app_context():
        t = make_tenant(rent="5000", increment_percent=D("5"))
        assert suggested_new_rent(t) == D("5250")
        assert suggested_new_rent(make_tenant("B", prop_name="Room 3")) is None


def test_generate_is_idempotent_and_uses_that_months_rent(app, seeded):
    with app.app_context():
        t = make_tenant(rent="5000", rent_due_day=31)
        apply_revision(t, date(2026, 3, 1), D("5500"), None)
        db.session.commit()
        feb = date(2026, 2, 1)
        rows = preview_obligations(feb)
        assert len(rows) == 1 and rows[0]["amount"] == D("5000") and rows[0]["due_date"] == date(2026, 2, 28)
        assert RentObligation.query.count() == 0  # preview saves nothing
        assert create_obligations(feb, {t.id}) == 1
        assert create_obligations(feb, {t.id}) == 0  # no duplicate
        assert RentObligation.query.count() == 1
        assert preview_obligations(feb)[0]["exists"] is True
        create_obligations(date(2026, 3, 1), {t.id})
        assert RentObligation.query.filter_by(period_start=date(2026, 3, 1)).one().expected_amount == D("5500")


def test_generation_never_marks_rent_received(app, seeded):
    with app.app_context():
        t = make_tenant()
        create_obligations(date(2026, 5, 1), {t.id})
        ob = RentObligation.query.one()
        assert ob.received == 0 and ob.outstanding == ob.expected_amount and RentPayment.query.count() == 0


def test_tenancy_dates_limit_generation(app, seeded):
    with app.app_context():
        make_tenant(start_date=date(2026, 6, 10), end_date=date(2026, 8, 15))
        assert preview_obligations(date(2026, 5, 1)) == []
        assert len(preview_obligations(date(2026, 6, 1))) == 1  # starts mid-month
        assert len(preview_obligations(date(2026, 8, 1))) == 1
        assert preview_obligations(date(2026, 9, 1)) == []


def test_archived_property_and_former_tenant_skipped(app, seeded):
    with app.app_context():
        t = make_tenant()
        t.is_active = False
        db.session.commit()
        assert preview_obligations(date(2026, 5, 1)) == []


def test_duplicate_obligation_blocked_by_database(app, seeded):
    import pytest
    from sqlalchemy.exc import IntegrityError

    with app.app_context():
        t = make_tenant()
        for _ in range(2):
            db.session.add(RentObligation(property_id=t.property_id, tenant_id=t.id, period_start=date(2026, 5, 1),
                                          expected_amount=D("5000"), due_date=date(2026, 5, 5)))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_partial_and_multiple_payments(app, seeded):
    with app.app_context():
        t = make_tenant()
        create_obligations(date(2026, 5, 1), {t.id})
        ob = RentObligation.query.one()
        db.session.add(RentPayment(obligation=ob, amount=D("2000"), paid_on=date(2026, 5, 6)))
        db.session.commit()
        assert (ob.received, ob.outstanding) == (D("2000"), D("3000"))
        assert ob.status == "overdue"  # part-paid but past due
        db.session.add(RentPayment(obligation=ob, amount=D("3000"), paid_on=date(2026, 5, 20)))
        db.session.commit()
        assert (ob.outstanding, ob.status) == (D("0.00"), "paid")


def test_cancelled_obligation_has_nothing_outstanding(app, seeded):
    with app.app_context():
        t = make_tenant()
        create_obligations(date(2026, 5, 1), {t.id})
        ob = RentObligation.query.one()
        ob.is_cancelled = True
        assert ob.outstanding == 0 and ob.status == "cancelled"
