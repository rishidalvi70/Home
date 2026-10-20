from collections import defaultdict
from datetime import date
from decimal import Decimal

from flask import abort, flash, redirect, render_template, request, url_for
from markupsafe import Markup, escape

from app.extensions import db
from app.filters import date_fmt, inr
from app.forms import (CommitmentForm, ExpenseForm, IncomeForm, InvestmentForm, MemberForm, PaymentForm,
                       apply_form)
from app.models import (Commitment, CommitmentPayment, FamilyMember, IncomeEntry, Investment,
                        PersonalExpense)
from app.models.personal import (FREQUENCY_LABELS, INCOME_LABELS, INVESTMENT_KINDS, KIND_ICONS,
                                 KIND_LABELS, KINDS)
from app.personal import bp
from app.services.commitments import monthly_cost, record_payment, set_anchor
from app.services.dashboard import month_figures
from app.services.dates import add_months, parse_month

ZERO = Decimal("0.00")


def _get(model, pk):
    return db.session.get(model, pk) or abort(404)


# ---- overview ---------------------------------------------------------------------------------

@bp.get("/")
def overview():
    start = parse_month(request.args.get("month"))
    figs = month_figures(start)
    active = Commitment.query.filter_by(status="active").all()
    by_kind = defaultdict(lambda: {"count": 0, "monthly": ZERO})
    for c in active:
        by_kind[c.kind]["count"] += 1
        by_kind[c.kind]["monthly"] += monthly_cost(c)
    emi_left = sum((c.remaining_amount or ZERO for c in active if c.kind == "emi"), ZERO)
    holdings = Investment.query.filter_by(is_active=True).all()
    return render_template(
        "personal/overview.html", figs=figs, start=start, prev_month=add_months(start, -1),
        next_month=add_months(start, 1), by_kind=by_kind, kinds=KINDS, icons=KIND_ICONS,
        emi_left=emi_left,
        invested=sum((h.invested_amount for h in holdings), ZERO),
        value=sum((h.current_value if h.current_value is not None else h.invested_amount for h in holdings), ZERO),
    )


# ---- commitments (mobile, subscriptions, EMI, LIC, SIP, other) -----------------------------------

HIDE_BY_KIND = {
    "mobile": ["total_amount", "total_installments", "installments_done", "auto_renew"],
    "subscription": ["total_amount", "total_installments", "installments_done", "plan_type",
                     "validity_days", "expiry_date"],
    "emi": ["member_id", "auto_renew", "plan_type", "validity_days", "expiry_date"],
    "insurance": ["total_installments", "installments_done", "plan_type", "validity_days",
                  "expiry_date", "auto_renew", "member_id"],
    "sip": ["total_installments", "installments_done", "plan_type", "validity_days", "expiry_date",
            "auto_renew", "member_id"],
    "other": ["total_amount", "total_installments", "installments_done", "plan_type", "validity_days",
              "expiry_date"],
}
LABELS_BY_KIND = {
    "mobile": {"reference": "Mobile number (last digits are enough)", "provider": "Operator (Jio, Airtel, Vi…)",
               "name": "Plan name / label"},
    "emi": {"total_amount": "Loan amount (₹)", "reference": "Loan account (partial)", "provider": "Bank / lender",
            "amount": "EMI amount (₹)"},
    "insurance": {"total_amount": "Sum assured (₹)", "reference": "Policy number (partial)",
                  "amount": "Premium (₹)", "end_date": "Maturity date", "provider": "Insurer (LIC…)"},
    "sip": {"provider": "Fund house / platform", "name": "Fund name", "amount": "SIP amount (₹)"},
    "subscription": {"provider": "Service provider", "name": "Service name"},
}


def _commitment_form(kind: str, obj=None) -> CommitmentForm:
    form = CommitmentForm(obj=obj)
    members = FamilyMember.query.filter_by(is_active=True).order_by(FamilyMember.id).all()
    form.member_id.choices = [(None, "— none / me —")] + [(m.id, m.name) for m in members]
    for name in HIDE_BY_KIND.get(kind, []):
        delattr(form, name)
    for name, label in LABELS_BY_KIND.get(kind, {}).items():
        if name in form:
            form[name].label.text = label
    return form


def _kind_arg() -> str:
    kind = request.args.get("kind", "")
    return kind if kind in KIND_LABELS else ""


@bp.get("/commitments")
def list_commitments():
    kind = _kind_arg()
    status = request.args.get("status", "active")
    member = request.args.get("member", type=int)
    q = Commitment.query
    if kind:
        q = q.filter_by(kind=kind)
    if status != "all":
        q = q.filter_by(status=status)
    if member:
        q = q.filter_by(member_id=member)
    items = q.order_by(Commitment.next_due_date.nulls_last(), Commitment.name).all()
    live = [c for c in items if c.status == "active"]
    per_member = defaultdict(lambda: ZERO)
    for c in live:
        per_member[c.member.name if c.member else "Me / unassigned"] += monthly_cost(c)
    monthly = sum((monthly_cost(c) for c in live), ZERO)
    return render_template(
        "personal/commitments.html", items=items, kind=kind, status=status, member=member,
        title=KIND_LABELS.get(kind, "All recurring payments"), icon=KIND_ICONS.get(kind, "arrow-repeat"),
        monthly=monthly, annual=monthly * 12, per_member=dict(per_member),
        members=FamilyMember.query.order_by(FamilyMember.id).all(), freq=FREQUENCY_LABELS,
        emi_left=sum((c.remaining_amount or ZERO for c in live if c.kind == "emi"), ZERO),
        monthly_cost=monthly_cost, is_investment=kind in INVESTMENT_KINDS)


@bp.route("/commitments/new", methods=["GET", "POST"])
def new_commitment():
    kind = (request.form.get("kind") if request.method == "POST" else _kind_arg()) or "other"
    if kind not in KIND_LABELS:
        kind = "other"
    form = _commitment_form(kind)
    if request.method == "GET":
        form.kind.data = kind
        if kind == "mobile" and "plan_type" in form:
            form.plan_type.data = "prepaid"
    if form.validate_on_submit():
        c = Commitment()
        apply_form(form, c)
        if c.kind == "mobile" and c.plan_type == "prepaid" and c.expiry_date and not c.next_due_date:
            c.next_due_date = c.expiry_date
        set_anchor(c)
        db.session.add(c)
        db.session.commit()
        flash(f"{c.kind_label} added.", "success")
        return redirect(url_for("personal.edit_commitment", cid=c.id))
    return render_template("personal/commitment_form.html", form=form, c=None, kind=kind,
                           title=f"Add – {KIND_LABELS.get(kind, 'recurring payment')}", pay_form=None)


@bp.route("/commitments/<int:cid>", methods=["GET", "POST"])
def edit_commitment(cid):
    c = _get(Commitment, cid)
    kind = request.form.get("kind") or c.kind
    form = _commitment_form(kind if kind in KIND_LABELS else c.kind, obj=c)
    if form.validate_on_submit():
        old_due = c.next_due_date
        apply_form(form, c)
        if c.next_due_date != old_due and c.next_due_date:
            c.due_day = c.next_due_date.day  # a hand-corrected date becomes the new anchor
        set_anchor(c)
        db.session.commit()
        flash("Saved.", "success")
        return redirect(url_for("personal.edit_commitment", cid=cid))
    pay_form = PaymentForm(prefix="pay")
    if request.method == "GET":
        pay_form.amount.data = c.amount
    return render_template("personal/commitment_form.html", form=form, c=c, kind=c.kind,
                           title=c.name, pay_form=pay_form, freq=FREQUENCY_LABELS)


@bp.post("/commitments/<int:cid>/pay")
def pay_commitment(cid):
    c = _get(Commitment, cid)
    form = PaymentForm(prefix="pay")
    if not form.validate_on_submit():
        flash("; ".join(e for errs in form.errors.values() for e in errs), "danger")
    elif any(p.amount == form.amount.data and p.paid_on == form.paid_on.data
             and (p.reference or "") == (form.reference.data or "").strip() for p in c.payments):
        flash("An identical payment is already recorded - not adding it twice.", "danger")
    else:
        record_payment(c, form.amount.data, form.paid_on.data, method=(form.method.data or None),
                       reference=(form.reference.data or "").strip() or None,
                       notes=(form.notes.data or "").strip() or None, advance_due=form.advance_due.data)
        db.session.commit()
        flash("Payment recorded." + (f" Next due {date_fmt(c.next_due_date)}." if c.next_due_date else ""), "success")
    return redirect(url_for("personal.edit_commitment", cid=cid))


@bp.post("/commitment-payments/<int:pid>/delete")
def delete_commitment_payment(pid):
    pay = _get(CommitmentPayment, pid)
    cid = pay.commitment_id
    db.session.delete(pay)
    db.session.commit()
    flash("Payment removed. Check the next due date is still right.", "info")
    return redirect(url_for("personal.edit_commitment", cid=cid))


@bp.post("/commitments/<int:cid>/delete")
def delete_commitment(cid):
    c = _get(Commitment, cid)
    kind = c.kind
    if c.payments:
        c.status = "cancelled"
        flash("It has payment history, so it was marked cancelled instead of deleted.", "warning")
    else:
        db.session.delete(c)
        flash("Deleted.", "info")
    db.session.commit()
    return redirect(url_for("personal.list_commitments", kind=kind))


# ---- simple lists: income, expenses, investments, members ----------------------------------------

def _simple_crud(slug, model, form_cls, title, singular, columns, order, after_fill=None, month_field=None):
    """Register list/new/edit/delete routes for a plain table."""

    def list_view():
        q = model.query
        start = None
        if month_field:
            start = parse_month(request.args.get("month"))
            col = getattr(model, month_field)
            q = q.filter(col >= start, col < add_months(start, 1))
        rows = q.order_by(*order()).all()
        return render_template("personal/simple_list.html", rows=rows, slug=slug, title=title,
                               singular=singular, columns=columns, start=start,
                               prev_month=add_months(start, -1) if start else None,
                               next_month=add_months(start, 1) if start else None,
                               total=sum((getattr(r, "amount", ZERO) for r in rows), ZERO) if month_field else None)

    def new_view():
        form = form_cls()
        if form.validate_on_submit():
            obj = model()
            apply_form(form, obj)
            db.session.add(obj)
            db.session.commit()
            flash(f"{singular} added.", "success")
            return redirect(url_for(f"personal.list_{slug}"))
        return render_template("form.html", form=form, title=f"Add {singular.lower()}",
                               cancel_url=url_for(f"personal.list_{slug}"), subtitle=None, submit_label="Save")

    def edit_view(oid):
        obj = _get(model, oid)
        form = form_cls(obj=obj)
        if form.validate_on_submit():
            apply_form(form, obj)
            db.session.commit()
            flash("Saved.", "success")
            return redirect(url_for(f"personal.list_{slug}"))
        return render_template("form.html", form=form, title=f"Edit {singular.lower()}",
                               cancel_url=url_for(f"personal.list_{slug}"), subtitle=None, submit_label="Save")

    def delete_view(oid):
        obj = _get(model, oid)
        if model is FamilyMember and Commitment.query.filter_by(member_id=oid).first():
            obj.is_active = False
            flash("Plans are linked to this member, so they were marked inactive instead.", "warning")
        else:
            db.session.delete(obj)
            flash("Deleted.", "info")
        db.session.commit()
        return redirect(url_for(f"personal.list_{slug}"))

    bp.add_url_rule(f"/{slug}", f"list_{slug}", list_view)
    bp.add_url_rule(f"/{slug}/new", f"new_{slug}", new_view, methods=["GET", "POST"])
    bp.add_url_rule(f"/{slug}/<int:oid>", f"edit_{slug}", edit_view, methods=["GET", "POST"])
    bp.add_url_rule(f"/{slug}/<int:oid>/delete", f"delete_{slug}", delete_view, methods=["POST"])


def _gain_cell(inv):
    if inv.gain is None:
        return "—"
    cls = "money-pos" if inv.gain >= 0 else "money-neg"
    pct = f" ({inv.gain / inv.invested_amount * 100:.1f}%)" if inv.invested_amount else ""
    return Markup(f'<span class="{cls}">{escape(inr(inv.gain))}{escape(pct)}</span>')


_simple_crud(
    "income", IncomeEntry, IncomeForm, "Salary & income", "Income",
    [("Date", lambda r: date_fmt(r.received_on)), ("Type", lambda r: INCOME_LABELS.get(r.kind, r.kind)),
     ("Source", lambda r: r.source or "—"), ("Amount", lambda r: inr(r.amount, 2))],
    lambda: (IncomeEntry.received_on.desc(), IncomeEntry.id.desc()), month_field="received_on")
_simple_crud(
    "expenses", PersonalExpense, ExpenseForm, "Everyday expenses", "Expense",
    [("Date", lambda r: date_fmt(r.spent_on)), ("Category", lambda r: r.category),
     ("Description", lambda r: r.description or "—"), ("Method", lambda r: r.method or "—"),
     ("Amount", lambda r: inr(r.amount, 2))],
    lambda: (PersonalExpense.spent_on.desc(), PersonalExpense.id.desc()), month_field="spent_on")
_simple_crud(
    "investments", Investment, InvestmentForm, "Investments", "Investment",
    [("Name", lambda r: r.name), ("Type", lambda r: r.kind_label), ("Platform", lambda r: r.platform or "—"),
     ("Invested", lambda r: inr(r.invested_amount)), ("Current value", lambda r: inr(r.current_value)),
     ("Gain / loss", _gain_cell), ("Held", lambda r: "Yes" if r.is_active else "Sold")],
    lambda: (Investment.is_active.desc(), Investment.name))
_simple_crud(
    "members", FamilyMember, MemberForm, "Family members", "Family member",
    [("Name", lambda r: r.name), ("Active", lambda r: "Yes" if r.is_active else "No")],
    lambda: (FamilyMember.id,))
