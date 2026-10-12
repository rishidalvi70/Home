# Architecture, Schema and Plan

Single-owner Flask application for properties, rent, bills, insurance, mobile plans,
subscriptions and documents. PostgreSQL is the only authoritative store.

## 1. Architecture

```
 Windows browser ─┐                         ┌─ PostgreSQL (all financial records)
 Android browser ─┼─ HTTPS ─ gunicorn ─ Flask app ─┼─ Private document dir / object store
 Android PWA     ─┘   (reverse proxy)       └─ Google Calendar API (optional, OAuth 2.0)
```

* **Server-rendered** Jinja2 pages + Bootstrap 5 + small vanilla JS; Chart.js for charts.
  Bootstrap and Chart.js are vendored in `app/static/vendor` (no third-party CDN at
  runtime, strict CSP, works offline for the shell).
* **Blueprints**: `auth`, `main` (dashboard), `properties`, later `tenants`/`rent`,
  `bills`, `mhada_tax`, `insurance`, `mobile`, `subscriptions`, `development`,
  `calendar`, `documents`, `reports`, `backup`, `search`.
* **Service layer** (`app/services/`): money/date math and reporting queries live here, not
  in routes, so they are unit-testable (month-end, leap years, allocations).
* **Money**: `NUMERIC(14,2)` / `Decimal` everywhere. Never `float`.
* **Authoritative DB**: Google Calendar is a derived projection; failures never block saves.
* **PWA**: network-first for HTML, cache-first for static assets, offline fallback page.
  No offline financial editing (avoids silent conflicts); the DB is the source of truth.
* **Security**: one `owner_account` row (DB check `id = 1`), Argon2id hashes, CSRF on every
  POST, rate limiting + account lockout, secure/HttpOnly/SameSite cookies, CSP and other
  headers, no registration route. The owner is created only via CLI (`flask owner-create`).

## 2. Directory structure

```
app/
  __init__.py        application factory, security headers, error handlers
  config.py          env-driven config (dev / testing / production)
  extensions.py      db, migrate, csrf, login_manager, limiter
  cli.py             owner-create, owner-reset-password, seed-properties
  models/            SQLAlchemy models (one module per domain)
  auth/ main/ properties/ ...   blueprints (routes.py, forms.py)
  services/          domain logic (added per phase)
  templates/  static/ (css, js, vendor, icons, manifest, sw.js — PWA in Phase 5)
migrations/          Alembic (Flask-Migrate)
tests/               pytest, run against a real PostgreSQL database
docs/                architecture, setup, deployment, OAuth, costs
scripts/             backup / restore (Phase 5)
wsgi.py  requirements.txt  .env.example
```

## 3. Database schema (target, all phases)

All tables have `id`, `created_at`, `updated_at`. Money = `NUMERIC(14,2)`.
Status/enum columns are `VARCHAR` + CHECK constraints (portable, easy to extend by migration).

| Phase | Table | Key columns / rules |
|---|---|---|
| **1** | `owner_account` | `id` (CHECK `id=1`), `username` unique, `password_hash`, `failed_attempts`, `locked_until`, `last_login_at` |
| **1** | `property` | `name`, `mhada_room_no`, `ward_name`, `ward_number`, `address`, `occupancy_status`, `property_type`, `ownership`, `notes`, `archived_at`, `sort_order` |
| 2 | `tenant` | `property_id`, `name`, `contact`, `start_date`, `end_date`, `monthly_rent`, `rent_due_day`, `security_deposit`, `is_active`, `notes` |
| 2 | `rent_obligation` | `property_id`, `tenant_id`, `period_start`, `period_end`, `expected_amount`, `due_date`, `status` (open/cancelled); **UNIQUE(property_id, tenant_id, period_start)** |
| 2 | `payment` | generic cash transaction: `amount`, `paid_on`, `method`, `reference`, `direction` (in/out), `kind` (rent, bill, deposit, …), `notes` |
| 2 | `payment_allocation` | `payment_id`, `target_type`, `target_id`, `amount`; unique per (payment, target); sum of allocations ≤ payment amount; outstanding = expected − Σ allocations |
| 2 | `security_deposit_txn` | separate from income: received / refunded / adjusted |
| 2 | `utility_connection` | `property_id`, `kind` (electricity/gas/water/internet), `provider`, `nickname`, `consumer_ref` (masked on display) — many per property |
| 2 | `bill` | category, property?, connection?, provider, bill_no, period, received_on, due_date, amount, `responsible` (owner/tenant/shared/other), `tenant_payment_state` (reported/confirmed), `status` incl. cancelled; paid amount derived from allocations |
| 2 | `bill_share` | `bill_id`, `party`, `amount` for shared bills |
| 2 | `mhada_tax_record` | property, type, ref, assessment no, FY, schedule (annual/quarterly/monthly/custom), due/paid |
| 2 | `insurance_policy` | nickname, provider, masked ref, premium, frequency, `next_due_date` (separate from payment date) |
| 2 | `family_member`, `mobile_connection`, `mobile_recharge`, `mobile_bill` | 3 seeded members (renamable); prepaid `validity_days` + manual `expiry_date`; postpaid bills |
| 2 | `subscription`, `subscription_charge` | status, frequency, `next_renewal_date`; charges immutable history (price changes don't rewrite past) |
| 2 | `development_expense` | property, vendor, kind, invoice no, amount, status |
| 3 | `reminder_rule`, `calendar_event_link` | per-category/per-item offsets; Google `event_id`, sync status, last error, unique(source_type, source_id, reminder_kind) |
| 3 | `google_credential` | encrypted refresh token (server-side only), calendar id |
| 3 | `document` | stored path, original name, content type, size, sha256, property, category, year; polymorphic link to a record |
| 5 | `backup_run` | timestamp, kind, location, checksum, verified |

Rules enforced in code + constraints: properties with transactions are never hard-deleted
(archive only); payments are never inferred from due dates; tenant-paid bills are excluded
from owner cash totals; deposits excluded from income.

## 4. Development plan

1. **Phase 1 – Foundation** *(this commit)*: app factory, config, PostgreSQL + migrations,
   owner auth (CLI setup, login, lockout, rate limit, password change, CSRF), dashboard shell,
   property table + six seeded rooms + read-only list, tests.
2. **Phase 2 – Financial records**: property CRUD/archive, tenants/rent/payments, bills,
   MHADA/tax, insurance, mobile, subscriptions, development.
3. **Phase 3 – Calendar & documents**.
4. **Phase 4 – Reporting, search, exports**.
5. **Phase 5 – Backup/restore, PWA, production hardening, deployment docs, cost docs**.

Each phase ends with passing tests before the next begins.
