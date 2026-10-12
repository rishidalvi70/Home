import re

from app.extensions import db
from app.models import Property
from app.models.property import seed_initial_properties


def _active_count(html):
    return int(re.search(r'data-testid="active-properties">\s*(\d+)', html).group(1))


def test_dashboard_counts_come_from_database(app, auth_client):
    with app.app_context():
        seed_initial_properties()
    html = auth_client.get("/").get_data(as_text=True)
    assert _active_count(html) == 6
    assert "Self-occupied" in html and "Under development" in html

    with app.app_context():
        db.session.add(Property(name="Room 7", occupancy_status="vacant"))
        Property.query.filter_by(name="Room 3").one().archive()
        db.session.commit()
    assert _active_count(auth_client.get("/").get_data(as_text=True)) == 6  # +1 -1


def test_dashboard_does_not_invent_financial_figures(app, auth_client):
    html = auth_client.get("/").get_data(as_text=True)
    assert "₹" not in html and "Not available yet" in html


def test_properties_page_lists_rooms_and_hides_archived(app, auth_client):
    with app.app_context():
        seed_initial_properties()
        Property.query.filter_by(name="Room 6").one().archive()
        db.session.commit()
    html = auth_client.get("/properties/").get_data(as_text=True)
    assert "Room 1" in html and "Room 6" not in html
    html = auth_client.get("/properties/?archived=1").get_data(as_text=True)
    assert "Room 6" in html and "Archived" in html


def test_mobile_friendly_shell(auth_client):
    html = auth_client.get("/").get_data(as_text=True)
    assert 'name="viewport" content="width=device-width, initial-scale=1"' in html
    assert "navbar-toggler" in html  # collapses on phones
