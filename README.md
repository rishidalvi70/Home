# Home Finance – property, rent & bills dashboard (single owner)

Flask + PostgreSQL + Bootstrap 5. One owner account, no registration.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture, schema and phase plan.

**Status:** Phase 1 (foundation) complete. Phases 2–5 are not built yet.

## Windows setup (PowerShell)

1. Install Python 3.11+ and PostgreSQL 16 (remember the `postgres` superuser password).
2. Create the databases (psql as `postgres`):
   ```sql
   CREATE USER homeapp WITH PASSWORD 'choose-a-password' CREATEDB;
   CREATE DATABASE home_dev OWNER homeapp;
   CREATE DATABASE home_test OWNER homeapp;   -- tests wipe this DB; keep it separate
   ```
3. From the project folder:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements-dev.txt
   copy .env.example .env      # then edit SECRET_KEY and the database passwords
   flask --app wsgi db upgrade
   flask --app wsgi seed-properties      # creates Room 1..6 (only if none exist)
   flask --app wsgi owner-create         # prompts for username + password
   flask --app wsgi run                  # http://127.0.0.1:5000  (development only)
   ```
   On Windows the production-style server is `waitress-serve --listen=127.0.0.1:8000 wsgi:app`;
   on Linux use `gunicorn wsgi:app`. Never expose `flask run` publicly.

Linux/macOS: same steps, with `python3 -m venv .venv && source .venv/bin/activate`.

## Running the tests

Tests need a real PostgreSQL database (they build the schema from the migrations):

```powershell
$env:TEST_DATABASE_URL = "postgresql://homeapp:choose-a-password@localhost:5432/home_test"
pytest
```

## Owner account

* Created only from the server console: `flask owner-create`. There is no signup page.
* Forgotten password: `flask owner-reset-password` (also clears lockouts and signs out all sessions).
* Login is rate-limited and the account locks for 15 minutes after 5 bad passwords.
