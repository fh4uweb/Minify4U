# Changelog

All notable changes to Minify4U are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

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
