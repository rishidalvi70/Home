from datetime import date

from flask import abort, flash, redirect, render_template, request, url_for

from app.extensions import db
from app.forms import PaymentForm, apply_form
from app.models import Property, RentObligation, RentPayment
from app.rent import bp
from app.services.dates import add_months, parse_month
from app.services.rent import create_obligations, preview_obligations


def _month_arg() -> date:
    return parse_month(request.values.get("month"))


@bp.get("/")
def ledger():
    start = _month_arg()
    rows = (RentObligation.query.join(Property, RentObligation.property_id == Property.id)
            .filter(RentObligation.period_start == start).order_by(Property.sort_order, Property.id).all())
    live = [o for o in rows if not o.is_cancelled]
    totals = {
        "expected": sum((o.expected_amount for o in live), 0),
        "received": sum((o.received for o in live), 0),
        "outstanding": sum((o.outstanding for o in live), 0),
    }
    return render_template("rent/ledger.html", rows=rows, start=start, totals=totals,
                           prev_month=add_months(start, -1), next_month=add_months(start, 1))


@bp.route("/generate", methods=["GET", "POST"])
def generate():
    start = _month_arg()
    if request.method == "POST":
        ids = {int(x) for x in request.form.getlist("tenant_id") if x.isdigit()}
        n = create_obligations(start, ids)
        flash(f"Created {n} rent record(s) for {start:%B %Y}. Nothing is marked as received.", "success")
        return redirect(url_for("rent.ledger", month=start.strftime("%Y-%m")))
    return render_template("rent/generate.html", rows=preview_obligations(start), start=start,
                           prev_month=add_months(start, -1), next_month=add_months(start, 1))


@bp.route("/<int:oid>", methods=["GET", "POST"])
def obligation(oid):
    ob = db.session.get(RentObligation, oid) or abort(404)
    form = PaymentForm()
    if request.method == "GET":
        form.amount.data = ob.outstanding or None
    if form.validate_on_submit():
        dup = any(p.amount == form.amount.data and p.paid_on == form.paid_on.data
                  and (p.reference or "") == (form.reference.data or "").strip() for p in ob.payments)
        if ob.is_cancelled:
            form.amount.errors.append("This rent record is cancelled.")
        elif form.amount.data > ob.outstanding:
            form.amount.errors.append(f"That is more than the outstanding balance (₹{ob.outstanding:,.2f}).")
        elif dup:
            form.amount.errors.append("An identical payment is already recorded - not adding it twice.")
        else:
            pay = RentPayment(obligation=ob)
            apply_form(form, pay, skip=("advance_due",))
            db.session.add(pay)
            db.session.commit()
            flash("Payment recorded.", "success")
            return redirect(url_for("rent.obligation", oid=oid))
    return render_template("rent/obligation.html", ob=ob, form=form)


@bp.post("/<int:oid>/cancel")
def toggle_cancel(oid):
    ob = db.session.get(RentObligation, oid) or abort(404)
    ob.is_cancelled = not ob.is_cancelled
    db.session.commit()
    flash("Rent record cancelled." if ob.is_cancelled else "Rent record reinstated.", "info")
    return redirect(url_for("rent.obligation", oid=oid))


@bp.post("/payments/<int:pid>/delete")
def delete_payment(pid):
    pay = db.session.get(RentPayment, pid) or abort(404)
    oid = pay.obligation_id
    db.session.delete(pay)
    db.session.commit()
    flash("Payment removed.", "info")
    return redirect(url_for("rent.obligation", oid=oid))
