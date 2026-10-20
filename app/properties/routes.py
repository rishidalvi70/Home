from datetime import date

from flask import abort, flash, redirect, render_template, request, url_for

from app.extensions import db
from app.forms import ConnectionForm, PropertyForm, RevisionForm, TenantForm, apply_form
from app.models import (Bill, Property, RentObligation, RentRevision, Tenant, UtilityConnection)
from app.properties import bp
from app.services.rent import apply_revision, rent_for, suggested_new_rent
from app.services.reports import property_report


def _get(model, pk):
    obj = db.session.get(model, pk)
    if obj is None:
        abort(404)
    return obj


def _form_page(form, title, cancel_url, subtitle=None, submit_label=None):
    return render_template("form.html", form=form, title=title, subtitle=subtitle,
                           cancel_url=cancel_url, submit_label=submit_label)


@bp.get("/")
def list_properties():
    show_archived = request.args.get("archived") == "1"
    query = Property.query.order_by(Property.sort_order, Property.id)
    if not show_archived:
        query = query.filter(Property.archived_at.is_(None))
    return render_template("properties/list.html", properties=query.all(), show_archived=show_archived)


@bp.route("/new", methods=["GET", "POST"])
def new_property():
    form = PropertyForm(occupancy_status="vacant")
    if form.validate_on_submit():
        prop = Property(sort_order=(db.session.query(db.func.max(Property.sort_order)).scalar() or 0) + 1)
        apply_form(form, prop)
        db.session.add(prop)
        db.session.commit()
        flash(f"Added {prop.name}.", "success")
        return redirect(url_for("properties.detail", pid=prop.id))
    return _form_page(form, "Add property / room", url_for("properties.list_properties"))


@bp.get("/<int:pid>")
def detail(pid):
    prop = _get(Property, pid)
    today = date.today()
    first_of_month = today.replace(day=1)
    fy_start = date(today.year if today.month >= 4 else today.year - 1, 4, 1)
    period = request.args.get("period", "all")
    start = {"month": first_of_month, "fy": fy_start}.get(period)
    obligations = (RentObligation.query.filter_by(property_id=pid)
                   .order_by(RentObligation.period_start.desc()).limit(12).all())
    bills = Bill.query.filter_by(property_id=pid).order_by(Bill.due_date.desc().nullslast(), Bill.id.desc()).limit(15).all()
    return render_template("properties/detail.html", prop=prop, report=property_report(prop, start),
                           period=period, obligations=obligations, bills=bills, rent_for=rent_for,
                           suggested=suggested_new_rent, today=today)


@bp.route("/<int:pid>/edit", methods=["GET", "POST"])
def edit_property(pid):
    prop = _get(Property, pid)
    form = PropertyForm(obj=prop)
    if form.validate_on_submit():
        apply_form(form, prop)
        db.session.commit()
        flash("Property updated.", "success")
        return redirect(url_for("properties.detail", pid=pid))
    return _form_page(form, f"Edit {prop.name}", url_for("properties.detail", pid=pid))


@bp.post("/<int:pid>/archive")
def archive(pid):
    prop = _get(Property, pid)
    prop.archive()
    db.session.commit()
    flash(f"{prop.name} archived. Its history is kept.", "info")
    return redirect(url_for("properties.list_properties"))


@bp.post("/<int:pid>/restore")
def restore(pid):
    prop = _get(Property, pid)
    prop.restore()
    db.session.commit()
    flash(f"{prop.name} restored.", "success")
    return redirect(url_for("properties.detail", pid=pid))


@bp.post("/<int:pid>/delete")
def delete_property(pid):
    prop = _get(Property, pid)
    if prop.tenants or prop.connections or Bill.query.filter_by(property_id=pid).first() \
            or RentObligation.query.filter_by(property_id=pid).first():
        flash("This property has records, so it can't be deleted. Archive it instead - history is kept.", "danger")
        return redirect(url_for("properties.detail", pid=pid))
    db.session.delete(prop)
    db.session.commit()
    flash("Property deleted.", "info")
    return redirect(url_for("properties.list_properties"))


# ---- utility connections -------------------------------------------------------------------

@bp.route("/<int:pid>/connections/new", methods=["GET", "POST"])
def new_connection(pid):
    prop = _get(Property, pid)
    form = ConnectionForm()
    if form.validate_on_submit():
        conn = UtilityConnection(property=prop)
        apply_form(form, conn)
        db.session.add(conn)
        db.session.commit()
        flash("Connection added.", "success")
        return redirect(url_for("properties.detail", pid=pid))
    return _form_page(form, f"Add connection – {prop.name}", url_for("properties.detail", pid=pid),
                      "A room can have several electricity or gas connections.")


@bp.route("/connections/<int:cid>/edit", methods=["GET", "POST"])
def edit_connection(cid):
    conn = _get(UtilityConnection, cid)
    form = ConnectionForm(obj=conn)
    if form.validate_on_submit():
        apply_form(form, conn)
        db.session.commit()
        flash("Connection updated.", "success")
        return redirect(url_for("properties.detail", pid=conn.property_id))
    return _form_page(form, "Edit connection", url_for("properties.detail", pid=conn.property_id))


@bp.post("/connections/<int:cid>/delete")
def delete_connection(cid):
    conn = _get(UtilityConnection, cid)
    pid = conn.property_id
    if Bill.query.filter_by(connection_id=cid).first():
        conn.is_active = False
        flash("Bills use this connection, so it was marked inactive instead of deleted.", "warning")
    else:
        db.session.delete(conn)
        flash("Connection deleted.", "info")
    db.session.commit()
    return redirect(url_for("properties.detail", pid=pid))


# ---- tenants & rent increments --------------------------------------------------------------

@bp.route("/<int:pid>/tenants/new", methods=["GET", "POST"])
def new_tenant(pid):
    prop = _get(Property, pid)
    form = TenantForm()
    if form.validate_on_submit():
        tenant = Tenant(property=prop)
        apply_form(form, tenant)
        db.session.add(tenant)
        if prop.occupancy_status in ("vacant", "other") and tenant.is_active:
            prop.occupancy_status = "rented"
        db.session.commit()
        flash("Tenant added.", "success")
        return redirect(url_for("properties.detail", pid=pid))
    return _form_page(form, f"Add tenant – {prop.name}", url_for("properties.detail", pid=pid))


@bp.route("/tenants/<int:tid>/edit", methods=["GET", "POST"])
def edit_tenant(tid):
    tenant = _get(Tenant, tid)
    form = TenantForm(obj=tenant)
    if form.validate_on_submit():
        apply_form(form, tenant, skip=("monthly_rent",) if tenant.revisions else ())
        db.session.commit()
        flash("Tenant updated.", "success")
        return redirect(url_for("properties.detail", pid=tenant.property_id))
    subtitle = ("Rent has an increment history - change it with 'Record increment' so the history stays correct."
                if tenant.revisions else None)
    return _form_page(form, f"Edit tenant – {tenant.name}", url_for("properties.detail", pid=tenant.property_id), subtitle)


@bp.post("/tenants/<int:tid>/delete")
def delete_tenant(tid):
    tenant = _get(Tenant, tid)
    pid = tenant.property_id
    if tenant.obligations:
        tenant.is_active = False
        if not tenant.end_date:
            tenant.end_date = date.today()
        flash("This tenant has rent records, so they were marked as a former tenant instead of deleted.", "warning")
    else:
        db.session.delete(tenant)
        flash("Tenant deleted.", "info")
    db.session.commit()
    return redirect(url_for("properties.detail", pid=pid))


@bp.route("/tenants/<int:tid>/revisions/new", methods=["GET", "POST"])
def new_revision(tid):
    tenant = _get(Tenant, tid)
    form = RevisionForm()
    if request.method == "GET":
        sugg = suggested_new_rent(tenant)
        if sugg:
            form.new_rent.data = sugg
        if tenant.next_increment_date:
            form.effective_from.data = tenant.next_increment_date
    if form.validate_on_submit():
        apply_revision(tenant, form.effective_from.data, form.new_rent.data, (form.reason.data or "").strip() or None)
        if form.next_increment_date.data:
            tenant.next_increment_date = form.next_increment_date.data
        db.session.commit()
        flash("Rent increment recorded. Rent already generated for earlier months is unchanged.", "success")
        return redirect(url_for("properties.detail", pid=tenant.property_id))
    sub = f"Current rent ₹{tenant.monthly_rent:,.0f}"
    if tenant.increment_percent:
        sub += f" · planned increment {tenant.increment_percent}%"
    return _form_page(form, f"Record rent increment – {tenant.name}", url_for("properties.detail", pid=tenant.property_id), sub)


@bp.post("/revisions/<int:rid>/delete")
def delete_revision(rid):
    rev = _get(RentRevision, rid)
    tenant = rev.tenant
    db.session.delete(rev)
    db.session.flush()
    db.session.expire(tenant, ["revisions"])
    tenant.monthly_rent = rent_for(tenant, date.today()) if tenant.revisions else rev.old_rent
    db.session.commit()
    flash("Increment removed.", "info")
    return redirect(url_for("properties.detail", pid=tenant.property_id))
