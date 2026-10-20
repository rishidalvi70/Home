from flask import Blueprint

bp = Blueprint("bills", __name__)

from app.bills import routes  # noqa: E402,F401
