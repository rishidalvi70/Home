import os
from datetime import timedelta


def _database_url(raw: str | None) -> str | None:
    if not raw:
        return raw
    if raw.startswith("postgres://"):  # legacy scheme used by some hosts
        raw = "postgresql://" + raw[len("postgres://"):]
    if raw.startswith("postgresql://"):  # pin the installed driver (psycopg2)
        raw = "postgresql+psycopg2://" + raw[len("postgresql://"):]
    return raw


class Config:
    SQLALCHEMY_DATABASE_URI = _database_url(os.environ.get("DATABASE_URL"))
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.environ.get("SECRET_KEY")

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "1") == "1"
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    WTF_CSRF_TIME_LIMIT = 8 * 3600
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_ENABLED = True
    LOGIN_RATE_LIMIT = "10 per minute"

    # Account lockout (database-backed, so it holds across workers)
    MAX_FAILED_LOGINS = 5
    LOCKOUT_MINUTES = 15
    MIN_PASSWORD_LENGTH = 12


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True  # production is HTTPS-only


class TestingConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret-key"
    SQLALCHEMY_DATABASE_URI = _database_url(os.environ.get("TEST_DATABASE_URL"))
    SESSION_COOKIE_SECURE = False
    WTF_CSRF_ENABLED = True
    RATELIMIT_ENABLED = False
    # Cheap hashing parameters keep the suite fast; production uses argon2 defaults.
    FAST_HASH = True


CONFIGS = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
