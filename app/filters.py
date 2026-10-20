from datetime import date
from decimal import Decimal

from markupsafe import Markup, escape


def inr(value, decimals: int = 0) -> str:
    """₹ with Indian digit grouping: 1234567.5 -> ₹12,34,568"""
    if value is None:
        return "—"
    value = Decimal(value)
    neg = value < 0
    q = f"{abs(value):.{decimals}f}"
    whole, _, frac = q.partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{'-' if neg else ''}₹{whole}" + (f".{frac}" if frac else "")


STATUS_STYLES = {
    "paid": ("success", "Paid"), "partial": ("warning", "Partly paid"), "unpaid": ("secondary", "Unpaid"),
    "upcoming": ("primary", "Upcoming"), "overdue": ("danger", "Overdue"), "due_today": ("warning", "Due today"),
    "cancelled": ("dark", "Cancelled"), "not_mine": ("info", "Not mine to pay"), "active": ("success", "Active"),
    "paused": ("secondary", "Paused"), "closed": ("dark", "Closed"),
}


def status_badge(status: str) -> Markup:
    style, label = STATUS_STYLES.get(status, ("secondary", status.replace("_", " ").title()))
    return Markup(f'<span class="badge badge-soft text-bg-{style}">{escape(label)}</span>')


def date_fmt(value: date | None) -> str:
    return value.strftime("%d %b %Y") if value else "—"


def register(app) -> None:
    app.jinja_env.filters.update(inr=inr, status_badge=status_badge, date_fmt=date_fmt)
