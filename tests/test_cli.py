from app.extensions import db
from app.models import OwnerAccount, Property
from tests.conftest import PASSWORD


def test_owner_create_and_refuses_second(app):
    runner = app.test_cli_runner()
    r = runner.invoke(args=["owner-create", "--username", "me"], input=f"{PASSWORD}\n{PASSWORD}\n")
    assert r.exit_code == 0, r.output
    r = runner.invoke(args=["owner-create", "--username", "again"], input=f"{PASSWORD}\n{PASSWORD}\n")
    assert r.exit_code != 0 and "already exists" in r.output
    with app.app_context():
        assert OwnerAccount.query.count() == 1


def test_owner_create_rejects_weak_password(app):
    r = app.test_cli_runner().invoke(
        args=["owner-create", "--username", "me"], input="weak\nweak\n"
    )
    assert r.exit_code != 0
    with app.app_context():
        assert OwnerAccount.query.count() == 0


def test_reset_password_clears_lockout(app, owner):
    with app.app_context():
        o = OwnerAccount.get()
        o.register_failure()
        o.failed_attempts = 99
        db.session.commit()
    new = "Another-Passw0rd-42"
    r = app.test_cli_runner().invoke(args=["owner-reset-password"], input=f"{new}\n{new}\n")
    assert r.exit_code == 0, r.output
    with app.app_context():
        o = OwnerAccount.get()
        assert o.failed_attempts == 0 and o.check_password(new)


def test_seed_properties_command(app):
    runner = app.test_cli_runner()
    assert "Created 6" in runner.invoke(args=["seed-properties"]).output
    assert "already exist" in runner.invoke(args=["seed-properties"]).output
    with app.app_context():
        assert Property.query.count() == 6
