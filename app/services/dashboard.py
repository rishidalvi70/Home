"""Dashboard figures. Everything is computed from database rows - nothing is hardcoded.

Phase 1 covers the property portfolio only. Income/expense sections are added with the
financial tables in Phase 2 and reported as unavailable until then.
"""
from sqlalchemy import func

from app.extensions import db
from app.models.property import OCCUPANCY_STATUSES, Property


def dashboard_summary() -> dict:
    rows = (
        db.session.query(Property.occupancy_status, func.count(Property.id))
        .filter(Property.archived_at.is_(None))
        .group_by(Property.occupancy_status)
        .all()
    )
    counts = dict(rows)
    return {
        "active_properties": sum(counts.values()),
        "archived_properties": db.session.query(func.count(Property.id))
        .filter(Property.archived_at.is_not(None))
        .scalar(),
        "by_occupancy": [(label, counts.get(key, 0)) for key, label in OCCUPANCY_STATUSES],
    }
