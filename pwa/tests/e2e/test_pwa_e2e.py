"""Real-browser tests: offline install, the full workflow, backup/erase/restore. Needs Playwright + Chromium.

    pip install pytest playwright      (browsers: PLAYWRIGHT_BROWSERS_PATH or `playwright install chromium`)
    pytest pwa/tests/e2e
"""
import glob
import json
import os
import struct
import zipfile
import zlib
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

PWA = Path(__file__).resolve().parents[2]
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
TODAY = date.today()


def chromium_path():
    env = os.environ.get("PW_CHROMIUM")
    if env:
        return env
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")
    found = sorted(glob.glob(f"{root}/chromium-*/chrome-linux/chrome"))
    return found[-1] if found else None


@pytest.fixture(scope="session")
def server():
    proc = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=PWA,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + "/index.html", timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)
    yield
    proc.terminate()


@pytest.fixture(scope="session")
def browser(server):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=chromium_path(), args=["--no-sandbox"])
        yield b
        b.close()


@pytest.fixture
def ctx(browser):
    c = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
    yield c
    c.close()


@pytest.fixture
def page(ctx):
    pg = ctx.new_page()
    pg.errors = []
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.prompt_answer = None  # tests can set a wrong answer to prove a delete is refused

    def on_dialog(d):
        if d.type == "prompt":
            d.accept(pg.prompt_answer if pg.prompt_answer is not None else ("DELETE" if "DELETE" in d.message else "ERASE"))
        else:
            d.accept()

    pg.on("dialog", on_dialog)
    return pg


def go(pg, route):
    pg.goto(f"{BASE}/#{route}")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_function("r => document.getElementById('view')?.dataset.route === r", arg=route, timeout=8000)


def sw_ready(pg):
    """Wait until the service worker controls the page and has cached every app file."""
    go(pg, "/")
    pg.wait_for_function("navigator.serviceWorker.ready.then(() => true)", timeout=15000)
    pg.reload()
    pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
    assets = json.loads(re.search(r"const ASSETS = (\[.*?\]);", (PWA / "sw.js").read_text(), re.S).group(1))
    got = pg.evaluate("caches.keys().then(async ks => { const c = await caches.open(ks.find(k => k.startsWith('home-finance-'))); return (await c.keys()).length })")
    assert got == len(assets)


def stat_value(pg, title):
    return pg.locator(f'.stat-card:has-text("{title}") .stat-value').first.inner_text().strip()


def toast_text(pg):
    return pg.locator("#toasts .alert").last.inner_text()


def submit(pg, form_id):
    pg.evaluate("document.getElementById('toasts').innerHTML = ''")  # so the next toast we wait for is the new one
    pg.click(f'form[data-form="{form_id}"] button[type=submit]')


def test_installable_and_offline_shell(page, ctx):
    go(page, "/")
    cdp = ctx.new_cdp_session(page)
    for _ in range(30):  # Chrome fetches the manifest and icons asynchronously
        errs = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
        errs = [e for e in errs if e["errorId"] != "in-incognito"]  # test browsers always run incognito
        if not errs:
            break
        page.wait_for_timeout(200)
    assert errs == [], errs
    manifest = json.loads((PWA / "manifest.webmanifest").read_text())
    assert manifest["display"] == "standalone" and {i["sizes"] for i in manifest["icons"]} >= {"192x192", "512x512"}
    assert any(i["purpose"] == "maskable" for i in manifest["icons"])
    sw_ready(page)
    ctx.set_offline(True)
    page.reload()
    expect(page.locator("h1")).to_have_text("Dashboard")
    assert page.locator('[data-testid="active-properties"]').inner_text().strip() == "6"
    assert page.errors == [], page.errors


def test_full_workflow_offline_then_backup_erase_restore(page, ctx, tmp_path):
    sw_ready(page)
    ctx.set_offline(True)  # everything below works with no network at all

    # tenant on Room 2 (seeded id 2), rent due day 5
    go(page, "/properties/2/tenants/new")
    page.fill("#tenant-name", "Asha Patil")
    page.fill("#tenant-monthlyRent", "8000")
    page.fill("#tenant-rentDueDay", "5")
    page.fill("#tenant-startDate", "2026-01-01")
    page.fill("#tenant-securityDeposit", "40000")
    page.fill("#tenant-incrementPercent", "5")
    submit(page, "tenant")
    expect(page.locator("#toasts")).to_contain_text("Tenant added.")

    # rent increment is recorded in history
    go(page, "/tenants/1/increment")
    assert page.input_value("#increment-newRent") == "8400"  # planned 5%
    page.fill("#increment-effectiveFrom", "2026-01-01")
    page.fill("#increment-newRent", "8000")
    submit(page, "increment")
    go(page, "/properties/2")
    expect(page.locator("body")).to_contain_text("Rent increment history")

    # generate this month's rent, review first, then confirm; nothing is received automatically
    month = TODAY.strftime("%Y-%m")
    go(page, f"/rent/generate?month={month}")
    expect(page.locator("#generate-box")).to_contain_text("Asha Patil")
    page.click('[data-action="create-obligations"]')
    expect(page.locator("#toasts")).to_contain_text("Created 1 rent record")
    go(page, f"/rent?month={month}")
    page.click('a:has-text("Room 2")')
    assert stat_value(page, "Received") == "₹0"
    page.fill("#rent-pay-amount", "9000")
    page.fill("#rent-pay-paidOn", TODAY.isoformat())
    submit(page, "rent-pay")
    expect(page.locator('form[data-form="rent-pay"]')).to_contain_text("more than the outstanding")
    page.fill("#rent-pay-amount", "3000")
    submit(page, "rent-pay")
    expect(page.locator("#toasts")).to_contain_text("Payment recorded.")
    expect(page.locator('.stat-card:has-text("Outstanding") .stat-value').first).to_have_text("₹5,000")
    # exact duplicate is refused
    page.fill("#rent-pay-amount", "3000")
    submit(page, "rent-pay")
    expect(page.locator('form[data-form="rent-pay"]')).to_contain_text("identical payment")

    # salary, a bill that I pay (partly), a tenant-paid bill, a subscription
    go(page, "/income/new")
    page.fill("#income-amount", "85000")
    submit(page, "income")
    expect(page.locator("#toasts")).to_contain_text("Income added.")
    go(page, "/bills/new?property=2")
    page.fill("#bill-name", "Light bill")
    page.fill("#bill-amount", "1450")
    page.fill("#bill-dueDate", (TODAY + timedelta(days=4)).isoformat())
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")
    page.fill("#bill-pay-amount", "1450")
    submit(page, "bill-pay")
    expect(page.locator("#toasts")).to_contain_text("Payment recorded.")
    go(page, "/bills/new?property=3")
    page.fill("#bill-name", "Tenant light")
    page.fill("#bill-amount", "900")
    page.select_option("#bill-responsible", "tenant")
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")
    go(page, "/commitments/new?kind=subscription")
    page.fill("#commitment-name", "Netflix")
    page.fill("#commitment-amount", "649")
    page.fill("#commitment-nextDueDate", TODAY.isoformat())
    submit(page, "commitment")
    expect(page.locator("#toasts")).to_contain_text("Subscription added.")
    submit(page, "commit-pay")
    expect(page.locator("#toasts")).to_contain_text("Next due")

    # dashboard: my rent (3000) + salary; spending = my bill + Netflix; tenant-paid bill is NOT my spending
    go(page, "/")
    expect(page.locator('.stat-card:has-text("Money in")')).to_be_visible()
    assert stat_value(page, "Money in") == "₹88,000"
    assert stat_value(page, "Spent (paid)") == "₹2,099"
    assert stat_value(page, "Left so far") == "₹85,901"
    before = {k: stat_value(page, k) for k in ("Money in", "Spent (paid)", "Left so far", "Still to pay this month")}

    # export a backup file
    go(page, "/backup")
    with page.expect_download() as dl:
        page.click('[data-action="download-backup"]')
    saved = tmp_path / "backup.json"
    dl.value.save_as(saved)
    data = json.loads(saved.read_text())
    assert data["app"] == "home-finance" and data["counts"]["tenants"] == 1 and data["counts"]["bills"] == 2
    assert data["counts"]["rentPayments"] == 1 and data["counts"]["commitmentPayments"] == 1
    expect(page.locator("body")).to_contain_text("Last backup:")

    # CSV export has rupees, not paise
    with page.expect_download() as dl2:
        page.click('[data-action="export-csv"][data-store="bills"]')
    csv_path = tmp_path / "bills.csv"
    dl2.value.save_as(csv_path)
    assert "1450.00" in csv_path.read_text(encoding="utf-8-sig")

    # erase everything...
    page.click('[data-action="erase-all"]')
    expect(page.locator("#toasts")).to_contain_text("All data erased.")
    go(page, "/")
    assert stat_value(page, "Money in") == "₹0"
    assert page.locator('[data-testid="active-properties"]').inner_text().strip() == "0"

    # ...and restore it from the file
    go(page, "/backup")
    page.set_input_files("#restore-file", str(saved))
    page.click('[data-action="restore-backup"]')
    expect(page.locator("#toasts")).to_contain_text("Backup restored.")
    go(page, "/")
    after = {k: stat_value(page, k) for k in before}
    assert after == before

    # a broken file is rejected and changes nothing
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"app": "home-finance", "schemaVersion": 1, "data": {"rentPayments": [{"id": 1, "obligationId": 99, "amount": 5, "paidOn": "2026-01-01"}]}}))
    go(page, "/backup")
    page.set_input_files("#restore-file", str(bad))
    page.click('[data-action="restore-backup"]')
    expect(page.locator("#toasts")).to_contain_text("missing obligations")
    go(page, "/")
    assert stat_value(page, "Money in") == before["Money in"]

    # data survives a reload (still offline)
    page.reload()
    expect(page.locator("h1")).to_have_text("Dashboard")
    assert stat_value(page, "Money in") == before["Money in"]
    assert page.errors == [], page.errors


PAGES = ["/", "/properties", "/properties/2", "/properties/new", "/rent", "/rent/generate", "/bills", "/bills/new", "/personal",
         "/commitments?kind=mobile", "/commitments?kind=emi", "/commitments/new?kind=insurance", "/income", "/expenses", "/investments",
         "/members", "/backup"]


def test_pages_fit_on_a_phone_and_have_no_errors(page):
    go(page, "/")
    for route in PAGES:
        go(page, route)
        page.wait_for_timeout(150)
        assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"), f"horizontal overflow on {route}"
    assert page.errors == [], page.errors


def test_in_app_filters_and_unknown_routes(page):
    go(page, "/bills")
    page.select_option('[data-filter="category"]', "gas")
    expect(page).to_have_url(re.compile(r"category=gas"))
    go(page, "/nope")
    expect(page.locator("body")).to_contain_text("doesn't exist")
    go(page, "/properties/999")
    expect(page.locator("body")).to_contain_text("doesn't exist")


def test_text_is_escaped(page):
    go(page, "/properties/new")
    page.fill("#property-name", '<img src=x onerror="window.__xss=1">')
    submit(page, "property")
    page.wait_for_selector("#toasts .alert")
    go(page, "/properties")
    assert page.evaluate("window.__xss") is None
    expect(page.locator("body")).to_contain_text('<img src=x onerror="window.__xss=1">')


def test_mhada_or_private_form(page):
    go(page, "/properties/new")
    expect(page.locator("#property-propertyKind")).to_have_value("mhada")
    for f in ("mhadaRoomNo", "wardName", "wardNumber"):
        expect(page.locator(f"#property-{f}")).to_be_visible()
    page.select_option("#property-propertyKind", "private")
    for f in ("mhadaRoomNo", "wardName", "wardNumber"):
        expect(page.locator(f"#property-{f}")).to_be_hidden()
    expect(page.locator("#property-address")).to_be_visible()
    page.fill("#property-name", "Shop on Main Road")
    page.fill("#property-address", "12 Main Road, Dadar\nMumbai 400014")
    submit(page, "property")
    expect(page.locator("#toasts")).to_contain_text("Added Shop on Main Road.")
    body = page.locator("#view")
    expect(body).to_contain_text("Private")
    expect(body).to_contain_text("12 Main Road, Dadar")
    expect(body).not_to_contain_text("MHADA room no.")
    expect(body).not_to_contain_text("Ward")

    # MHADA details typed, then switched to Private: they are cleared, not kept
    page.click('a:has-text("Edit")')
    page.select_option("#property-propertyKind", "mhada")
    page.fill("#property-mhadaRoomNo", "B-12")
    page.fill("#property-wardName", "G-North")
    page.select_option("#property-propertyKind", "private")
    submit(page, "property")
    expect(page.locator("#toasts")).to_contain_text("Property updated.")
    page.click('a:has-text("Edit")')
    page.select_option("#property-propertyKind", "mhada")
    assert page.input_value("#property-mhadaRoomNo") == "" and page.input_value("#property-wardName") == ""

    # list cards show the right identifying details
    go(page, "/properties")
    card = page.locator('.card:has-text("Shop on Main Road")')
    expect(card).to_contain_text("12 Main Road, Dadar")
    expect(card).to_contain_text("Private")
    expect(page.locator('.card:has-text("Room 2")')).to_contain_text("MHADA no. not added")

    # a room created before categories existed opens as MHADA with its fields visible
    go(page, "/properties/2/edit")
    expect(page.locator("#property-propertyKind")).to_have_value("mhada")
    expect(page.locator("#property-mhadaRoomNo")).to_be_visible()


def test_old_entries_and_deleting_rooms(page):
    # a tenant who has since left, with an old month of rent entered by hand
    go(page, "/properties/2/tenants/new")
    page.fill("#tenant-name", "Old Tenant")
    page.fill("#tenant-monthlyRent", "8000")
    page.fill("#tenant-rentDueDay", "5")
    page.fill("#tenant-startDate", "2025-01-01")
    submit(page, "tenant")
    expect(page.locator("#toasts")).to_contain_text("Tenant added.")
    page.click('[data-action="end-tenancy"]')
    expect(page.locator("#toasts")).to_contain_text("Tenancy ended")
    expect(page.locator("#view")).to_contain_text("Former")

    go(page, "/rent/new?tenant=1")
    expect(page.locator("#old-rent-tenantId")).to_contain_text("Old Tenant (former)")
    page.fill("#old-rent-periodStart", "2025-06-15")
    page.fill("#old-rent-receivedAmount", "9999")
    page.fill("#old-rent-receivedOn", "2025-06-07")
    submit(page, "old-rent")
    expect(page.locator('form[data-form="old-rent"]')).to_contain_text("more than the rent for the month")
    page.fill("#old-rent-receivedAmount", "8000")
    submit(page, "old-rent")
    expect(page.locator("#toasts")).to_contain_text("Rent record added.")
    expect(page.locator('.stat-card:has-text("Received") .stat-value').first).to_have_text("\u20b98,000")
    expect(page.locator('.stat-card:has-text("Outstanding") .stat-value').first).to_have_text("\u20b90")
    go(page, "/rent/new?tenant=1&month=2025-06")
    submit(page, "old-rent")
    expect(page.locator('form[data-form="old-rent"]')).to_contain_text("already a rent record")
    go(page, "/rent?month=2025-06")
    expect(page.locator("#view")).to_contain_text("Old Tenant")
    expect(page.locator("#view")).to_contain_text("Paid")

    # a bill with a payment, and a connection, on the same room
    go(page, "/bills/new?property=2")
    page.fill("#bill-name", "Old light bill")
    page.fill("#bill-amount", "1000")
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")
    page.fill("#bill-pay-amount", "400")
    page.fill("#bill-pay-paidOn", "2025-06-10")
    submit(page, "bill-pay")
    expect(page.locator("#toasts")).to_contain_text("Payment recorded.")

    # deleting the room needs the typed word; a wrong word deletes nothing
    go(page, "/properties/2")
    page.prompt_answer = "nope"
    page.click('.page-actions [data-action="delete-property"]')
    expect(page.locator("#toasts")).to_contain_text("Nothing was deleted.")
    page.prompt_answer = None  # back to typing DELETE when asked
    go(page, "/properties")
    expect(page.locator('.card:has-text("Room 2")')).to_be_visible()
    go(page, "/bills")
    expect(page.locator("#view")).to_contain_text("Old light bill")

    # delete the old rent record (and its payment) on its own
    go(page, "/rent?month=2025-06")
    page.click('a:has-text("Room 2")')
    page.click('[data-action="delete-obligation"]')
    expect(page.locator("#toasts")).to_contain_text("Rent record deleted.")
    expect(page.locator("#view")).not_to_contain_text("Old Tenant")

    # delete the tenant (no rent records left, so a plain confirm), then the bill (it has a payment)
    go(page, "/properties/2")
    page.click('[data-action="delete-tenant"]')
    expect(page.locator("#toasts")).to_contain_text("Tenant deleted.")
    go(page, "/bills")
    page.click('a:has-text("Old light bill")')
    page.click('.page-actions [data-action="delete-bill"]')
    expect(page.locator("#toasts")).to_contain_text("Bill deleted.")

    # an empty room, and a room full of records, both delete cleanly
    go(page, "/properties/new")
    page.fill("#property-name", "Scratch room")
    submit(page, "property")
    expect(page.locator("#toasts")).to_contain_text("Added Scratch room.")
    page.click('.page-actions [data-action="delete-property"]')
    expect(page.locator("#toasts")).to_contain_text("Scratch room deleted.")

    go(page, "/properties/3/tenants/new")
    page.fill("#tenant-name", "Room 3 Tenant")
    page.fill("#tenant-monthlyRent", "6500")
    page.fill("#tenant-rentDueDay", "5")
    page.fill("#tenant-startDate", "2025-01-01")
    submit(page, "tenant")
    expect(page.locator("#toasts")).to_contain_text("Tenant added.")
    go(page, "/rent/new?tenant=2")
    page.fill("#old-rent-periodStart", "2025-03-01")
    page.fill("#old-rent-receivedAmount", "6500")
    submit(page, "old-rent")
    expect(page.locator("#toasts")).to_contain_text("Rent record added.")
    go(page, "/properties/3")
    page.click('.page-actions [data-action="delete-property"]')
    expect(page.locator("#toasts")).to_contain_text("Room 3 deleted.")
    go(page, "/properties")
    expect(page.locator('.card:has-text("Room 3")')).to_have_count(0)
    go(page, "/rent?month=2025-03")
    expect(page.locator("#view")).not_to_contain_text("Room 3 Tenant")
    go(page, "/")
    assert stat_value(page, "My rent still to collect") == "\u20b90"
    assert page.errors == [], page.errors


def test_no_rent_question_for_the_room_you_live_in(page):
    go(page, "/properties/1/edit")  # Room 1 is seeded as self-occupied
    expect(page.locator("#property-occupancyStatus")).to_have_value("self_occupied")
    expect(page.locator("#property-rentCollectedBy")).to_be_hidden()
    page.select_option("#property-occupancyStatus", "rented")
    expect(page.locator("#property-rentCollectedBy")).to_be_visible()
    page.select_option("#property-occupancyStatus", "under_development")
    expect(page.locator("#property-rentCollectedBy")).to_be_hidden()
    page.select_option("#property-occupancyStatus", "self_occupied")
    submit(page, "property")
    expect(page.locator("#toasts")).to_contain_text("Property updated.")
    expect(page.locator("#view")).not_to_contain_text("Rent is collected by")
    # a rented room still asks, and its answer is kept
    go(page, "/properties/2/edit")
    expect(page.locator("#property-rentCollectedBy")).to_be_visible()
    page.select_option("#property-rentCollectedBy", "father")
    submit(page, "property")
    expect(page.locator("#toasts")).to_contain_text("Property updated.")
    expect(page.locator("#view")).to_contain_text("Rent is collected by")
    expect(page.locator("#view")).to_contain_text("Father")


def test_mark_rent_received_in_one_tap_and_add_salary(page):
    go(page, "/properties/2/tenants/new")
    page.fill("#tenant-name", "Asha Patil")
    page.fill("#tenant-monthlyRent", "8000")
    page.fill("#tenant-rentDueDay", "1")
    page.fill("#tenant-startDate", "2026-01-01")
    submit(page, "tenant")
    expect(page.locator("#toasts")).to_contain_text("Tenant added.")
    month = TODAY.strftime("%Y-%m")
    go(page, f"/rent/generate?month={month}")
    page.click('[data-action="create-obligations"]')
    expect(page.locator("#toasts")).to_contain_text("Created 1 rent record")
    go(page, f"/rent?month={month}")
    assert stat_value(page, "Outstanding") == "₹8,000"
    page.click('[data-action="mark-received"]')
    expect(page.locator("#toasts")).to_contain_text("marked as received")
    expect(page.locator('.stat-card:has-text("Outstanding") .stat-value').first).to_have_text("₹0")
    assert stat_value(page, "Received") == "₹8,000"
    expect(page.locator("#view")).to_contain_text("Paid")
    expect(page.locator('[data-action="mark-received"]')).to_have_count(0)

    # salary: the dashboard button opens the form as a salary entry
    go(page, "/")
    page.click('a:has-text("Add salary")')
    expect(page.locator("#income-kind")).to_have_value("salary")
    assert page.input_value("#income-amount") == ""  # nothing to prefill yet
    page.fill("#income-amount", "85000")
    page.fill("#income-source", "Employer")
    submit(page, "income")
    expect(page.locator("#toasts")).to_contain_text("Income added.")
    go(page, "/")
    assert stat_value(page, "Money in") == "₹93,000"  # 85,000 salary + 8,000 rent I collect
    # next month: the form is prefilled from the last salary
    go(page, "/income/new?kind=salary")
    assert page.input_value("#income-amount") == "85000" and page.input_value("#income-source") == "Employer"
    expect(page.locator("#view")).to_contain_text("Prefilled from your last salary")
    assert page.errors == [], page.errors


def test_personal_overview_shows_left_after_dues_and_paid_button(page):
    # salary, an everyday expense, and two plans due this month that are not paid yet
    go(page, "/income/new")
    page.fill("#income-amount", "85000")
    submit(page, "income")
    expect(page.locator("#toasts")).to_contain_text("Income added.")
    go(page, "/expenses/new")
    page.fill("#expenses-amount", "7000")
    submit(page, "expenses")
    expect(page.locator("#toasts")).to_contain_text("Expense added.")
    for name, amount, kind in (("Netflix", "649", "subscription"), ("Bike loan", "4200", "emi")):
        go(page, f"/commitments/new?kind={kind}")
        page.fill("#commitment-name", name)
        page.fill("#commitment-amount", amount)
        page.fill("#commitment-nextDueDate", TODAY.isoformat())
        submit(page, "commitment")
        expect(page.locator("#toasts")).to_contain_text("added.")
    go(page, "/personal")
    assert stat_value(page, "Left so far") == "₹78,000"  # only paid things count
    assert stat_value(page, "Still to pay this month") == "₹4,849"
    assert stat_value(page, "Left after all dues") == "₹73,151"
    expect(page.locator("#view")).to_contain_text("Netflix")
    expect(page.locator("#view")).to_contain_text("Bike loan")
    # mark Netflix paid in one tap: spending goes up, still-to-pay goes down, left-after-dues is unchanged
    page.locator('tr:has-text("Netflix") [data-action="pay-due"]').click()
    expect(page.locator("#toasts")).to_contain_text("marked as paid")
    expect(page.locator('.stat-card:has-text("Left so far") .stat-value').first).to_have_text("₹77,351")
    assert stat_value(page, "Still to pay this month") == "₹4,200"
    assert stat_value(page, "Left after all dues") == "₹73,151"
    expect(page.locator("#view tr:has-text('Netflix')")).to_have_count(0)  # its next due date moved to next month
    # the dashboard agrees
    go(page, "/")
    assert stat_value(page, "Left after all dues") == "₹73,151"
    assert page.errors == [], page.errors


def test_mark_a_bill_paid_from_the_list_the_bill_and_the_room(page):
    go(page, "/bills/new?property=2")
    page.fill("#bill-name", "Light bill")
    page.fill("#bill-amount", "1450")
    page.fill("#bill-dueDate", TODAY.isoformat())
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")
    # a bill the tenant pays has nothing for me to mark paid
    go(page, "/bills/new?property=2")
    page.fill("#bill-name", "Tenant water")
    page.fill("#bill-amount", "300")
    page.select_option("#bill-responsible", "tenant")
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")

    go(page, "/bills")
    expect(page.locator('[data-action="pay-due"]')).to_have_count(1)  # only my bill
    expect(page.locator('tr:has-text("Light bill") [data-action="pay-due"]')).to_be_visible()
    page.click('tr:has-text("Light bill") [data-action="pay-due"]')
    expect(page.locator("#toasts")).to_contain_text("marked as paid")
    expect(page.locator('tr:has-text("Light bill")')).to_contain_text("Paid")
    expect(page.locator('[data-action="pay-due"]')).to_have_count(0)

    # the bill page agrees: fully paid, one payment, no button
    page.click('a:has-text("Light bill")')
    expect(page.locator('.page-actions [data-action="pay-due"]')).to_have_count(0)
    expect(page.locator("#view")).to_contain_text("₹1,450.00")

    # a second bill: use the button on the room page and on the bill page
    go(page, "/bills/new?property=2")
    page.fill("#bill-name", "Gas bill")
    page.fill("#bill-amount", "800")
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")
    page.click('.page-actions [data-action="pay-due"]')
    expect(page.locator("#toasts")).to_contain_text("marked as paid")
    expect(page.locator('.page-actions [data-action="pay-due"]')).to_have_count(0)
    go(page, "/properties/2")
    expect(page.locator('[data-action="pay-due"]')).to_have_count(0)
    # spending shows it: 1,450 + 800 paid this month
    go(page, "/")
    assert stat_value(page, "Property bills") == "₹2,250"
    assert page.errors == [], page.errors


# ---------------------------------------------------------------- receipts

def make_pdf(path, text="Receipt"):
    path.write_bytes(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
                     b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% " + text.encode() + b"\ntrailer<</Root 1 0 R>>\n%%EOF\n")
    return path


def make_noise_png(path, w=1600, h=1200):
    """A big, incompressible 'camera photo' (about 5.7 MB) so we can prove the app shrinks it."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + os.urandom(w * 3) for _ in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 1)) + chunk(b"IEND", b""))
    return path


def idb_rows(pg, store):
    """Read a store straight from IndexedDB (what is really on the phone)."""
    return pg.evaluate("""(store) => new Promise((resolve, reject) => {
        const open = indexedDB.open('home-finance');
        open.onsuccess = () => { const r = open.result.transaction(store).objectStore(store).getAll();
          r.onsuccess = async () => resolve(await Promise.all(r.result.map(async (x) => x.blob
            ? { id: x.id, type: x.blob.type, size: x.blob.size, head: Array.from(new Uint8Array(await x.blob.slice(0, 5).arrayBuffer())) } : x)));
          r.onerror = () => reject(r.error); };
        open.onerror = () => reject(open.error); })""", store)


def add_bill(page, name="Light bill", amount="1450", due="2026-10-24"):
    go(page, "/bills/new?property=2")
    page.fill("#bill-name", name)
    page.fill("#bill-amount", amount)
    page.fill("#bill-dueDate", due)
    submit(page, "bill")
    expect(page.locator("#toasts")).to_contain_text("Bill added.")


def test_receipts_attach_shrink_folder_zip_backup_restore(page, tmp_path):
    pdf = make_pdf(tmp_path / "scan.pdf", "electricity bill")
    png = make_noise_png(tmp_path / "IMG_2026.png")
    sw_ready(page)

    # 1) a bill: attach a PDF and a big photo together
    add_bill(page)
    page.set_input_files('input[data-file-action="attach"][multiple]', [str(pdf), str(png)])
    expect(page.locator("#toasts")).to_contain_text("2 receipts added.")
    expect(page.locator("#view")).to_contain_text("Room2_Electricity_2026-10.pdf")
    expect(page.locator("#view")).to_contain_text("Room2_Electricity_2026-10_2.jpg")  # PNG became a smaller JPEG
    stored = {r["id"]: r for r in idb_rows(page, "receiptFiles")}
    meta = idb_rows(page, "receipts")
    assert len(meta) == 2 and len(stored) == 2
    photo = next(m for m in meta if m["mime"] == "image/jpeg")
    assert photo["size"] < png.stat().st_size / 2, "big photos should be shrunk"
    assert stored[photo["id"]]["size"] == photo["size"] and stored[photo["id"]]["head"][:2] == [0xFF, 0xD8]  # really a JPEG
    pdf_meta = next(m for m in meta if m["mime"] == "application/pdf")
    assert stored[pdf_meta["id"]]["head"] == list(b"%PDF-")
    assert page.locator("img[data-receipt-thumb]").count() == 1
    expect(page.locator("img[data-receipt-thumb]")).to_have_js_property("complete", True)

    # 2) refused files: wrong content, wrong type
    fake = tmp_path / "fake.pdf"; fake.write_text("<html>not a pdf</html>")
    page.set_input_files('input[data-file-action="attach"][multiple]', str(fake))
    expect(page.locator("#toasts")).to_contain_text("doesn't look like a real PDF")
    note = tmp_path / "notes.txt"; note.write_text("hello")
    page.set_input_files('input[data-file-action="attach"][multiple]', str(note))
    expect(page.locator("#toasts")).to_contain_text("Only photos")
    assert len(idb_rows(page, "receipts")) == 2

    # 3) rent payment receipt and a LIC payment receipt
    go(page, "/properties/2/tenants/new")
    page.fill("#tenant-name", "Asha Patil"); page.fill("#tenant-monthlyRent", "8000"); page.fill("#tenant-rentDueDay", "1"); page.fill("#tenant-startDate", "2026-01-01")
    submit(page, "tenant")
    expect(page.locator("#toasts")).to_contain_text("Tenant added.")
    month = TODAY.strftime("%Y-%m")
    go(page, f"/rent/generate?month={month}")
    page.click('[data-action="create-obligations"]')
    expect(page.locator("#toasts")).to_contain_text("Created 1 rent record")
    go(page, f"/rent?month={month}")
    page.click('[data-action="mark-received"]')
    expect(page.locator("#toasts")).to_contain_text("₹8,000 marked as received.")
    page.click('a:has-text("Room 2")')
    page.set_input_files('input[data-file-action="attach"][multiple]', str(make_pdf(tmp_path / "upi.pdf", "upi")))
    expect(page.locator("#toasts")).to_contain_text("1 receipt added.")
    go(page, "/commitments/new?kind=insurance")
    page.fill("#commitment-name", "LIC Jeevan Anand"); page.fill("#commitment-amount", "12000"); page.select_option("#commitment-frequency", "half_yearly")
    page.fill("#commitment-nextDueDate", TODAY.isoformat())
    submit(page, "commitment")
    expect(page.locator("#toasts")).to_contain_text("added.")
    submit(page, "commit-pay")
    expect(page.locator("#toasts")).to_contain_text("Payment recorded.")
    page.set_input_files('input[data-file-action="attach"][multiple]', str(make_pdf(tmp_path / "lic.pdf", "lic")))
    expect(page.locator("#toasts")).to_contain_text("1 receipt added.")

    # 4) the Receipts folder view: Room > Category > Year
    go(page, "/receipts")
    body = page.locator("#view")
    for text_ in ("Room 2", "Electricity", "Rent", "Personal", "LIC / Insurance", "Room2_Electricity_2026-10.pdf", f"Room2_Rent_{month}.pdf",
                  f"Personal_LIC-Jeevan-Anand_{month}.pdf"):
        expect(body).to_contain_text(text_)
    page.select_option('[data-filter="category"]', "Rent")
    expect(page.locator("#view")).not_to_contain_text("Room2_Electricity_2026-10.pdf")
    expect(page.locator("#view")).to_contain_text(f"Room2_Rent_{month}.pdf")
    page.select_option('[data-filter="category"]', "")

    # 5) open a photo (new tab with the file) and save one with its clean name
    with page.context.expect_page() as popup:
        page.locator('.receipt-row:has-text(".jpg") [data-action="open-receipt"]').first.click()
    popup.value.wait_for_url(re.compile(r"^blob:"), timeout=8000)  # the file loads into the new tab
    popup.value.close()
    with page.expect_download() as dl:
        page.locator('tr, .receipt-row').filter(has_text="Room2_Electricity_2026-10.pdf").locator('[data-action="download-receipt"]').first.click()
    assert dl.value.suggested_filename == "Room2_Electricity_2026-10.pdf"
    dl.value.save_as(tmp_path / "saved.pdf")
    assert (tmp_path / "saved.pdf").read_bytes() == pdf.read_bytes()

    # 6) "folder" zip: real folders named Room / Category / Year
    with page.expect_download() as dz:
        page.click('[data-action="download-folder-zip"]')
    folder_zip = tmp_path / "folder.zip"; dz.value.save_as(folder_zip)
    with zipfile.ZipFile(folder_zip) as z:
        assert z.testzip() is None
        names = z.namelist()
        assert "Room 2/Electricity/2026/Room2_Electricity_2026-10.pdf" in names
        assert f"Room 2/Rent/{TODAY.year}/Room2_Rent_{month}.pdf" in names
        assert any(n.startswith("Personal/LIC - Insurance/") for n in names)
        assert z.read("Room 2/Electricity/2026/Room2_Electricity_2026-10.pdf") == pdf.read_bytes()

    # 7) backup is now a zip with the records and every receipt file
    go(page, "/backup")
    expect(page.locator("#view")).to_contain_text("receipt files")
    with page.expect_download() as db_:
        page.click('[data-action="download-backup"]')
    assert db_.value.suggested_filename.endswith(".zip")
    backup_zip = tmp_path / "backup.zip"; db_.value.save_as(backup_zip)
    with zipfile.ZipFile(backup_zip) as z:
        assert z.testzip() is None
        assert "backup.json" in z.namelist() and sum(n.startswith("receipts/") for n in z.namelist()) == 4
        assert json.loads(z.read("backup.json"))["counts"]["receipts"] == 4
    before_files = sorted((r["size"], tuple(r["head"])) for r in idb_rows(page, "receiptFiles"))

    # 8) erase everything (files too), then restore from the zip
    page.click('[data-action="erase-all"]')
    expect(page.locator("#toasts")).to_contain_text("All data erased.")
    assert idb_rows(page, "receipts") == [] and idb_rows(page, "receiptFiles") == []
    go(page, "/backup")
    page.set_input_files("#restore-file", str(backup_zip))
    page.click('[data-action="restore-backup"]')
    expect(page.locator("#toasts")).to_contain_text("Backup restored.")
    assert sorted((r["size"], tuple(r["head"])) for r in idb_rows(page, "receiptFiles")) == before_files  # byte-identical
    go(page, "/receipts")
    expect(page.locator("#view")).to_contain_text("Room2_Electricity_2026-10.pdf")
    expect(page.locator("img[data-receipt-thumb]")).to_have_js_property("complete", True)

    # 9) a damaged zip is refused and changes nothing
    broken = tmp_path / "broken.zip"; raw = bytearray(backup_zip.read_bytes()); raw[200] ^= 0xFF; broken.write_bytes(raw)
    go(page, "/backup")
    page.set_input_files("#restore-file", str(broken))
    page.click('[data-action="restore-backup"]')
    expect(page.locator("#toasts")).to_contain_text("damaged")
    assert len(idb_rows(page, "receipts")) == 4
    # a JSON that mentions receipts cannot be restored without the zip
    with zipfile.ZipFile(backup_zip) as z:
        (tmp_path / "only.json").write_bytes(z.read("backup.json"))
    page.set_input_files("#restore-file", str(tmp_path / "only.json"))
    page.click('[data-action="restore-backup"]')
    expect(page.locator("#toasts")).to_contain_text(".zip")
    assert len(idb_rows(page, "receipts")) == 4

    # 10) deleting a bill deletes its receipts (and the prompt says how many)
    page.once("dialog", lambda d: None)  # (the default handler already accepts)
    go(page, "/bills")
    page.click('a:has-text("Light bill")')
    msgs = []
    page.on("dialog", lambda d: msgs.append(d.message))
    page.click('.page-actions [data-action="delete-bill"]')
    expect(page.locator("#toasts")).to_contain_text("Bill deleted.")
    assert any("2 receipts" in m for m in msgs), msgs
    assert len(idb_rows(page, "receipts")) == 2 and len(idb_rows(page, "receiptFiles")) == 2
    # one receipt on its own
    go(page, "/receipts")
    page.locator('[data-receipt-row]').first.locator('[data-action="delete-receipt"]').click()
    expect(page.locator("#toasts")).to_contain_text("Receipt deleted.")
    assert len(idb_rows(page, "receipts")) == 1 and len(idb_rows(page, "receiptFiles")) == 1
    assert page.errors == [], page.errors


def test_android_share_target_inbox(page, tmp_path):
    sw_ready(page)
    add_bill(page)
    # what Android does when you tap Share -> Home Finance: POST the file to the share URL
    pdf_bytes = make_pdf(tmp_path / "shared.pdf", "from whatsapp").read_bytes()
    result = page.evaluate("""async (bytes) => {
        const fd = new FormData();
        fd.append('title', 'Bill'); fd.append('files', new File([new Uint8Array(bytes)], 'WhatsApp Document.pdf', { type: 'application/pdf' }));
        const res = await fetch('./share-target', { method: 'POST', body: fd, redirect: 'manual' });
        return { type: res.type, caches: await caches.keys() }; }""", list(pdf_bytes))
    assert result["type"] == "opaqueredirect" and "hf-inbox" in result["caches"]
    page.reload()
    expect(page.locator("#toasts")).to_contain_text("1 file received")
    go(page, "/receipts")
    expect(page.locator("#view")).to_contain_text("Inbox")
    expect(page.locator("#view")).to_contain_text("waiting to be attached")
    assert page.evaluate("caches.open('hf-inbox').then(c => c.keys()).then(k => k.length)") == 0  # moved into the phone's storage
    # attach it to the bill
    page.click('[data-action="attach-inbox"]')
    expect(page.locator("#toasts")).to_contain_text("Choose what")
    page.select_option("select[data-inbox-for]", index=1)
    page.click('[data-action="attach-inbox"]')
    expect(page.locator("#toasts")).to_contain_text("Receipt attached.")
    expect(page.locator("#view")).not_to_contain_text("waiting to be attached")
    expect(page.locator("#view")).to_contain_text("Room2_Electricity_2026-10.pdf")
    # an image/odd file shared by mistake is refused and does not pile up
    page.evaluate("""async () => { const fd = new FormData(); fd.append('files', new File(['<b>x</b>'], 'x.html', { type: 'text/html' }));
        await fetch('./share-target', { method: 'POST', body: fd, redirect: 'manual' }); }""")
    page.reload()
    expect(page.locator("#toasts")).to_contain_text("Only photos")
    assert page.evaluate("caches.open('hf-inbox').then(c => c.keys()).then(k => k.length)") == 0
    assert len(idb_rows(page, "receipts")) == 1
