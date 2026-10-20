from datetime import date

import pytest

from app.services.dates import add_months, due_date_in_month, month_bounds, next_due_date, parse_month


def test_add_months_clamps_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 3, 31), -1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 30), 3) == date(2027, 2, 28)


def test_leap_year_february():
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)
    assert add_months(date(2027, 1, 31), 1) == date(2027, 2, 28)
    assert add_months(date(2028, 2, 29), 12) == date(2029, 2, 28)


def test_anchor_day_prevents_drift():
    d = date(2026, 1, 31)
    feb = next_due_date(d, "monthly", anchor_day=31)
    mar = next_due_date(feb, "monthly", anchor_day=31)
    assert (feb, mar) == (date(2026, 2, 28), date(2026, 3, 31))
    # without the anchor it would drift to the 28th
    assert next_due_date(feb, "monthly") == date(2026, 3, 28)


@pytest.mark.parametrize("freq,expected", [
    ("weekly", date(2026, 10, 19)), ("monthly", date(2026, 11, 12)), ("quarterly", date(2027, 1, 12)),
    ("half_yearly", date(2027, 4, 12)), ("yearly", date(2027, 10, 12)),
])
def test_next_due_by_frequency(freq, expected):
    assert next_due_date(date(2026, 10, 12), freq) == expected


def test_custom_and_one_time():
    assert next_due_date(date(2026, 10, 12), "custom", interval_days=45) == date(2026, 11, 26)
    assert next_due_date(date(2026, 10, 12), "one_time") is None


def test_year_rollover_and_bounds():
    assert add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)
    assert month_bounds(2026, 12) == (date(2026, 12, 1), date(2027, 1, 1))


def test_due_day_in_short_month():
    assert due_date_in_month(date(2026, 2, 1), 31) == date(2026, 2, 28)
    assert due_date_in_month(date(2028, 2, 1), 30) == date(2028, 2, 29)


def test_parse_month_falls_back_on_garbage():
    assert parse_month("2026-10") == date(2026, 10, 1)
    default = date(2026, 1, 1)
    assert parse_month("garbage", default) == default
    assert parse_month(None, default) == default
    assert parse_month("2026-13", default) == default
