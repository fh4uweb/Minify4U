# Changelog

All notable changes to Minify4U are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [0.3.0] – 2026-07-15

> **Breaking:** the `minify4u.output` map was replaced by one setting per language.
> See *Migration* below.

### Added
- **Already-minified files are skipped** — saving `app.min.js` no longer produces
  `app.min.min.js`, and vendor bundles that are merely opened and saved are left alone.
  Detected via the rule's `suffix` or a base name ending in `.min`; reported in the
  output channel.
- **Multi-root support**: every setting is now `resource`-scoped and read for the saved
  file, so each root folder can use its own output paths.
- `*` as an output value — write the result **next to the source file**.
- The output channel now explains why nothing happened when `minify4u.enable` is `false`
  and a rule would otherwise have applied.

### Changed
- **`minify4u.output` is now one setting per language** — `minify4u.output.javascript`,
  `minify4u.output.css`, `minify4u.output.scss`, `minify4u.output.sass`,
  `minify4u.output.less`, `minify4u.output.html`, `minify4u.output.json`,
  `minify4u.output.jsonc` — replacing the single *language → folder* map. The settings
  editor cannot render a map as labelled fields; separate settings can.
- An **empty** output value now means *disabled* for that language (it previously fell
  back to the folder root).
- Settings descriptions now say **folder root** instead of "workspace root": paths and
  globs resolve against the root folder the saved file belongs to — a difference that
  matters in multi-root workspaces.

### Migration
Replace the old map with one setting per language:

```jsonc
// before
"minify4u.output": { "javascript": "assets/js", "css": "assets/css" }

// after
"minify4u.output.javascript": "assets/js",
"minify4u.output.css": "assets/css"
```

## [0.2.0] – 2026-07-14

### Added
- Multi-language support: **SCSS/SASS** and **LESS** (compile + minify to CSS),
  **HTML** (html-minifier-terser), **JSON/JSONC** (jsonc-parser).
- **`minify4u.output`** setting — a simple *language → output folder* map;
  the minifier and extension are chosen automatically per language.
- **`json-pretty`** minifier — convert JSONC to readable JSON (comments and trailing
  commas removed, indented).
- Extension icon.

### Changed
- Dependencies are shipped as `node_modules` (`sass`/`less` cannot be bundled).

## [0.1.0] – 2026-07-14

### Added
- Initial release: minify JavaScript (Terser) and CSS (clean-css) on save.
- **`minify4u.rules`** setting — output path, extension and minifier per glob / file type.
