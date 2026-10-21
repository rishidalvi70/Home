# The phone app (PWA) – setup and use

An installable web app that keeps **all data on your phone**. No server, no database to run, no account, works with no
internet. Same screens as the laptop version: rooms, tenants, rent and increments, property bills (who pays), mobile
plans, subscriptions, EMIs, LIC, SIPs, salary, expenses and investments.

## 1. Put the app online once (free, takes ~10 minutes)
The app is only files, so it can live on GitHub Pages. **No financial data is ever uploaded** – only the app's code.

1. On GitHub, open Pull Request #1 and **merge it** into `main` (Pages publishes from `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open the **Actions** tab. The workflow *Test and publish the phone app* runs (about a minute). When it is green,
   the address is shown in the run summary, normally `https://<your-username>.github.io/Home/`.

> **Private repository?** GitHub Pages is free only for public repositories. The repo holds code only (no data or
> secrets), so making it public is safe. If you prefer to keep it private, use a free static host that supports private
> repos (for example Cloudflare Pages or Netlify): publish the `pwa/dist` folder produced by `npm run dist`.

## 2. Install on each phone
Open the address in the phone's browser **once, with internet**. Then:

* **Android (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**).
* **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

After that it opens from the home screen like any app, **even in airplane mode**.

## Rooms: MHADA or Private, edit, delete, old entries
* **Category:** each room is **MHADA** (room number, ward name, ward number) or **Private** (just the address). Switching
  a room to Private clears its MHADA details. Rooms made before this existed are treated as MHADA.
* **Delete a room:** open the room → **Delete**. If it has records the app lists exactly what goes (tenants, rent records,
  payments, bills…) and asks you to **type DELETE**. **Archive** instead hides the room and keeps all its history.
* **Old entries:** **Rent → Add old rent record** adds any past month for any tenant, including **former tenants**, with an
  optional "already received" amount. A former tenant is one you **End tenancy** on (or untick *Current tenant*).
  Bills and payments accept past dates too.
* **Delete tenants, rent records, bills:** each has a **Delete** button; when records hang off it you're told how many.

## Rent received, and your salary
* **Rent received:** **Rent** → find the month → tap the green **Received** button on the room's row (or **Mark … received**
  on the rent record). It records the full amount as received **today**. For another date or a part payment, open the
  rent record and use **Record a payment**. "Overdue" simply means the due date has passed and the rent isn't fully received.
* **Rooms you live in** (or that are under development) don't ask who collects rent; the question appears when you set
  the room to Rented, Vacant, etc.
* **Salary:** tap **Add salary** on the dashboard (or **Salary & income → Add income**). The form is prefilled from your
  last salary, so each month is: check the amount, Save. Your salary counts toward "Money in" and "Left so far".

## Receipts
Attach the bill or the proof of payment to the thing it belongs to:
* **A bill** (electricity, gas, maintenance…): open the bill → **Receipts** → **Take photo** or **Attach file**.
* **A rent payment:** open the rent record → under the payment → **Take photo / Attach file**.
* **A LIC, EMI or other plan payment:** open the plan → payment history → attach under the payment.

Photos are shrunk automatically (a 6 MB camera photo becomes well under 2 MB); PDFs are kept as they are. Only photos and
real PDFs are accepted (up to 25 MB each).

**Receipts** (in the menu) is your folder view: **Room › Category › Year**, with names like `Room2_Electricity_2026-10.pdf`.
Filter, search, **Open**, **Save** or **Delete** any receipt. **Download as folder (zip)** gives real folders
(`Room 2/Electricity/2026/…`) to keep on a computer or Drive.

**Share from other apps (Android):** in WhatsApp, Gmail, Files or Gallery, open a bill/photo → **Share → Home Finance**.
It lands in the **Inbox** at the top of Receipts; pick which bill or payment it belongs to and tap **Attach**.
(If Home Finance isn't in the Share list, remove the home-screen app and install it again once. iPhone/iPad can't share
into web apps - use **Attach file** there.) Nothing is uploaded anywhere.

**Backups now include receipts.** With receipts, **Download backup** makes a **.zip** (your records + every receipt file).
**Restore** accepts that zip (or an old .json) and puts the files back exactly. A damaged zip is refused and nothing
changes. Deleting a bill, payment or room deletes the receipts attached to it, and the confirmation tells you how many.

## Marking a bill paid
**Property bills** → tap the green **Paid** button under the bill's name (or open the bill and tap **Mark ₹… paid**). It
records what you still owe on that bill as paid today. The same button is on the room's page and in **Personal overview →
Still to pay**. For a part payment or another date, open the bill and use **Record a payment**. Bills the tenant pays
have no button (they aren't yours to pay); set **Tenant payment** on the bill to Reported or Confirmed instead.

## "Left" money: paid vs still to pay
* **Left so far** = money in − what you have *actually paid* − invested. Adding a subscription, EMI or plan does **not** lower
  it until you record a payment.
* **Still to pay this month** lists everything added but not yet paid (bills, plans, EMIs, SIPs, anything overdue).
  Tap **Paid** on a row to record it as paid today; the plan's next due date moves forward.
* **Left after all dues** = Left so far − Still to pay. This is what you will have if everything due gets paid.
  Both screens (Dashboard and Personal overview) show it.

## 3. Your data and backups (important)
Your records are stored **only inside that phone's browser storage**.

* Each device keeps its **own** data. A phone and a tablet do not sync.
* Clearing site data, uninstalling the app, resetting the phone, or (on iPhone) not opening the app for a long time can
  erase it.
* So: **Backup & data → Download backup** regularly (the app reminds you after 30 days). Save the file to Google Drive,
  email it to yourself, or use **Share / save to Drive** where offered.
* **Restore** from a backup file on the same phone or a new one: **Backup & data → Restore**. A damaged or foreign file
  is rejected and nothing changes.
* To move data between your phones: back up on one, restore on the other.

## 4. Updating the app
When a new version is published, the app notices (when online) and shows **"A new version of the app is ready – Update
now"**. Your data is not touched by updates.

## 5. Try it on your laptop first (optional)
```powershell
cd Home\pwa
python -m http.server 8080
```
Open http://localhost:8080 . (Offline install only works on `localhost` or HTTPS addresses, so use the published
address on your phone.) Data on `localhost` is separate from data on the published address – use backup/restore to
move it.

## What is *not* in this version
No Google Calendar reminders, no receipt photos/PDF storage, no multi-device sync, no app lock (use your phone's lock
screen). Receipt attachments and reminders can be added later; they need decisions about where files live.
