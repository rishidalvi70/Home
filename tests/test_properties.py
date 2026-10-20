import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Property
from app.models.property import seed_initial_properties


def test_seed_creates_six_provisional_properties(app):
    with app.app_context():
        assert seed_initial_properties() == 6
        rows = Property.query.order_by(Property.sort_order).all()
        assert [(p.name, p.occupancy_status) for p in rows] == [
            ("Room 1", "self_occupied"),
            ("Room 2", "rented"),
            ("Room 3", "rented"),
            ("Room 4", "rented"),
            ("Room 5", "rented"),
            ("Room 6", "under_development"),
        ]


def test_seed_is_idempotent_and_never_overrides_user_data(app):
    with app.app_context():
        seed_initial_properties()
        Property.query.filter_by(name="Room 1").one().name = "Home"
        db.session.commit()
        assert seed_initial_properties() == 0
        assert Property.query.count() == 6
        assert Property.query.filter_by(name="Home").count() == 1


def test_count_is_not_hardcoded_and_optional_fields_may_be_blank(app):
    with app.app_context():
        seed_initial_properties()
        db.session.add(Property(name="Room 7", occupancy_status="vacant"))
        db.session.commit()
        p = Property.query.filter_by(name="Room 7").one()
        assert p.mhada_room_no is None and p.ward_name is None and p.address is None
        assert Property.query.count() == 7


def test_invalid_occupancy_rejected_by_database(app):
    with app.app_context():
        db.session.add(Property(name="Bad", occupancy_status="haunted"))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_archive_and_restore_preserve_record(app):
    with app.app_context():
        seed_initial_properties()
        p = Property.query.filter_by(name="Room 2").one()
        p.archive()
        db.session.commit()
        assert Property.query.count() == 6  # still present
        assert Property.query.filter_by(name="Room 2").one().is_archived
        p.restore()
        db.session.commit()
        assert not Property.query.filter_by(name="Room 2").one().is_archived
