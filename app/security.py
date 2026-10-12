from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from flask import current_app

_default = PasswordHasher()  # Argon2id with library defaults
_fast = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)  # tests only


def _hasher() -> PasswordHasher:
    return _fast if current_app.config.get("FAST_HASH") else _default


def hash_password(password: str) -> str:
    return _hasher().hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _hasher().verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def burn_hash_time(password: str) -> None:
    """Spend comparable time when no owner exists, so timing doesn't reveal that."""
    try:
        _hasher().verify(_hasher().hash("placeholder"), password)
    except Exception:
        pass


def validate_new_password(password: str) -> list[str]:
    problems = []
    minimum = current_app.config["MIN_PASSWORD_LENGTH"]
    if len(password) < minimum:
        problems.append(f"Password must be at least {minimum} characters.")
    if password.lower() == password or password.upper() == password:
        problems.append("Use a mix of upper- and lower-case letters.")
    if not any(c.isdigit() for c in password):
        problems.append("Include at least one digit.")
    return problems
