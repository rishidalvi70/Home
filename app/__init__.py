import os

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_login import current_user

load_dotenv()

from app.config import CONFIGS  # noqa: E402  (after load_dotenv so env is populated)
from app.extensions import csrf, db, limiter, login_manager, migrate  # noqa: E402

PUBLIC_ENDPOINTS = {"auth.login", "healthz", "static"}


def create_app(config_name: str | None = None) -> Flask:
    config_name = config_name or os.environ.get("APP_ENV", "development")
    if config_name not in CONFIGS:
        raise RuntimeError(f"Unknown APP_ENV {config_name!r}")

    app = Flask(__name__)
    app.config.from_object(CONFIGS[config_name])
    _check_config(app, config_name)

    db.init_app(app)
    migrate.init_app(app, db)
    csrf.init_app(app)
    login_manager.init_app(app)
    limiter.init_app(app)

    from app import models  # noqa: F401  (register models for migrations)
    from app.auth import bp as auth_bp
    from app.cli import register_cli
    from app.main import bp as main_bp
    from app.properties import bp as properties_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    from app.bills import bp as bills_bp
    from app.filters import register as register_filters
    from app.personal import bp as personal_bp
    from app.rent import bp as rent_bp

    app.register_blueprint(properties_bp, url_prefix="/properties")
    app.register_blueprint(rent_bp, url_prefix="/rent")
    app.register_blueprint(bills_bp, url_prefix="/bills")
    app.register_blueprint(personal_bp, url_prefix="/personal")
    register_filters(app)
    register_cli(app)

    @app.get("/healthz")
    def healthz():
        return jsonify(status="ok")

    @app.before_request
    def require_owner_login():
        if request.endpoint in PUBLIC_ENDPOINTS or request.endpoint is None:
            return None
        if not current_user.is_authenticated:
            return redirect(url_for("auth.login", next=request.full_path.rstrip("?")))
        return None

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; object-src 'none'; "
            "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            resp.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        if request.endpoint != "static":
            resp.headers["Cache-Control"] = "no-store"
        return resp

    _register_error_handlers(app)
    return app


def _check_config(app: Flask, config_name: str) -> None:
    if not app.config.get("SQLALCHEMY_DATABASE_URI"):
        raise RuntimeError("DATABASE_URL is not set (see .env.example).")
    key = app.config.get("SECRET_KEY")
    if not key or (config_name == "production" and (key == "change-me" or len(key) < 32)):
        raise RuntimeError("SECRET_KEY must be set to a long random value (see .env.example).")


def _register_error_handlers(app: Flask) -> None:
    messages = {
        403: "You don't have access to that.",
        404: "That page doesn't exist.",
        429: "Too many requests. Please wait a moment and try again.",
        500: "Something went wrong on our side.",
    }

    def make(code):
        def handler(_err):
            return render_template("errors/error.html", code=code, message=messages[code]), code

        return handler

    for code in messages:
        app.register_error_handler(code, make(code))
