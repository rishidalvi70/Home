"""Real-browser tests: offline install, the full workflow, backup/erase/restore. Needs Playwright + Chromium.

    pip install pytest playwright      (browsers: PLAYWRIGHT_BROWSERS_PATH or `playwright install chromium`)
    pytest pwa/tests/e2e
"""
import glob
import json
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
    pg.on("dialog", lambda d: d.accept("ERASE") if d.type == "prompt" else d.accept())
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
    got = pg.evaluate("caches.keys().then(async k => { const c = await caches.open(k[0]); return (await c.keys()).length })")
    assert got == len(assets)


def stat_value(pg, title):
    return pg.locator(f'.stat-card:has-text("{title}") .stat-value').first.inner_text().strip()


def toast_text(pg):
    return pg.locator("#toasts .alert").last.inner_text()


def submit(pg, form_id):
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
    assert stat_value(page, "Outstanding") == "₹5,000"
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
