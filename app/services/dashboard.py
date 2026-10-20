"""Dashboard figures. Everything is computed from database rows - nothing is hardcoded.

Definitions (also shown in the UI):
* Actual spending = payments with a payment date in the month. Unpaid bills are *not* spending.
* Bills the tenant (or someone else) pays are never counted as my spending.
* Rent is "my income" only for rooms whose rent I collect; family-collected rent is shown apart.
* Investments (SIPs) leave my bank but are shown apart from expenses.
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from flask import url_for
from sqlalchemy import func

from app.extensions import db
from app.models import (Bill, BillPayment, Commitment, CommitmentPayment, IncomeEntry,
                        PersonalExpense, Property, RentObligation, RentPayment)
from app.models.bill import CATEGORY_LABELS
from app.models.personal import INVESTMENT_KINDS, KIND_LABELS
from app.models.property import OCCUPANCY_STATUSES
from app.services.dates import add_months

ZERO = Decimal("0.00")


def _sum(query) -> Decimal:
    return query.scalar() or ZERO


def month_figures(start: date) -> dict:
    """Actual cash figures for one calendar month."""
    end = add_months(start, 1)

    def rent_received(collected_by_me: bool):
        q = (db.session.query(func.coalesce(func.sum(RentPayment.amount), 0))
             .join(RentObligation).join(Property, RentObligation.property_id == Property.id)
             .filter(RentPayment.paid_on >= start, RentPayment.paid_on < end))
        return _sum(q.filter(Property.rent_collected_by == "me") if collected_by_me
                    else q.filter(Property.rent_collected_by != "me"))

    def rent_expected(collected_by_me: bool):
        q = (db.session.query(func.coalesce(func.sum(RentObligation.expected_amount), 0))
             .join(Property, RentObligation.property_id == Property.id)
             .filter(RentObligation.period_start >= start, RentObligation.period_start < end,
                     RentObligation.is_cancelled.is_(False)))
        return _sum(q.filter(Property.rent_collected_by == "me") if collected_by_me
                    else q.filter(Property.rent_collected_by != "me"))

    def income(kind_salary: bool):
        q = (db.session.query(func.coalesce(func.sum(IncomeEntry.amount), 0))
             .filter(IncomeEntry.received_on >= start, IncomeEntry.received_on < end))
        return _sum(q.filter(IncomeEntry.kind == "salary") if kind_salary
                    else q.filter(IncomeEntry.kind != "salary"))

    bills_by_cat = defaultdict(lambda: ZERO)
    for cat, total in (db.session.query(Bill.category, func.sum(BillPayment.amount)).join(Bill)
                       .filter(BillPayment.paid_on >= start, BillPayment.paid_on < end,
                               Bill.is_cancelled.is_(False))
                       .group_by(Bill.category)):
        bills_by_cat[CATEGORY_LABELS.get(cat, cat)] += total

    commit_by_kind = defaultdict(lambda: ZERO)
    investments = ZERO
    for kind, total in (db.session.query(Commitment.kind, func.sum(CommitmentPayment.amount)).join(Commitment)
                        .filter(CommitmentPayment.paid_on >= start, CommitmentPayment.paid_on < end)
                        .group_by(Commitment.kind)):
        if kind in INVESTMENT_KINDS:
            investments += total
        else:
            commit_by_kind[KIND_LABELS.get(kind, kind)] += total

    everyday = {cat: total for cat, total in
                db.session.query(PersonalExpense.category, func.sum(PersonalExpense.amount))
                .filter(PersonalExpense.spent_on >= start, PersonalExpense.spent_on < end)
                .group_by(PersonalExpense.category)}
    misc = sum(everyday.values(), ZERO)

    property_expenses = sum(bills_by_cat.values(), ZERO)
    personal_expenses = sum(commit_by_kind.values(), ZERO) + misc
    categories = dict(bills_by_cat)
    categories.update(commit_by_kind)
    for cat, total in everyday.items():
        categories[cat] = categories.get(cat, ZERO) + total

    salary, other_income, rent_mine = income(True), income(False), rent_received(True)
    total_income = salary + other_income + rent_mine
    total_expenses = property_expenses + personal_expenses
    return {
        "start": start,
        "salary": salary, "other_income": other_income, "rent_received_mine": rent_mine,
        "rent_expected_mine": rent_expected(True),
        "rent_expected_family": rent_expected(False), "rent_received_family": rent_received(False),
        "total_income": total_income,
        "property_expenses": property_expenses, "personal_expenses": personal_expenses,
        "misc": misc, "by_commitment": dict(commit_by_kind), "by_bill_category": dict(bills_by_cat),
        "categories": categories,
        "total_expenses": total_expenses, "investments": investments,
        "remaining": total_income - total_expenses - investments,
    }


def outstanding_rent(until: date) -> dict:
    """Rent still unpaid for obligations due before `until`, split mine vs family-collected."""
    mine = family = ZERO
    for ob in RentObligation.query.filter(RentObligation.due_date < until,
                                          RentObligation.is_cancelled.is_(False)):
        if ob.property.rent_collected_by == "me":
            mine += ob.outstanding
        else:
            family += ob.outstanding
    return {"mine": mine, "family": family}


def upcoming_items(days: int) -> list[dict]:
    """Things due in the next `days` days (plus anything overdue), oldest first."""
    today = date.today()
    limit = today + timedelta(days=days)
    items = []

    for b in Bill.query.filter(Bill.due_date.is_not(None), Bill.due_date <= limit,
                               Bill.is_cancelled.is_(False)):
        if b.outstanding > 0:
            items.append({"date": b.due_date, "label": f"{b.name} ({b.property.name})",
                          "amount": b.outstanding, "type": "Bill",
                          "url": url_for("bills.edit_bill", bid=b.id)})
    for c in Commitment.query.filter(Commitment.status == "active", Commitment.next_due_date.is_not(None),
                                     Commitment.next_due_date <= limit):
        items.append({"date": c.next_due_date, "label": c.name, "amount": c.amount,
                      "type": c.kind_label, "url": url_for("personal.edit_commitment", cid=c.id)})
    for ob in RentObligation.query.filter(RentObligation.due_date <= limit,
                                          RentObligation.is_cancelled.is_(False)):
        if ob.outstanding > 0:
            who = "" if ob.property.rent_collected_by == "me" else f" – goes to {ob.property.collector_label}"
            items.append({"date": ob.due_date, "label": f"Rent {ob.property.name} ({ob.tenant.name}){who}",
                          "amount": ob.outstanding, "type": "Rent",
                          "url": url_for("rent.obligation", oid=ob.id)})
    items.sort(key=lambda i: i["date"])
    for i in items:
        i["overdue"] = i["date"] < today
    return items


def last_months(start: date, count: int = 6) -> list[dict]:
    return [month_figures(add_months(start, -n)) for n in range(count - 1, -1, -1)]


def dashboard_summary(start: date | None = None) -> dict:
    today = date.today()
    start = start or today.replace(day=1)
    end = add_months(start, 1)

    rows = (db.session.query(Property.occupancy_status, func.count(Property.id))
            .filter(Property.archived_at.is_(None)).group_by(Property.occupancy_status).all())
    counts = dict(rows)
    month = month_figures(start)
    owed = outstanding_rent(end)

    due_bills = ZERO
    for b in Bill.query.filter(Bill.is_cancelled.is_(False), Bill.due_date.is_not(None),
                               Bill.due_date < end):
        due_bills += b.outstanding
    due_commitments = _sum(
        db.session.query(func.coalesce(func.sum(Commitment.amount), 0))
        .filter(Commitment.status == "active", Commitment.next_due_date.is_not(None),
                Commitment.next_due_date < end, Commitment.kind.not_in(INVESTMENT_KINDS)))
    due_investments = _sum(
        db.session.query(func.coalesce(func.sum(Commitment.amount), 0))
        .filter(Commitment.status == "active", Commitment.next_due_date.is_not(None),
                Commitment.next_due_date < end, Commitment.kind.in_(INVESTMENT_KINDS)))
    still_to_pay = due_bills + due_commitments + due_investments

    history = last_months(start)
    return {
        "start": start, "today": today,
        "prev_month": add_months(start, -1).strftime("%Y-%m"),
        "next_month": add_months(start, 1).strftime("%Y-%m"),
        "active_properties": sum(counts.values()),
        "archived_properties": db.session.query(func.count(Property.id))
        .filter(Property.archived_at.is_not(None)).scalar(),
        "by_occupancy": [(label, counts.get(key, 0)) for key, label in OCCUPANCY_STATUSES],
        "month": month, "owed": owed,
        "due_bills": due_bills, "due_commitments": due_commitments, "due_investments": due_investments,
        "still_to_pay": still_to_pay,
        "left_after_dues": month["remaining"] - still_to_pay,
        "next7": upcoming_items(7), "next30": upcoming_items(30),
        "chart_months": [h["start"].strftime("%b %y") for h in history],
        "chart_income": [float(h["total_income"]) for h in history],
        "chart_expenses": [float(h["total_expenses"] + h["investments"]) for h in history],
        "chart_categories": {k: float(v) for k, v in month["categories"].items() if v},
        "chart_rent_expected": [float(h["rent_expected_mine"] + h["rent_expected_family"]) for h in history],
        "chart_rent_received": [float(h["rent_received_mine"] + h["rent_received_family"]) for h in history],
    }
