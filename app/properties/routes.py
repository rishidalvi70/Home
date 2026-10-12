from flask import render_template, request

from app.models.property import Property
from app.properties import bp


@bp.get("/")
def list_properties():
    show_archived = request.args.get("archived") == "1"
    query = Property.query.order_by(Property.sort_order, Property.id)
    if not show_archived:
        query = query.filter(Property.archived_at.is_(None))
    return render_template(
        "properties/list.html", properties=query.all(), show_archived=show_archived
    )
