from flask import Blueprint

bp = Blueprint("personal", __name__)

from app.personal import routes  # noqa: E402,F401
