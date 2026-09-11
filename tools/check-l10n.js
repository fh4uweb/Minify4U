// Checks that the translations are complete, because a missing one is silent:
// VS Code simply falls back to English, with no error anywhere.
//
// Two things are compared:
//   1. package.nls.json  <->  package.nls.de.json     (settings UI)
//   2. every vscode.l10n.t("…") in the source  <->  l10n/bundle.l10n.de.json
//
// Run with `npm run check-l10n`. Exits non-zero when something is missing, so it
// can guard a release.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

let failed = false;

function report(title, missing, extra, missingLabel, extraLabel) {
  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${title}`);
    return;
  }
  failed = true;
  console.log(`✗ ${title}`);
  for (const k of missing) console.log(`    ${missingLabel}: ${JSON.stringify(k)}`);
  for (const k of extra) console.log(`    ${extraLabel}: ${JSON.stringify(k)}`);
}

// 1 — settings UI
const en = read("package.nls.json");
const de = read("package.nls.de.json");
report(
  `package.nls: ${Object.keys(en).length} keys`,
  Object.keys(en).filter((k) => !(k in de)),
  Object.keys(de).filter((k) => !(k in en)),
  "missing in de",
  "only in de"
);

// 2 — runtime messages. The key *is* the English string, so it is read straight
// out of the source rather than from a second list that could drift.
const src = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");
const used = new Set();
for (const m of src.matchAll(/vscode\.l10n\.t\(\s*("(?:[^"\\]|\\.)*")/g)) {
  used.add(JSON.parse(m[1]));
}
for (const m of src.matchAll(/vscode\.l10n\.t\(\s*('(?:[^'\\]|\\.)*')/g)) {
  used.add(m[1].slice(1, -1).replace(/\\'/g, "'"));
}
const bundle = read("l10n/bundle.l10n.de.json");
report(
  `l10n bundle: ${used.size} strings in use`,
  [...used].filter((k) => !(k in bundle)),
  Object.keys(bundle).filter((k) => !used.has(k)),
  "missing in de",
  "unused"
);

// 3 — markdown links must not carry raw parentheses: the first ")" ends the
// link, so a Wikipedia URL like Wildcard_(Informatik) breaks silently.
for (const [file, data] of [
  ["package.nls.json", en],
  ["package.nls.de.json", de]
]) {
  const broken = Object.entries(data).filter(([, v]) =>
    /\]\((?:https?:)?[^)]*\([^)]*\)/.test(v)
  );
  if (broken.length > 0) {
    failed = true;
    console.log(`✗ ${file}: unencoded "(" in a markdown link`);
    for (const [k] of broken) console.log(`    ${k}`);
  }
}
if (!failed) console.log("✓ markdown links");

process.exit(failed ? 1 : 0);
