# Changelog

All notable changes to Minify4U are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.8.3] – 2026-09-11

All three found by actually running 0.8.2 rather than by reading it.

### Fixed
- **The inherited-`*` question could disappear without a trace.** It was an information message, and
  VS Code swallows those while "Do Not Disturb" is on — warnings still get through. A question that
  asks for a decision must not sit on the one level that can vanish, or the extension keeps writing
  into build folders exactly as before, which is what the question exists to prevent. It is a
  warning now.
- Notifications no longer repeat the extension name. VS Code prefixes every notification with
  "Minify4U:" by itself, so "Minify4U is switched off here" read as "Minify4U: Minify4U is switched
  off here", and the error message even managed "Minify4U: Minify4U: …".
- **German grammar: "geerbt aus deine Benutzer-Einstellungen".** The origin of a value appears in
  sentences that need different cases — "gesetzt durch" (accusative) and "geerbt aus" (dative) — and
  one text fragment cannot be both. English never shows this because it has no cases. The sentences
  are now uniformly dative ("set in" rather than "set by"), so a single form fits everywhere.

## [0.8.2] – 2026-09-11

### Documentation
- **The README showed nothing but JSON**, as though the settings editor did not exist — while it is
  the way most people actually change a setting. Both READMEs now open the configuration chapter
  with where to change things: `Ctrl+,` and `@ext:4uweb.minify4u`, or `settings.json`, with the
  note that `minify4u.rules` is JSON-only because an array of objects has no form representation.
- **Explained what "inherited" means**, which was missing entirely although it causes the most
  surprise: an empty field on the Workspace tab does not mean "off here", it means "nothing set
  here" — the User value still applies, and VS Code marks it with "(Also modified in: User)".
  Set `output.javascript` to `*` once and it applies in every project, including the ones you never
  had in mind. That is exactly what the inherited-`*` question from 0.7.0 exists for, and the two
  now reference each other.

## [0.8.1] – 2026-09-11

### Changed
- **German settings texts now speak German, not transliterated English.** The first pass kept the
  jargon of the original: "Glob", "Vendor-Prefixe" and — fourteen times — "Ordner-Root". None of
  those mean anything to someone who writes code occasionally rather than daily.
  "Ordner-Root" is now "Projektordner", "Glob" is "Dateimuster mit Wildcards", and vendor prefixes
  link to the German Wikipedia article on [Herstellerpräfixe](https://de.wikipedia.org/wiki/Herstellerpr%C3%A4fix).
  Terms that are genuinely common in the field — Source Map, Trigger, Minifier, Partial — are kept.
- Added `npm run check-l10n`: verifies that both `package.nls*.json` carry the same keys, that every
  `vscode.l10n.t()` call has a bundle entry (and no entry is unused), and that no markdown link
  contains an unencoded `(` — a parenthesis in a URL silently truncates the link, which is exactly
  what happened to the Wikipedia link while writing this release.

## [0.8.0] – 2026-09-11

### Added
- **German user interface.** Settings descriptions, notifications and the output channel now follow
  VS Code's display language: with a German VS Code everything appears in German, everywhere else
  in English. Nothing to configure.
  Settings are localized through `package.nls.json` / `package.nls.de.json`, runtime messages
  through `vscode.l10n` with a bundle per language — 45 strings, checked to be complete rather than
  assumed.

### Note for contributors
Adding a setting now means adding its text to **both** `package.nls*.json` files, and any new
message must go through `vscode.l10n.t()`. A string that misses the bundle silently falls back to
English.

## [0.7.0] – 2026-09-10

Asks about the inherited setting instead of about one folder.

### Changed
- **The build-folder question from 0.6.0 is replaced by a better one.** It asked *"is `dist` a build
  folder?"* and offered to exclude it — one folder at a time, in every project, forever. The real
  ambiguity lies elsewhere: `*` is the only output setting without a fixed target, it writes beside
  the source *whatever folder that happens to be*, and inherited from the user settings it applies
  to projects nobody ever thought about.
  Minify4U now asks **once per setting and project**, the first time it writes with an inherited
  `*`: **Keep it here** · **Choose folder…** (a folder picker, stored relative to the project root)
  · **Don't minify here**. Every answer writes an *explicit* value into the project's settings, so
  nothing there stays inherited — and the question never returns, in this or any later session.
  A source sitting in `dist`, `build` or `out` adds a hint to the message; it no longer drives a
  question of its own.
- Rules from `minify4u.rules` never raise the question — those are written by hand, which is a
  decision, not an inheritance.
- Output written by a previous build is named in the output channel when the answer turns building
  off, so stale files do not survive unnoticed. Minify4U still never deletes anything on its own.

## [0.6.0] – 2026-09-10

Stops the watcher from quietly minifying build output.

### Added
- **Minify4U asks before it keeps building from a build folder.** Since 0.5.0 the watcher also sees
  what *build tools* write, and a project whose output setting is `*` ends up minifying its own
  bundle: esbuild writes `dist/extension.js`, Minify4U puts `dist/extension.min.js` next to it, and
  the file ships inside the package. This extension did it to itself in 0.5.1, and it only surfaced
  because the `.vsix` had one file too many — nobody would notice this in their own project.
  Building **from** a file inside `dist`, `build` or `out` now raises one notification per folder
  per session, with a button that writes `**/<folder>/**` into the project's `minify4u.exclude`.
  Only the **source** is checked, never the target: `src/app.js` → `dist/app.min.js` is exactly
  what the setting is for and stays quiet.
- Files skipped because they match `minify4u.exclude` now say so in the output channel. Until now
  Minify4U went silent, which is indistinguishable from a broken extension for anyone trying to
  find out why nothing gets built.

### Note
A question rather than a new default: adding `dist`/`build`/`out` to the default `minify4u.exclude`
would work instantly, but it would silently stop building for anyone whose sources live in `build/`
— the kind of change this project does not ship in an update.

## [0.5.1] – 2026-09-10

### Changed
- New extension icon.

## [0.5.0] – 2026-09-10

Builds on **any** change to a source file, not only on an editor save.

### Added
- **File-system watcher.** Until now Minify4U listened to `onDidSaveTextDocument` alone, so
  only an editor save produced output. Anything writing a file another way — a script, a
  formatter, `sed`, a code assistant editing files directly — changed the source and never
  reached the output. That failure is silent and expensive: the source looks updated, the
  built file is stale, and an upload-on-save watcher happily deploys the mismatch.
- **`minify4u.trigger`** — `watch` (default) or `save`. The two are mutually exclusive, so a
  save never builds twice and no de-duplication is involved. `save` restores the pre-0.5.0
  behaviour for setups where file watchers are unreliable (some Remote-SSH, WSL and
  network-drive configurations).
- Every glob in `minify4u.rules` gets a watcher of its own, alongside the one for the known
  extensions. Rules may point at any file at all (`sftp.jsonc`, `*.txt`), and without this
  those would be exactly the files the watcher never sees. Patterns are re-derived when the
  configuration or the workspace folder list changes.

### Fixed
- Nothing Minify4U writes can trigger a build of its own. Every output path is registered
  before the write and ignored for a moment afterwards. Without it, a compiled `main.css`
  reads as a fresh CSS source and yields a `main.min.css` nobody configured — which then
  ships. The existing already-minified check stops such a chain from running away, but only
  this stops it from starting.
- A file whose editor buffer has unsaved changes is skipped, with a line in the output
  channel. Its buffer and the file on disk differ, and building the buffer would produce
  output matching neither; the buffer's own save triggers the build.

### Changed
- Events are debounced per path (150 ms), so the burst a single write produces becomes one
  build.
- `node_modules` and `.git` are dropped before a document is even opened — a checkout or an
  `npm install` would otherwise push thousands of files through the pipeline.

## [0.4.1] – 2026-07-18

### Fixed
- The editor and explorer context-menu entry read just "Minify Current File", with nothing
  identifying which extension it belongs to — context menus don't show a command's category.
  The entry now reads "Minify4U: Minify Current File"; the Command Palette is unchanged.

## [0.4.0] – 2026-07-17

Replaces a live Sass compiler for the common case: understands partials, writes a readable
CSS next to the minified one, emits source maps, and adds vendor prefixes.

### Added
- **`minify4u.autoprefixer`** — adds vendor prefixes to every CSS Minify4U produces (SCSS,
  Sass, LESS and plain CSS; minified and readable alike). Default off, since prefixes change
  the files you ship. Prefixes are added *before* minifying, and source maps are threaded
  through the extra step, so they still point at the original source rather than at an
  un-prefixed intermediate.
  Browser targets come from the **project's own browserslist config** (`package.json`,
  `.browserslistrc`), searched upwards from the source file — the config your other tooling
  already reads. **`minify4u.browserslist`** overrides it for projects that carry none.
  Every write reports what it prefixed against (`prefixed for 14 browsers`), so the targets
  are never a silent guess.
- **`minify4u.sourceMaps`** — one switch (default off). When on, every CSS compiled from
  SCSS/Sass/LESS gets a `.css.map` next to it plus the `sourceMappingURL` comment, minified
  and readable output alike, including `minify4u.rules` entries using those compilers.
  Sources are referenced relative to the map *and* embedded into it, so DevTools resolve
  them both on a server mirroring the local tree and where the sources are not deployed.
  For minified LESS the map is carried through the less → clean-css chain, so it points at
  the `.less` source, not at the readable intermediate.
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
