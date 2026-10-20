from calendar import monthrange
from datetime import date, timedelta

MONTHS_PER_FREQUENCY = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}


def add_months(d: date, months: int, anchor_day: int | None = None) -> date:
    """Add calendar months, clamping to month-end (31 Jan + 1 month = 28/29 Feb).

    `anchor_day` keeps a bill that is really due "on the 31st" from drifting to the 28th forever.
    """
    index = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(index, 12)
    month = month0 + 1
    day = min(anchor_day or d.day, monthrange(year, month)[1])
    return date(year, month, day)


def next_due_date(current: date, frequency: str, interval_days: int | None = None,
                  anchor_day: int | None = None) -> date | None:
    """The due date after `current`, or None for one-time items."""
    if frequency == "one_time":
        return None
    if frequency == "weekly":
        return current + timedelta(days=7)
    if frequency == "custom":
        return current + timedelta(days=max(interval_days or 1, 1))
    return add_months(current, MONTHS_PER_FREQUENCY[frequency], anchor_day)


def month_bounds(year: int, month: int) -> tuple[date, date]:
    """(first day, first day of next month) - a half-open range."""
    return date(year, month, 1), add_months(date(year, month, 1), 1)


def parse_month(value: str | None, default: date | None = None) -> date:
    """'2026-10' -> date(2026, 10, 1); falls back to this month on bad input."""
    default = default or date.today().replace(day=1)
    try:
        y, m = value.split("-")
        return date(int(y), int(m), 1)
    except (AttributeError, ValueError):
        return default


def due_date_in_month(period_start: date, due_day: int) -> date:
    return date(period_start.year, period_start.month,
                min(due_day, monthrange(period_start.year, period_start.month)[1]))


def financial_year_start(d: date) -> date:
    """Indian financial year starts 1 April."""
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)
