from flask import render_template

from app.main import bp
from app.services.dashboard import dashboard_summary


@bp.get("/")
def dashboard():
    return render_template("dashboard.html", summary=dashboard_summary())
