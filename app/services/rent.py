from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models import RentObligation, Tenant
from app.models.tenant import ZERO
from app.services.dates import add_months, due_date_in_month


def rent_for(tenant: Tenant, on: date) -> Decimal:
    """Rent in force on a date, using the increment history.

    Revisions are (effective_from, old -> new). Before the first revision the old rent applied.
    """
    revisions = sorted(tenant.revisions, key=lambda r: r.effective_from)
    if not revisions:
        return tenant.monthly_rent
    applicable = [r for r in revisions if r.effective_from <= on]
    if applicable:
        return applicable[-1].new_rent
    return revisions[0].old_rent


def apply_revision(tenant: Tenant, effective_from: date, new_rent: Decimal, reason: str | None):
    """Record an increment and keep the tenant's *current* rent in step."""
    from app.models import RentRevision

    old = rent_for(tenant, effective_from)
    rev = RentRevision(tenant=tenant, effective_from=effective_from, old_rent=old,
                       new_rent=new_rent, reason=reason)
    db.session.add(rev)
    db.session.flush()
    tenant.monthly_rent = rent_for(tenant, date.today())
    return rev


def tenancy_covers(tenant: Tenant, period_start: date) -> bool:
    period_end = add_months(period_start, 1)
    if tenant.start_date and tenant.start_date >= period_end:
        return False
    if tenant.end_date and tenant.end_date < period_start:
        return False
    return True


def preview_obligations(period_start: date) -> list[dict]:
    """What would be generated for a month. Nothing is saved; existing ones are flagged."""
    rows = []
    tenants = Tenant.query.filter_by(is_active=True).order_by(Tenant.property_id).all()
    for t in tenants:
        if t.property.is_archived or not tenancy_covers(t, period_start):
            continue
        exists = RentObligation.query.filter_by(tenant_id=t.id, period_start=period_start).first()
        rows.append({
            "tenant": t,
            "amount": rent_for(t, period_start),
            "due_date": due_date_in_month(period_start, t.rent_due_day),
            "exists": exists is not None,
        })
    return rows


def create_obligations(period_start: date, tenant_ids: set[int]) -> int:
    """Create missing obligations for chosen tenants. Never creates duplicates, never marks paid."""
    created = 0
    for row in preview_obligations(period_start):
        t = row["tenant"]
        if t.id in tenant_ids and not row["exists"]:
            db.session.add(RentObligation(
                property_id=t.property_id, tenant_id=t.id, period_start=period_start,
                expected_amount=row["amount"], due_date=row["due_date"]))
            created += 1
    db.session.commit()
    return created


def increment_reminders(within_days: int = 60) -> list[Tenant]:
    """Active tenants whose planned increment date is near (or already passed)."""
    from datetime import timedelta

    limit = date.today() + timedelta(days=within_days)
    return (Tenant.query.filter(Tenant.is_active.is_(True), Tenant.next_increment_date.is_not(None),
                                Tenant.next_increment_date <= limit)
            .order_by(Tenant.next_increment_date).all())


def suggested_new_rent(tenant: Tenant) -> Decimal | None:
    if tenant.increment_percent is None:
        return None
    return (tenant.monthly_rent * (1 + tenant.increment_percent / 100)).quantize(Decimal("1"))


__all__ = ["ZERO"]
