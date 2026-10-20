from datetime import timedelta

from flask import current_app
from flask_login import UserMixin

from app.extensions import db
from app.models.mixins import TimestampMixin, utcnow
from app.security import hash_password, verify_password


class OwnerAccount(UserMixin, TimestampMixin, db.Model):
    """The one and only account. The CHECK constraint makes a second row impossible."""

    __tablename__ = "owner_account"
    __table_args__ = (db.CheckConstraint("id = 1", name="ck_owner_account_singleton"),)

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    failed_attempts = db.Column(db.Integer, nullable=False, default=0)
    locked_until = db.Column(db.DateTime(timezone=True))
    last_login_at = db.Column(db.DateTime(timezone=True))
    # Changing the password rotates this value, invalidating all existing sessions.
    session_nonce = db.Column(db.Integer, nullable=False, default=1)

    def get_id(self) -> str:
        return f"{self.id}:{self.session_nonce}"

    def set_password(self, password: str) -> None:
        self.password_hash = hash_password(password)
        self.session_nonce = (self.session_nonce or 0) + 1

    def check_password(self, password: str) -> bool:
        return verify_password(self.password_hash, password)

    @property
    def is_locked(self) -> bool:
        return self.locked_until is not None and self.locked_until > utcnow()

    def register_failure(self) -> None:
        self.failed_attempts = (self.failed_attempts or 0) + 1
        if self.failed_attempts >= current_app.config["MAX_FAILED_LOGINS"]:
            self.locked_until = utcnow() + timedelta(
                minutes=current_app.config["LOCKOUT_MINUTES"]
            )
            self.failed_attempts = 0

    def register_success(self) -> None:
        self.failed_attempts = 0
        self.locked_until = None
        self.last_login_at = utcnow()

    @classmethod
    def get(cls):
        return db.session.get(cls, 1)
