import click
from flask import Flask
from flask.cli import with_appcontext

from app.extensions import db
from app.models import FamilyMember, OwnerAccount
from app.models.property import seed_initial_properties
from app.security import validate_new_password


def register_cli(app: Flask) -> None:
    @app.cli.command("owner-create")
    @click.option("--username", prompt=True)
    @click.password_option()
    @with_appcontext
    def owner_create(username, password):
        """Create the single owner account (refuses if one already exists)."""
        if OwnerAccount.get() is not None:
            raise click.ClickException("An owner account already exists.")
        problems = validate_new_password(password)
        if problems:
            raise click.ClickException(" ".join(problems))
        owner = OwnerAccount(id=1, username=username.strip())
        owner.set_password(password)
        db.session.add(owner)
        db.session.commit()
        click.echo(f"Owner account '{owner.username}' created.")

    @app.cli.command("owner-reset-password")
    @click.password_option()
    @with_appcontext
    def owner_reset_password(password):
        """Reset the owner password from the server console (also clears lockout)."""
        owner = OwnerAccount.get()
        if owner is None:
            raise click.ClickException("No owner account exists; run owner-create.")
        problems = validate_new_password(password)
        if problems:
            raise click.ClickException(" ".join(problems))
        owner.set_password(password)
        owner.failed_attempts, owner.locked_until = 0, None
        db.session.commit()
        click.echo("Password reset; all existing sessions were invalidated.")

    @app.cli.command("seed-properties")
    @with_appcontext
    def seed_properties():
        """Create the six initial properties (only if no properties exist yet)."""
        n = seed_initial_properties()
        click.echo(f"Created {n} properties." if n else "Properties already exist; nothing done.")

    @app.cli.command("seed-members")
    @with_appcontext
    def seed_members():
        """Create the three editable family-member labels (only if none exist)."""
        if FamilyMember.query.first() is not None:
            click.echo("Family members already exist; nothing done.")
            return
        for n in ("Member 1", "Member 2", "Member 3"):
            db.session.add(FamilyMember(name=n))
        db.session.commit()
        click.echo("Created 3 family members.")
