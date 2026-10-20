# How it works on your laptop

```
Browser (Chrome/Edge)  ──http://127.0.0.1:5000──►  Flask app  ──SQL──►  PostgreSQL (database home_dev)
   what you see/click        the `flask run` window    pages, rules,        installed Windows service,
                                                       calculations         stores every record
```

1. **PostgreSQL** starts with Windows and holds all your records. Nothing is stored in the browser.
2. **`flask run`** starts the app. It reads `.env` (database password, secret key) and listens on port 5000.
3. Your **browser** asks for a page. The app checks you are signed in, reads the records, does the sums
   (rent outstanding, what's left of salary…) and sends back the page.
4. When you **save a form** the app validates it (required fields, amounts, dates), then writes to PostgreSQL.
5. **Migrations** (`flask db upgrade`) create or change the tables when the code is updated. Your data is kept.

Close the PowerShell window and the site stops; PostgreSQL and your data stay.

## Upgrading an existing laptop install to this version

```powershell
cd Home
git pull
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
flask --app wsgi db upgrade        # adds the new tables, keeps your 6 rooms and login
flask --app wsgi run
```
The upgrade also creates three family-member labels ("Member 1-3"); rename them under *Family members*.

## Key rules the app follows
* **Spending = payments actually made.** A bill past its due date is "overdue", never "paid".
* **Tenant-paid bills** are recorded for the file but never count as your spending.
* **Rent counts as your income only for rooms where "Rent is collected by" = Me.** Rooms collected by your father or
  mother are still tracked (expected / received / outstanding) but shown separately.
* **Security deposits** are stored on the tenant and never counted as income.
* **SIPs** are *investments*, not expenses; they are subtracted from "left this month" but shown apart.
* **Rent increments** keep a history (old → new, from which date). Rent already generated for past months is not changed.
* **Deleting** is blocked or softened where history matters: properties with records are archived, tenants with rent
  records become "former", bills/commitments with payments are cancelled instead of erased.
