import os
import re

import pytest
from flask_migrate import upgrade

from app import create_app
from app.extensions import db
from app.models import OwnerAccount

PASSWORD = "Correct-Horse-9battery"


@pytest.fixture(scope="session")
def app():
    if not os.environ.get("TEST_DATABASE_URL"):
        pytest.skip("Set TEST_DATABASE_URL to a dedicated PostgreSQL database (see .env.example).")
    app = create_app("testing")
    with app.app_context():
        # Build the schema from the real migrations so they are exercised too.
        db.drop_all()
        db.session.execute(db.text("DROP TABLE IF EXISTS alembic_version"))
        db.session.commit()
        upgrade(directory="migrations")
    return app


@pytest.fixture(autouse=True)
def clean_db(app):
    yield
    with app.app_context():
        db.session.remove()
        names = ", ".join(t.name for t in db.metadata.sorted_tables)
        db.session.execute(db.text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        db.session.commit()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def owner(app):
    with app.app_context():
        o = OwnerAccount(id=1, username="owner")
        o.set_password(PASSWORD)
        db.session.add(o)
        db.session.commit()


def csrf_token(client, path="/login"):
    html = client.get(path).get_data(as_text=True)
    return re.search(r'name="csrf_token"[^>]*value="([^"]+)"', html).group(1)


def login(client, username="owner", password=PASSWORD, **kw):
    token = csrf_token(client)
    return client.post(
        "/login",
        data={"username": username, "password": password, "csrf_token": token},
        **kw,
    )


@pytest.fixture
def auth_client(client, owner):
    assert login(client).status_code == 302
    return client


def page_token(client, path="/"):
    import re as _re

    html = client.get(path).get_data(as_text=True)
    return _re.search(r'name="csrf_token"[^>]*value="([^"]+)"', html).group(1)


def post(client, url, data=None, token_from="/", **kw):
    data = dict(data or {})
    data["csrf_token"] = page_token(client, token_from)
    return client.post(url, data=data, **kw)


@pytest.fixture
def seeded(app):
    """Six properties like a fresh install."""
    from app.models.property import seed_initial_properties

    with app.app_context():
        seed_initial_properties()
