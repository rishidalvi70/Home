// Lists every app file for offline use and stamps sw.js with a content hash, so a changed app
// always gets a new cache. Run: npm run build   (add --check to verify without writing)
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const SKIP_DIRS = new Set(["node_modules", "tests", "scripts", "dist"]);
const SKIP_FILES = new Set(["sw.js", "package.json", "package-lock.json", "README.md"]);

export function listAssets() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue; }
      const rel = relative(root, full).split(sep).join("/");
      if (!SKIP_FILES.has(rel) && !name.endsWith(".md") && !name.endsWith(".txt")) out.push(rel);
    }
  })(root);
  return out;
}

export function compute() {
  const files = listAssets();
  const hash = createHash("sha256");
  for (const f of files) { hash.update(f); hash.update(readFileSync(join(root, f))); }
  const version = hash.digest("hex").slice(0, 12);
  return { files, version, list: ["./", ...files.map((f) => "./" + f)] };
}

export function stamp(src) {
  const { version, list } = compute();
  return src
    .replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`)
    .replace(/\/\/ ASSETS:START[\s\S]*\/\/ ASSETS:END/, `// ASSETS:START\nconst ASSETS = ${JSON.stringify(list, null, 2)};\n// ASSETS:END`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(root, "sw.js");
  const current = readFileSync(path, "utf8");
  const next = stamp(current);
  if (process.argv.includes("--dist")) {
    // Clean folder with only what the browser needs (no tests, no node_modules) - this is what gets published.
    writeFileSync(path, next);
    const out = join(root, "dist");
    rmSync(out, { recursive: true, force: true });
    for (const f of [...listAssets(), "sw.js"]) { mkdirSync(dirname(join(out, f)), { recursive: true }); copyFileSync(join(root, f), join(out, f)); }
    console.log(`dist/ ready (${listAssets().length + 1} files, version ${compute().version}).`);
  } else if (process.argv.includes("--check")) {
    if (next !== current) { console.error("sw.js is out of date. Run: npm run build"); process.exit(1); }
    console.log("sw.js is up to date.");
  } else {
    writeFileSync(path, next);
    console.log(`sw.js stamped (${compute().files.length} files, version ${compute().version}).`);
  }
}
