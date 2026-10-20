from flask import Blueprint

bp = Blueprint("rent", __name__)

from app.rent import routes  # noqa: E402,F401
