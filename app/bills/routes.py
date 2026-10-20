from datetime import date

from flask import abort, flash, redirect, render_template, request, url_for

from app.bills import bp
from app.extensions import db
from app.forms import BillForm, PaymentForm, apply_form
from app.models import Bill, BillPayment, Property, UtilityConnection
from app.models.bill import BILL_CATEGORIES, RESPONSIBLE


def _fill_choices(form: BillForm) -> None:
    props = Property.query.order_by(Property.sort_order, Property.id).all()
    form.property_id.choices = [(p.id, p.name + (" (archived)" if p.is_archived else "")) for p in props]
    conns = UtilityConnection.query.order_by(UtilityConnection.property_id, UtilityConnection.kind).all()
    form.connection_id.choices = [(None, "— none —")] + [(c.id, f"{c.property.name}: {c.display}") for c in conns]


@bp.get("/")
def list_bills():
    q = Bill.query.join(Property, Bill.property_id == Property.id)
    pid, cat, resp, status, text = (request.args.get(k, "") for k in ("property", "category", "responsible", "status", "q"))
    if pid.isdigit():
        q = q.filter(Bill.property_id == int(pid))
    if cat:
        q = q.filter(Bill.category == cat)
    if resp:
        q = q.filter(Bill.responsible == resp)
    if text:
        like = f"%{text}%"
        q = q.filter(db.or_(Bill.name.ilike(like), Bill.bill_number.ilike(like), Bill.provider.ilike(like)))
    bills = q.order_by(Bill.due_date.desc().nullslast(), Bill.id.desc()).all()
    if status:  # status is derived, so filter after loading (single user, small data)
        bills = [b for b in bills if b.status == status]
    totals = {
        "mine": sum((b.my_share for b in bills), 0),
        "paid": sum((b.paid for b in bills), 0),
        "outstanding": sum((b.outstanding for b in bills), 0),
    }
    return render_template("bills/list.html", bills=bills, totals=totals, categories=BILL_CATEGORIES,
                           responsible=RESPONSIBLE, properties=Property.query.order_by(Property.sort_order).all(),
                           args=request.args)


def _validate_connection(form: BillForm) -> bool:
    cid = form.connection_id.data
    if cid and (conn := db.session.get(UtilityConnection, cid)) and conn.property_id != form.property_id.data:
        form.connection_id.errors.append("That connection belongs to a different property.")
        return False
    return True


@bp.route("/new", methods=["GET", "POST"])
def new_bill():
    form = BillForm()
    _fill_choices(form)
    if request.method == "GET":
        if (pid := request.args.get("property_id", type=int)):
            form.property_id.data = pid
        form.category.data = request.args.get("category", "electricity")
    if form.validate_on_submit() and _validate_connection(form):
        bill = Bill()
        apply_form(form, bill)
        if bill.responsible != "shared":
            bill.owner_share = None
        db.session.add(bill)
        db.session.commit()
        flash("Bill added.", "success")
        return redirect(url_for("bills.edit_bill", bid=bill.id))
    return render_template("bills/form.html", form=form, title="Add bill", bill=None, pay_form=None)


@bp.route("/<int:bid>", methods=["GET", "POST"])
def edit_bill(bid):
    bill = db.session.get(Bill, bid) or abort(404)
    form = BillForm(obj=bill)
    _fill_choices(form)
    if form.validate_on_submit() and _validate_connection(form):
        apply_form(form, bill)
        if bill.responsible != "shared":
            bill.owner_share = None
        db.session.commit()
        flash("Bill updated.", "success")
        return redirect(url_for("bills.edit_bill", bid=bid))
    pay_form = PaymentForm(prefix="pay")
    if bill.outstanding:
        pay_form.amount.data = pay_form.amount.data or bill.outstanding
    return render_template("bills/form.html", form=form, title=bill.name, bill=bill, pay_form=pay_form)


@bp.post("/<int:bid>/pay")
def pay_bill(bid):
    bill = db.session.get(Bill, bid) or abort(404)
    form = PaymentForm(prefix="pay")
    err = None
    if not form.validate_on_submit():
        err = "; ".join(e for errs in form.errors.values() for e in errs)
    elif bill.is_cancelled:
        err = "This bill is cancelled."
    elif bill.my_share == 0:
        err = "This bill isn't yours to pay (tenant/other pays). Change “Who pays?” if that's wrong."
    elif form.amount.data > bill.outstanding:
        err = f"That is more than the outstanding balance (₹{bill.outstanding:,.2f})."
    elif any(p.amount == form.amount.data and p.paid_on == form.paid_on.data
             and (p.reference or "") == (form.reference.data or "").strip() for p in bill.payments):
        err = "An identical payment is already recorded - not adding it twice."
    if err:
        flash(err, "danger")
    else:
        pay = BillPayment(bill=bill)
        apply_form(form, pay, skip=("advance_due",))
        db.session.add(pay)
        db.session.commit()
        flash("Payment recorded.", "success")
    return redirect(url_for("bills.edit_bill", bid=bid))


@bp.post("/payments/<int:pid>/delete")
def delete_payment(pid):
    pay = db.session.get(BillPayment, pid) or abort(404)
    bid = pay.bill_id
    db.session.delete(pay)
    db.session.commit()
    flash("Payment removed.", "info")
    return redirect(url_for("bills.edit_bill", bid=bid))


@bp.post("/<int:bid>/delete")
def delete_bill(bid):
    bill = db.session.get(Bill, bid) or abort(404)
    if bill.payments:
        flash("This bill has payments recorded. Mark it cancelled instead, or delete the payments first.", "danger")
        return redirect(url_for("bills.edit_bill", bid=bid))
    db.session.delete(bill)
    db.session.commit()
    flash("Bill deleted.", "info")
    return redirect(url_for("bills.list_bills"))
