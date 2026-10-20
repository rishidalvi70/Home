import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAssets, stamp } from "../scripts/build-sw.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(join(root, "sw.js"), "utf8");
const assets = JSON.parse(/const ASSETS = (\[[\s\S]*?\]);/.exec(sw)[1]);

test("sw.js is stamped with the current files and version (run `npm run build`)", () => {
  assert.equal(stamp(sw), sw);
});

test("every file the app needs is cached for offline use, and nothing else", () => {
  for (const a of assets) if (a !== "./") assert.ok(existsSync(join(root, a)), `${a} is listed but missing`);
  assert.deepEqual(assets.slice(1).sort(), listAssets().map((f) => "./" + f).sort());
  for (const must of ["./index.html", "./manifest.webmanifest", "./js/main.js", "./vendor/bootstrap.min.css", "./vendor/chart.umd.js", "./vendor/fonts/bootstrap-icons.woff2", "./icons/icon-192.png"])
    assert.ok(assets.includes(must), `${must} must be cached`);
  assert.ok(!assets.some((a) => /node_modules|tests\/|scripts\/|dist\//.test(a)));
});

test("every module and file referenced from index.html and the manifest exists", () => {
  const index = readFileSync(join(root, "index.html"), "utf8");
  for (const m of index.matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^(https?:|data:|#)/.test(m[1])) assert.ok(existsSync(join(root, m[1])), `index.html references missing ${m[1]}`);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
  for (const i of manifest.icons) assert.ok(existsSync(join(root, i.src)), `${i.src} missing`);
  assert.equal(manifest.display, "standalone");
});

test("the app never talks to the network (no fetch/XHR/websocket beyond its own files)", () => {
  const src = assets.filter((a) => a.startsWith("./js/")).map((a) => readFileSync(join(root, a), "utf8")).join("\n");
  assert.ok(!/XMLHttpRequest|WebSocket|navigator\.sendBeacon|https?:\/\/(?!www\.w3\.org)/.test(src), "app code must not reference remote URLs");
  assert.ok(!/\bfetch\(/.test(src), "app code must not call fetch()");
});

test("content-security-policy blocks remote scripts", () => {
  const index = readFileSync(join(root, "index.html"), "utf8");
  assert.match(index, /Content-Security-Policy" content="default-src 'self'/);
  assert.doesNotMatch(index, /<script(?![^>]*\bsrc=)[^>]*>[^<]/); // no inline scripts
});
