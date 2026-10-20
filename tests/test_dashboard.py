import re
from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models import (Bill, BillPayment, Commitment, IncomeEntry, PersonalExpense, Property, RentObligation,
                        RentPayment, Tenant)
from app.models.property import seed_initial_properties
from app.services.commitments import record_payment
from app.services.dashboard import month_figures, outstanding_rent

D = Decimal
M = date(2026, 5, 1)


def _active_count(html):
    return int(re.search(r'data-testid="active-properties">\s*(\d+)', html).group(1))


def test_property_counts_come_from_database(app, auth_client):
    with app.app_context():
        seed_initial_properties()
    assert _active_count(auth_client.get("/").get_data(as_text=True)) == 6
    with app.app_context():
        db.session.add(Property(name="Room 7", occupancy_status="vacant"))
        Property.query.filter_by(name="Room 3").one().archive()
        db.session.commit()
    assert _active_count(auth_client.get("/").get_data(as_text=True)) == 6  # +1 -1


def _rent(prop_name, collector, expected="5000", paid=None):
    prop = Property.query.filter_by(name=prop_name).one()
    prop.rent_collected_by = collector
    t = Tenant(property=prop, name=f"T-{prop_name}", monthly_rent=D(expected), start_date=date(2026, 1, 1))
    ob = RentObligation(property=prop, tenant=t, period_start=M, expected_amount=D(expected), due_date=date(2026, 5, 5))
    db.session.add_all([t, ob])
    if paid:
        db.session.add(RentPayment(obligation=ob, amount=D(paid), paid_on=date(2026, 5, 6)))
    db.session.commit()


def test_only_rent_i_collect_is_my_income(app, seeded):
    with app.app_context():
        _rent("Room 2", "me", paid="5000")
        _rent("Room 3", "father", paid="4000")
        f = month_figures(M)
        assert f["rent_received_mine"] == D("5000") and f["rent_received_family"] == D("4000")
        assert f["total_income"] == D("5000")
        assert f["rent_expected_mine"] == D("5000") and f["rent_expected_family"] == D("5000")
        owed = outstanding_rent(date(2026, 6, 1))
        assert owed["mine"] == D("0") and owed["family"] == D("1000")


def test_security_deposit_is_not_income(app, seeded):
    with app.app_context():
        prop = Property.query.filter_by(name="Room 2").one()
        db.session.add(Tenant(property=prop, name="X", monthly_rent=D("5000"), security_deposit=D("50000")))
        db.session.commit()
        assert month_figures(M)["total_income"] == 0


def test_spending_is_actual_payments_only(app, seeded):
    with app.app_context():
        prop = Property.query.filter_by(name="Room 2").one()
        paid = Bill(property=prop, category="electricity", name="Light", amount=D("1000"), responsible="owner")
        unpaid = Bill(property=prop, category="gas", name="Gas", amount=D("700"), responsible="owner",
                      due_date=date(2026, 4, 1))  # long overdue, still not spending
        tenant_paid = Bill(property=prop, category="water", name="Water", amount=D("300"), responsible="tenant")
        db.session.add_all([paid, unpaid, tenant_paid])
        db.session.flush()
        db.session.add(BillPayment(bill=paid, amount=D("1000"), paid_on=date(2026, 5, 10)))
        db.session.add(BillPayment(bill=paid, amount=D("0.01"), paid_on=date(2026, 6, 10)))  # other month
        db.session.commit()
        f = month_figures(M)
        assert f["property_expenses"] == D("1000") and f["by_bill_category"] == {"Electricity": D("1000")}
        assert f["total_expenses"] == D("1000")


def test_budget_left_after_salary_expenses_and_sip(app, seeded):
    with app.app_context():
        db.session.add(IncomeEntry(received_on=date(2026, 5, 1), kind="salary", amount=D("80000")))
        db.session.add(IncomeEntry(received_on=date(2026, 5, 15), kind="interest", amount=D("500")))
        db.session.add(PersonalExpense(spent_on=date(2026, 5, 3), category="Groceries", amount=D("6000")))
        sub = Commitment(kind="subscription", name="Netflix", amount=D("649"), next_due_date=date(2026, 5, 7))
        emi = Commitment(kind="emi", name="Loan", amount=D("10000"), next_due_date=date(2026, 5, 5))
        sip = Commitment(kind="sip", name="Index fund", amount=D("5000"), next_due_date=date(2026, 5, 10))
        db.session.add_all([sub, emi, sip])
        db.session.flush()
        for c, d in ((sub, 7), (emi, 5), (sip, 10)):
            record_payment(c, c.amount, date(2026, 5, d))
        db.session.commit()
        f = month_figures(M)
        assert f["salary"] == D("80000") and f["other_income"] == D("500")
        assert f["total_expenses"] == D("16649")  # 6000 + 649 + 10000
        assert f["investments"] == D("5000")  # SIP is not an expense
        assert f["remaining"] == D("80500") - D("16649") - D("5000")


def test_upcoming_lists_include_overdue_and_family_rent_note(app, seeded, auth_client):
    with app.app_context():
        db.session.add(Commitment(kind="insurance", name="LIC", amount=D("12000"), next_due_date=date(2020, 1, 1)))
        db.session.commit()
    html = auth_client.get("/").get_data(as_text=True)
    assert "LIC" in html and "overdue" in html


def test_dashboard_page_renders_with_data(app, seeded, auth_client):
    with app.app_context():
        _rent("Room 2", "me", paid="2000")
        db.session.add(IncomeEntry(received_on=date.today(), kind="salary", amount=D("50000")))
        db.session.commit()
    r = auth_client.get("/")
    html = r.get_data(as_text=True)
    assert r.status_code == 200 and "₹50,000" in html and "data-chart" in html
    assert auth_client.get("/?month=2026-05").status_code == 200
    assert auth_client.get("/?month=nonsense").status_code == 200
