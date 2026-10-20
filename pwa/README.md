# Home Finance – phone app (PWA)

Plain HTML/CSS/JavaScript (ES modules), no build framework. Data in IndexedDB on the device. Works offline via a
service worker. User guide: [../docs/PHONE_APP.md](../docs/PHONE_APP.md).

```
index.html            app shell (strict CSP, no inline scripts, no remote resources)
manifest.webmanifest  install info + icons
sw.js                 offline cache (VERSION + file list are generated - run `npm run build`)
js/lib/               dates (month-end/leap-year safe), money (integer paise, Indian grouping), safe HTML, CSV
js/domain/            business rules as pure functions: rent+increments, bills, commitments, dashboard, reports
js/db.js              IndexedDB wrapper, seed, backup export / strict validated import
js/ui/                router, form engine with validation, charts
js/views/             screens
tests/                node:test unit tests; tests/e2e = real-browser tests (Playwright, Python)
```

Money is stored as **integer paise** (no floating-point drift). Dates are `YYYY-MM-DD` strings.

## Develop
```
cd pwa
npm install
npm test                # unit tests: rules, storage, backup/restore validation, offline-file list
npm run build           # re-stamp sw.js after changing ANY app file (npm test fails if you forget)
python -m http.server 8080
```
Real-browser tests (offline install, full workflow, backup → erase → restore, phone-width layout):
```
pip install pytest playwright && playwright install chromium
pytest pwa/tests/e2e
```
`npm run dist` writes a clean `dist/` (what GitHub Pages publishes). Backup file format: `{app, schemaVersion, exportedAt, counts, data}`;
bump `SCHEMA_VERSION` in `js/constants.js` and add an import migration if the stored shape ever changes.
