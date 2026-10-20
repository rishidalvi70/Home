from flask import render_template, request

from app.main import bp
from app.services.dashboard import dashboard_summary
from app.services.dates import parse_month


@bp.get("/")
def dashboard():
    return render_template("dashboard.html", summary=dashboard_summary(parse_month(request.args.get("month"))))
