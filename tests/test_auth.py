import re

import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import OwnerAccount
from tests.conftest import PASSWORD, csrf_token, login

PROTECTED = ["/", "/properties/", "/account/password"]


@pytest.mark.parametrize("path", PROTECTED)
def test_pages_require_login(client, owner, path):
    r = client.get(path)
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_healthz_and_login_are_public(client):
    assert client.get("/healthz").status_code == 200
    assert client.get("/login").status_code == 200


@pytest.mark.parametrize("path", ["/register", "/signup", "/auth/register", "/users"])
def test_no_public_registration(client, path):
    assert client.get(path).status_code in (302, 404)
    assert client.post(path).status_code in (302, 400, 404)
    r = client.get(path, follow_redirects=True)
    assert "Create account" not in r.get_data(as_text=True)


def test_login_success_and_dashboard(client, owner):
    r = login(client)
    assert r.status_code == 302
    assert client.get("/").status_code == 200


def test_login_failure_is_generic(client, owner):
    wrong_pw = login(client, password="nope-nope-nope")
    wrong_user = login(client, username="someone")
    for r in (wrong_pw, wrong_user):
        assert r.status_code == 401
        assert "Invalid username or password." in r.get_data(as_text=True)


def test_login_without_owner_account_fails_cleanly(client):
    r = login(client)
    assert r.status_code == 401


def test_login_requires_csrf(client, owner):
    r = client.post("/login", data={"username": "owner", "password": PASSWORD})
    assert r.status_code == 400


def test_lockout_after_repeated_failures(app, client, owner):
    for _ in range(app.config["MAX_FAILED_LOGINS"]):
        assert login(client, password="wrong-wrong-1A").status_code == 401
    r = login(client)  # correct password, but account is locked
    assert r.status_code == 401
    assert "Too many failed attempts" in r.get_data(as_text=True)
    with app.app_context():
        assert OwnerAccount.get().is_locked


def test_successful_login_resets_failure_counter(app, client, owner):
    login(client, password="wrong-wrong-1A")
    login(client)
    with app.app_context():
        assert OwnerAccount.get().failed_attempts == 0


def test_open_redirect_blocked(client, owner):
    token = csrf_token(client)
    r = client.post(
        "/login?next=https://evil.example/",
        data={"username": "owner", "password": PASSWORD, "csrf_token": token},
    )
    assert r.headers["Location"].endswith("/")
    assert "evil.example" not in r.headers["Location"]


def test_next_redirect_to_local_page_allowed(client, owner):
    token = csrf_token(client)
    r = client.post(
        "/login?next=/properties/",
        data={"username": "owner", "password": PASSWORD, "csrf_token": token},
    )
    assert r.headers["Location"].endswith("/properties/")


def test_logout_is_post_only_and_ends_session(auth_client):
    assert auth_client.get("/logout").status_code == 405
    token = csrf_token(auth_client, "/")
    assert auth_client.post("/logout", data={"csrf_token": token}).status_code == 302
    assert auth_client.get("/").status_code == 302


def test_logout_requires_csrf(auth_client):
    assert auth_client.post("/logout").status_code == 400
    assert auth_client.get("/").status_code == 200  # still signed in


def _change(client, current, new, confirm=None):
    token = csrf_token(client, "/account/password")
    return client.post(
        "/account/password",
        data={
            "current_password": current,
            "new_password": new,
            "confirm_password": confirm if confirm is not None else new,
            "csrf_token": token,
        },
    )


def test_change_password_success_invalidates_other_sessions(app, auth_client):
    other = app.test_client()
    assert login(other).status_code == 302
    assert other.get("/").status_code == 200

    new_pw = "Brand-New-Passw0rd!"
    assert _change(auth_client, PASSWORD, new_pw).status_code == 302
    assert auth_client.get("/").status_code == 200  # current browser stays signed in
    assert other.get("/").status_code == 302  # other session logged out

    fresh = app.test_client()
    assert login(fresh, password=PASSWORD).status_code == 401
    assert login(fresh, password=new_pw).status_code == 302


@pytest.mark.parametrize(
    "current,new,confirm",
    [
        ("wrong-current-1A", "Brand-New-Passw0rd!", None),
        (PASSWORD, "Brand-New-Passw0rd!", "Different-Passw0rd!"),
        (PASSWORD, "Short1A", None),
        (PASSWORD, "alllowercase12345", None),
        (PASSWORD, "NoDigitsInHereAtAll", None),
        (PASSWORD, PASSWORD, None),
    ],
)
def test_change_password_rejections(app, auth_client, current, new, confirm):
    assert _change(auth_client, current, new, confirm).status_code == 400
    fresh = app.test_client()
    assert login(fresh, password=PASSWORD).status_code == 302  # unchanged


def test_only_one_owner_row_possible(app, owner):
    with app.app_context():
        second = OwnerAccount(id=2, username="intruder", password_hash="x")
        db.session.add(second)
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_password_is_hashed_with_argon2(app, owner):
    with app.app_context():
        h = OwnerAccount.get().password_hash
        assert h.startswith("$argon2id$") and PASSWORD not in h


def test_security_headers(auth_client):
    r = auth_client.get("/")
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"
    assert not re.search(r"<script(?![^>]*\bsrc=)", r.get_data(as_text=True)), "no inline scripts"


def test_session_cookie_flags_in_production_config(monkeypatch):
    from app.config import ProductionConfig

    assert ProductionConfig.SESSION_COOKIE_SECURE is True
    assert ProductionConfig.SESSION_COOKIE_HTTPONLY is True
    assert ProductionConfig.SESSION_COOKIE_SAMESITE == "Lax"


def test_production_refuses_weak_secret(monkeypatch):
    from app import create_app

    monkeypatch.setenv("DATABASE_URL", "postgresql://x:y@localhost/z")
    monkeypatch.setattr("app.config.Config.SECRET_KEY", "change-me")
    with pytest.raises(RuntimeError):
        create_app("production")


def test_login_rate_limit_returns_429(app, owner, monkeypatch):
    from app import create_app
    from app.config import TestingConfig
    from app.extensions import limiter

    monkeypatch.setattr(TestingConfig, "RATELIMIT_ENABLED", True)
    limited_app = create_app("testing")  # limiter reads its enabled flag at init time
    try:
        client = limited_app.test_client()
        codes = [login(client, password="wrong-wrong-1A").status_code for _ in range(12)]
    finally:
        limiter.enabled = False
        limiter.reset()
    assert codes[0] == 401 and 429 in codes
