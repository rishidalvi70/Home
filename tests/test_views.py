"""Drive the real pages: forms, validation, edit/delete rules."""
import html as htmllib
import re
from datetime import date
from decimal import Decimal

import pytest

from app.extensions import db
from app.models import (Bill, Commitment, CommitmentPayment, FamilyMember, IncomeEntry, Investment, PersonalExpense,
                        Property, RentObligation, Tenant, UtilityConnection)
from tests.conftest import post

D = Decimal
TODAY = date.today().isoformat()


def pid(app, name):
    with app.app_context():
        return Property.query.filter_by(name=name).one().id


def test_every_page_renders(app, seeded, auth_client):
    p = pid(app, "Room 2")
    pages = ["/", "/properties/", "/properties/?archived=1", f"/properties/{p}", f"/properties/{p}/edit",
             "/properties/new", f"/properties/{p}/connections/new", f"/properties/{p}/tenants/new",
             "/rent/", "/rent/generate", "/bills/", "/bills/new", "/personal/", "/personal/commitments",
             "/personal/members", "/personal/income", "/personal/expenses", "/personal/investments",
             "/personal/income/new", "/personal/expenses/new", "/personal/investments/new", "/personal/members/new"]
    pages += [f"/personal/commitments?kind={k}" for k in ("mobile", "subscription", "emi", "insurance", "sip", "other")]
    pages += [f"/personal/commitments/new?kind={k}" for k in ("mobile", "subscription", "emi", "insurance", "sip", "other")]
    for url in pages:
        r = auth_client.get(url)
        assert r.status_code == 200, url


def test_unknown_ids_give_404(auth_client):
    for url in ("/properties/999", "/rent/999", "/bills/999", "/personal/commitments/999", "/personal/income/999"):
        assert auth_client.get(url).status_code == 404, url


def test_posts_without_csrf_are_rejected(app, seeded, auth_client):
    p = pid(app, "Room 2")
    for url in (f"/properties/{p}/archive", f"/properties/{p}/delete", "/properties/new", "/bills/new",
                "/personal/income/new"):
        assert auth_client.post(url, data={"name": "x"}).status_code == 400, url


def test_add_edit_archive_restore_property(app, auth_client):
    r = post(auth_client, "/properties/new", {"name": "Shop A", "occupancy_status": "vacant",
                                              "rent_collected_by": "father", "area_sqft": "250.5",
                                              "mhada_room_no": "12/B", "ward_name": "G-North"})
    assert r.status_code == 302
    with app.app_context():
        p = Property.query.filter_by(name="Shop A").one()
        assert (p.rent_collected_by, p.area_sqft, p.address, p.ward_number) == ("father", D("250.50"), None, None)
        pid_ = p.id
    # rename + change occupancy
    assert post(auth_client, f"/properties/{pid_}/edit", {"name": "Shop B", "occupancy_status": "rented",
                                                         "rent_collected_by": "me", "mhada_room_no": ""}).status_code == 302
    with app.app_context():
        p = db.session.get(Property, pid_)
        assert (p.name, p.occupancy_status, p.mhada_room_no) == ("Shop B", "rented", None)  # blank clears
    assert post(auth_client, f"/properties/{pid_}/archive").status_code == 302
    link = f'href="/properties/{pid_}"'
    assert link not in auth_client.get("/properties/").get_data(as_text=True)
    assert link in auth_client.get("/properties/?archived=1").get_data(as_text=True)
    post(auth_client, f"/properties/{pid_}/restore")
    assert link in auth_client.get("/properties/").get_data(as_text=True)


def test_property_validation_errors(auth_client):
    r = post(auth_client, "/properties/new", {"name": "", "occupancy_status": "haunted", "rent_collected_by": "me"})
    assert r.status_code == 200 and "This field is required" in r.get_data(as_text=True)
    assert "Not a valid choice" in r.get_data(as_text=True)


def test_property_with_records_cannot_be_deleted(app, seeded, auth_client):
    p = pid(app, "Room 2")
    post(auth_client, f"/properties/{p}/tenants/new", {"name": "Asha", "monthly_rent": "5000", "rent_due_day": "5"})
    r = post(auth_client, f"/properties/{p}/delete", follow_redirects=True)
    assert "can't be deleted" in htmllib.unescape(r.get_data(as_text=True))
    with app.app_context():
        assert db.session.get(Property, p) is not None
    # an empty one can be deleted
    post(auth_client, "/properties/new", {"name": "Oops", "occupancy_status": "vacant", "rent_collected_by": "me"})
    with app.app_context():
        oid = Property.query.filter_by(name="Oops").one().id
    post(auth_client, f"/properties/{oid}/delete")
    with app.app_context():
        assert db.session.get(Property, oid) is None


def test_connections_support_several_per_property(app, seeded, auth_client):
    p = pid(app, "Room 2")
    for kind, no in (("electricity", "100200300"), ("electricity", "555666777"), ("gas", "G-998877")):
        assert post(auth_client, f"/properties/{p}/connections/new",
                    {"kind": kind, "consumer_no": no, "provider": "X", "is_active": "y"}).status_code == 302
    with app.app_context():
        assert UtilityConnection.query.filter_by(property_id=p).count() == 3
        c = UtilityConnection.query.filter_by(consumer_no="100200300").one()
        assert c.masked_consumer_no == "•••••0300"
    html = auth_client.get(f"/properties/{p}").get_data(as_text=True)
    assert "100200300" in html and "G-998877" in html


def test_tenant_rent_increment_and_ledger_flow(app, seeded, auth_client):
    p = pid(app, "Room 2")
    assert post(auth_client, f"/properties/{p}/tenants/new",
                {"name": "Asha", "phone": "99999", "monthly_rent": "5000", "rent_due_day": "5",
                 "security_deposit": "30000", "increment_percent": "10", "start_date": "2026-01-01",
                 "is_active": "y"}).status_code == 302
    with app.app_context():
        t = Tenant.query.one()
        tid = t.id
        assert t.security_deposit == D("30000")
    # increment recorded -> tenant's current rent follows (effective date in the past)
    assert post(auth_client, f"/properties/tenants/{tid}/revisions/new",
                {"effective_from": "2026-04-01", "new_rent": "5500", "reason": "annual"}).status_code == 302
    with app.app_context():
        assert db.session.get(Tenant, tid).monthly_rent == D("5500")
    # generate: preview saves nothing, then create
    html = auth_client.get("/rent/generate?month=2026-05").get_data(as_text=True)
    assert "Asha" in html and "₹5,500" in html
    with app.app_context():
        assert RentObligation.query.count() == 0
    post(auth_client, "/rent/generate?month=2026-05", {"tenant_id": str(tid)})
    post(auth_client, "/rent/generate?month=2026-05", {"tenant_id": str(tid)})  # second time: no duplicate
    with app.app_context():
        assert RentObligation.query.count() == 1
        oid = RentObligation.query.one().id
    base = f"/rent/{oid}"
    # overpayment and duplicates are refused; partial then full accepted
    r = post(auth_client, base, {"amount": "9000", "paid_on": "2026-05-06"}, token_from=base)
    assert "more than the outstanding" in r.get_data(as_text=True)
    assert post(auth_client, base, {"amount": "2000", "paid_on": "2026-05-06"}, token_from=base).status_code == 302
    r = post(auth_client, base, {"amount": "2000", "paid_on": "2026-05-06"}, token_from=base)
    assert "identical payment" in r.get_data(as_text=True)
    assert post(auth_client, base, {"amount": "3500", "paid_on": "2026-05-20"}, token_from=base).status_code == 302
    with app.app_context():
        ob = db.session.get(RentObligation, oid)
        assert (ob.received, ob.outstanding, ob.status) == (D("5500"), D("0"), "paid")
    assert "Paid" in auth_client.get("/rent/?month=2026-05").get_data(as_text=True)
    # future payment date is refused
    r = post(auth_client, base, {"amount": "1", "paid_on": "2999-01-01"}, token_from=base)
    assert "future" in r.get_data(as_text=True)


def test_tenant_with_history_is_kept_when_removed(app, seeded, auth_client):
    p = pid(app, "Room 2")
    post(auth_client, f"/properties/{p}/tenants/new", {"name": "Asha", "monthly_rent": "5000", "rent_due_day": "5",
                                                       "start_date": "2026-01-01", "is_active": "y"})
    with app.app_context():
        tid = Tenant.query.one().id
    post(auth_client, "/rent/generate?month=2026-05", {"tenant_id": str(tid)})
    post(auth_client, f"/properties/tenants/{tid}/delete")
    with app.app_context():
        t = db.session.get(Tenant, tid)
        assert t is not None and not t.is_active and t.end_date is not None


def test_delete_increment_restores_rent(app, seeded, auth_client):
    p = pid(app, "Room 2")
    post(auth_client, f"/properties/{p}/tenants/new", {"name": "Asha", "monthly_rent": "5000", "rent_due_day": "5"})
    with app.app_context():
        tid = Tenant.query.one().id
    post(auth_client, f"/properties/tenants/{tid}/revisions/new", {"effective_from": "2026-01-01", "new_rent": "6000"})
    with app.app_context():
        t = db.session.get(Tenant, tid)
        rid = t.revisions[0].id
        assert t.monthly_rent == D("6000")
    post(auth_client, f"/properties/revisions/{rid}/delete")
    with app.app_context():
        assert db.session.get(Tenant, tid).monthly_rent == D("5000")


def test_bill_flow_with_responsibility(app, seeded, auth_client):
    p = pid(app, "Room 2")
    r = post(auth_client, "/bills/new", {"property_id": p, "category": "electricity", "name": "Oct light",
                                         "bill_number": "E-123", "amount": "1500", "responsible": "owner",
                                         "tenant_payment_state": "not_reported", "due_date": "2026-10-20"})
    assert r.status_code == 302
    with app.app_context():
        b = Bill.query.one()
        bid = b.id
        assert (b.bill_number, b.my_share) == ("E-123", D("1500"))
    base = f"/bills/{bid}"
    assert post(auth_client, f"{base}/pay", {"pay-amount": "500", "pay-paid_on": "2026-10-10"}, token_from=base).status_code == 302
    r = post(auth_client, f"{base}/pay", {"pay-amount": "5000", "pay-paid_on": "2026-10-10"}, token_from=base,
             follow_redirects=True)
    assert "more than the outstanding" in r.get_data(as_text=True)
    with app.app_context():
        assert db.session.get(Bill, bid).paid == D("500")
    # cannot delete a bill that has payments
    assert "has payments" in post(auth_client, f"{base}/delete", follow_redirects=True).get_data(as_text=True)


def test_shared_bill_requires_my_share(app, seeded, auth_client):
    p = pid(app, "Room 2")
    r = post(auth_client, "/bills/new", {"property_id": p, "category": "maintenance", "name": "Society",
                                         "amount": "1000", "responsible": "shared", "tenant_payment_state": "not_reported"})
    assert r.status_code == 200 and "Enter my share" in r.get_data(as_text=True)
    r = post(auth_client, "/bills/new", {"property_id": p, "category": "maintenance", "name": "Society",
                                         "amount": "1000", "responsible": "shared", "owner_share": "2000",
                                         "tenant_payment_state": "not_reported"})
    assert "can't be more than" in htmllib.unescape(r.get_data(as_text=True))


def test_tenant_paid_bill_cannot_take_my_payment(app, seeded, auth_client):
    p = pid(app, "Room 2")
    post(auth_client, "/bills/new", {"property_id": p, "category": "gas", "name": "Gas", "amount": "800",
                                     "responsible": "tenant", "tenant_payment_state": "reported"})
    with app.app_context():
        bid = Bill.query.one().id
    r = post(auth_client, f"/bills/{bid}/pay", {"pay-amount": "800", "pay-paid_on": TODAY}, token_from=f"/bills/{bid}",
             follow_redirects=True)
    assert "isn't yours to pay" in htmllib.unescape(r.get_data(as_text=True))


def test_connection_must_belong_to_selected_property(app, seeded, auth_client):
    p2, p3 = pid(app, "Room 2"), pid(app, "Room 3")
    post(auth_client, f"/properties/{p2}/connections/new", {"kind": "gas", "consumer_no": "1"})
    with app.app_context():
        cid = UtilityConnection.query.one().id
    r = post(auth_client, "/bills/new", {"property_id": p3, "connection_id": cid, "category": "gas", "name": "x",
                                         "amount": "1", "responsible": "owner", "tenant_payment_state": "not_reported"})
    assert r.status_code == 200 and "different property" in r.get_data(as_text=True)


def test_bill_filters(app, seeded, auth_client):
    p2, p3 = pid(app, "Room 2"), pid(app, "Room 3")
    for p, name, resp in ((p2, "Alpha light", "owner"), (p3, "Beta gas", "tenant")):
        post(auth_client, "/bills/new", {"property_id": p, "category": "electricity", "name": name, "amount": "100",
                                         "responsible": resp, "tenant_payment_state": "not_reported"})
    html = auth_client.get(f"/bills/?property={p2}").get_data(as_text=True)
    assert "Alpha light" in html and "Beta gas" not in html
    assert "Beta gas" in auth_client.get("/bills/?responsible=tenant").get_data(as_text=True)
    assert "Alpha light" not in auth_client.get("/bills/?status=not_mine").get_data(as_text=True)
    assert "Alpha light" in auth_client.get("/bills/?q=alpha").get_data(as_text=True)


def test_commitment_flow_mobile_prepaid(app, auth_client):
    with app.app_context():
        db.session.add(FamilyMember(name="Mom"))
        db.session.commit()
        mid = FamilyMember.query.one().id
    r = post(auth_client, "/personal/commitments/new?kind=mobile",
             {"kind": "mobile", "name": "Jio 299", "provider": "Jio", "member_id": mid, "amount": "299",
              "frequency": "monthly", "status": "active", "plan_type": "prepaid", "validity_days": "84",
              "next_due_date": "2026-05-01", "reference": "XXXXX1234"})
    assert r.status_code == 302
    with app.app_context():
        c = Commitment.query.one()
        cid = c.id
        assert (c.member_id, c.due_day, c.total_installments) == (mid, 1, None)
    base = f"/personal/commitments/{cid}"
    assert post(auth_client, f"{base}/pay", {"pay-amount": "299", "pay-paid_on": "2026-05-01", "pay-advance_due": "y"},
                token_from=base).status_code == 302
    with app.app_context():
        c = db.session.get(Commitment, cid)
        assert c.expiry_date == date(2026, 7, 24) and len(c.payments) == 1
    assert "Jio 299" in auth_client.get("/personal/commitments?kind=mobile").get_data(as_text=True)
    # delete with history -> cancelled, not removed
    post(auth_client, f"{base}/delete")
    with app.app_context():
        c = db.session.get(Commitment, cid)
        assert c.status == "cancelled" and len(c.payments) == 1


def test_emi_form_has_loan_fields_and_hides_mobile_fields(auth_client):
    html = auth_client.get("/personal/commitments/new?kind=emi").get_data(as_text=True)
    assert "Total installments" in html and "Loan amount" in html and "Prepaid validity" not in html
    html = auth_client.get("/personal/commitments/new?kind=mobile").get_data(as_text=True)
    assert "Prepaid validity" in html and "Total installments" not in html


def test_custom_frequency_needs_interval(auth_client):
    r = post(auth_client, "/personal/commitments/new?kind=other",
             {"kind": "other", "name": "Maid", "amount": "100", "frequency": "custom", "status": "active"})
    assert "number of days" in r.get_data(as_text=True)


@pytest.mark.parametrize("slug,data,model", [
    ("income", {"received_on": "2026-05-01", "kind": "salary", "amount": "80000", "source": "Employer"}, IncomeEntry),
    ("expenses", {"spent_on": "2026-05-02", "category": "Groceries", "amount": "1200"}, PersonalExpense),
    ("investments", {"name": "Nifty 50 fund", "kind": "mutual_fund", "invested_amount": "50000",
                     "current_value": "56000", "is_active": "y"}, Investment),
    ("members", {"name": "Dad", "is_active": "y"}, FamilyMember),
])
def test_simple_crud(app, auth_client, slug, data, model):
    assert post(auth_client, f"/personal/{slug}/new", data).status_code == 302
    with app.app_context():
        obj = model.query.one()
        oid = obj.id
    assert auth_client.get(f"/personal/{slug}/{oid}").status_code == 200
    assert auth_client.get(f"/personal/{slug}?month=2026-05").status_code == 200
    data = dict(data)
    first = next(k for k in ("amount", "invested_amount", "name") if k in data)
    data[first] = "Mom" if first == "name" else "999"
    assert post(auth_client, f"/personal/{slug}/{oid}", data).status_code == 302
    post(auth_client, f"/personal/{slug}/{oid}/delete")
    with app.app_context():
        assert model.query.count() == 0


def test_zero_or_negative_amounts_rejected(auth_client):
    for amt in ("0", "-5", "abc"):
        r = post(auth_client, "/personal/income/new", {"received_on": "2026-05-01", "kind": "salary", "amount": amt})
        assert r.status_code == 200, amt


def test_investment_gain_shown(app, auth_client):
    post(auth_client, "/personal/investments/new", {"name": "Fund", "kind": "mutual_fund", "invested_amount": "50000",
                                                    "current_value": "56000", "is_active": "y"})
    html = auth_client.get("/personal/investments").get_data(as_text=True)
    assert "₹6,000" in html and "12.0%" in html


def test_member_in_use_is_deactivated_not_deleted(app, auth_client):
    with app.app_context():
        m = FamilyMember(name="Dad")
        db.session.add(m)
        db.session.flush()
        db.session.add(Commitment(kind="mobile", name="p", amount=D("1"), member_id=m.id))
        db.session.commit()
        mid = m.id
    post(auth_client, f"/personal/members/{mid}/delete")
    with app.app_context():
        assert db.session.get(FamilyMember, mid).is_active is False


def test_personal_overview_numbers(app, seeded, auth_client):
    post(auth_client, "/personal/income/new", {"received_on": TODAY, "kind": "salary", "amount": "70000"})
    post(auth_client, "/personal/expenses/new", {"spent_on": TODAY, "category": "Fuel", "amount": "2000"})
    html = auth_client.get("/personal/").get_data(as_text=True)
    assert "₹70,000" in html and "₹2,000" in html and "₹68,000" in html


def test_indian_rupee_formatting():
    from app.filters import inr

    assert inr(D("1234567.5")) == "₹12,34,568"
    assert inr(D("1234567.5"), 2) == "₹12,34,567.50"
    assert inr(D("999")) == "₹999" and inr(D("1000")) == "₹1,000" and inr(D("-100000")) == "-₹1,00,000"
    assert inr(None) == "—"
