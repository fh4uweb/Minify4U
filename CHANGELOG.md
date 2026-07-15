# Changelog

All notable changes to Minify4U are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **`minify4u.expanded.scss` / `.sass` / `.less`** — write readable, non-minified CSS, with the
  same values as `output.*` (folder · `*` · empty). Independent of it: set both and one save
  produces `main.css` *and* `main.min.css`; set only `expanded` to replace a dedicated Sass
  compiler whose job was to write one plain stylesheet. Only for languages where compiling and
  minifying differ — "expanded JavaScript" would just copy the source. Also available to
  `minify4u.rules` as the minifiers `sass-expanded` and `less-expanded`.
- **`Minify4U: Minify Current File`** command — runs the pipeline on the active file and
  always reports the outcome as a notification, including the cases that are silent on save.
  Saving stays quiet on purpose; this is the deliberate question when nothing happens and you
  want to know why. Also available from the editor and explorer **context menus**, for the
  file types Minify4U handles.
- **Every answer names the setting *and* the level it came from** — `minify4u.output.html,
  from the workspace` rather than just a path. The settings editor shows the effective value
  but not its origin, so an empty field looks like "off" when it really means "this level says
  nothing" and a broader one decides. This also distinguishes *"empty because you switched it
  off here"* from *"never configured anywhere"*.
- **A notification when a save produces nothing because Minify4U is switched off** — once per
  folder per session, naming the level that set `enable: false`. Errors already notified;
  "not configured" and "already minified" raise no notification, since neither means
  something failed.
- **Saving a supported file with no output configured now says so in the output channel** —
  naming the setting and whether it is empty on purpose or was never set. No notification:
  "not configured" is the normal state of most files, and interrupting for it on every save
  would be noise. Only for the languages Minify4U handles, so saving a `.md` stays silent.
- **Sass partials are understood.** A `_partial.scss` is no longer compiled on its own
  (which produced a fragment, or  an empty file when it only held variables and mixins).
  Saving one rebuilds the main files that import it, directly or through other partials.
  The dependencies come from Dart Sass itself (every file it loaded), not from parsing
  `@use`/`@import`. Main files that do *not* import the partial are left untouched, so  an
  upload-on-save watcher will not redeploy unchanged stylesheets.
- **`minify4u.exclude`** — globs Minify4U ignores completely, for every language. Default
  `["**/node_modules/**", "**/.vscode/**"]`. The `.vscode` entry matters: VS Code treats its
  own `settings.json` as JSONC, so without it every edit to your project configuration wrote
  a minified copy of it into the JSONC output folder.

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
