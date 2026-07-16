# Minify4U

[**English**](README.md) · [Deutsch](README.de.md)

A VS Code extension that **minifies source files on save** and writes the output to a
**path that is freely configurable per file type**.

Unlike minifiers that only write *next to* the source, Minify4U routes each file type into
its own output folder — e.g. sources in `src/` compiled and minified into `assets/`.

## Supported languages

| Language     | Minifier             | Action                | Extension  |
|--------------|----------------------|-----------------------|------------|
| JavaScript   | terser               | minify                | `.min.js`  |
| CSS          | clean-css            | minify                | `.min.css` |
| SCSS / SASS  | sass                 | **compile** + minify  | `.min.css` |
| LESS         | less                 | **compile** + minify  | `.min.css` |
| HTML         | html-minifier-terser | minify                | `.min.html`|
| JSON / JSONC | jsonc-parser         | minify (compact)      | `.min.json`|

## How it works

On every save, Minify4U picks the rule to apply:

1. **`minify4u.rules`** — the **first** matching rule (by `glob` or `type`) wins.
2. If no rule matches, **`minify4u.output.<language>`** is used — plus
   **`minify4u.expanded.<language>`** for SCSS/Sass/LESS, see below.

The file is then minified with the matching minifier and written to the target folder
(relative to the folder root) with the configured extension.

**Already-minified files are skipped.** Saving `app.min.js` does *not* produce
`app.min.min.js`, and vendor bundles you merely open and save are left alone. A file counts
as already minified when its name ends with the rule's `suffix`, or when its base name ends
with `.min`. Skipped saves are reported in the "Minify4U" output channel.

## Asking on demand

Saving is quiet unless there is something to report — otherwise the output channel would
fill up in every project. But that makes a save that does nothing ambiguous: not configured,
switched off, or broken?

The command **`Minify4U: Minify Current File`** (Command Palette) is the deliberate question.
It runs the same pipeline on the active file and **always** answers, as a notification:

- `app.js → assets/js/app.min.js`
- `No output configured for "scss" in this folder — set minify4u.output.scss.`
- `Minify4U is switched off here (minify4u.enable = false).`
- `_header.scss is a partial — rebuilt styles.scss.`
- `app.min.js is already minified — skipped.`

Errors always surface as a notification, on save as well.

## Readable CSS next to the minified file

Some setups load plain, non-minified CSS — a theme's `functions.php` enqueuing
`assets/css/main.css`, for instance. `minify4u.expanded.<language>` writes exactly that,
for **SCSS, Sass and LESS**:

```jsonc
{
  "minify4u.output.scss":   "assets/css",  // main.scss → assets/css/main.min.css
  "minify4u.expanded.scss": "assets/css"   // main.scss → assets/css/main.css
}
```

Both settings are independent, take the same values (folder · `*` · empty), and one save
produces whichever you asked for:

- **Both set** — the minified *and* the readable file, from a single save.
- **Only `expanded`** — readable CSS only. This is the setup that replaces a dedicated Sass
  compiler whose job was to write one plain `.css`.
- **Only `output`** — the classic build, unchanged.

There is no `expanded` for JavaScript, CSS or HTML: compiling and minifying are the same
step there, so "expanded" would just copy the source. JSON has it via the `json-pretty`
minifier in `minify4u.rules`.

> `expanded` writes a real file — pointing it at a folder that holds a hand-written
> `main.css` overwrites it.

## Source maps

```jsonc
{ "minify4u.sourceMaps": true }
```

One switch, off by default. When on, every CSS file compiled from **SCSS, Sass or LESS** —
minified and readable alike, including `minify4u.rules` entries that use those compilers —
gets a `<name>.css.map` next to it plus the `sourceMappingURL` comment. DevTools then point
at the original source line instead of the compiled CSS.

Sources are referenced relative to the map, so the mapping works on a server that mirrors
your local tree — and the source text is also embedded into the map, so it even works where
the source tree is not deployed.

Off by default because the maps land next to your output files: an upload-on-save watcher
would deploy them, and nobody should get surprise files from an update. Turning the switch
off again removes the comment on the next save, but already written `.map` files stay —
delete them once by hand.

## Sass partials

A partial (`_variables.scss`) is not a stylesheet of its own — compiling it alone would emit
a fragment, or nothing at all when it only defines variables and mixins. Minify4U therefore
**never compiles a partial directly**. Saving one rebuilds the main files that import it —
including indirectly, through other partials.

The dependencies are not guessed from `@use`/`@import`: Dart Sass reports every file it
actually loaded, and Minify4U reverses that. Two details worth knowing:

- **Only main files that really import the partial are written.** Others are left untouched,
  so an upload-on-save watcher does not redeploy stylesheets that did not change.
- **On the first partial save after a restart** the dependencies are still unknown. Minify4U
  then walks up from the partial to the first directory containing a non-partial and treats
  that subtree as the candidates — so `.scss` elsewhere in the project (a parent theme, say)
  is never touched.

## Configuration

### Simple: output folder per language

For the common case, one setting per language is enough. The minifier and extension are
chosen automatically:

```jsonc
{
  "minify4u.enable": true,
  "minify4u.output.javascript": "assets/js",
  "minify4u.output.css": "assets/css",
  "minify4u.output.scss": "assets/css",
  "minify4u.output.less": "assets/css",
  "minify4u.output.html": "assets/html",
  "minify4u.output.json": "assets/json"
}
```

Each of these settings takes a folder path relative to the folder root:

| Value      | Meaning |
|------------|---------|
| `assets/js`| write the output into that folder |
| `*`        | write the output **next to the source file** |
| *(empty)*  | **disabled** — this language is ignored |

| Setting                     | Minifier   | Action               | Extension  |
|-----------------------------|------------|----------------------|------------|
| `minify4u.output.javascript`| terser     | minify               | `.min.js`  |
| `minify4u.output.css`       | clean-css  | minify               | `.min.css` |
| `minify4u.output.scss`      | sass       | **compile** + minify | `.min.css` |
| `minify4u.output.sass`      | sass       | **compile** + minify | `.min.css` |
| `minify4u.output.less`      | less       | **compile** + minify | `.min.css` |
| `minify4u.output.html`      | html       | minify               | `.min.html`|
| `minify4u.output.json`      | json       | minify (compact)     | `.min.json`|
| `minify4u.output.jsonc`     | json       | minify (compact)     | `.min.json`|
| `minify4u.expanded.scss`    | sass       | **compile**, readable| `.css`     |
| `minify4u.expanded.sass`    | sass       | **compile**, readable| `.css`     |
| `minify4u.expanded.less`    | less       | **compile**, readable| `.css`     |

> The `expanded.*` settings work alongside their `output.*` counterpart — set both to get
> both files from one save. See [Readable CSS next to the minified file](#readable-css-next-to-the-minified-file).

> Leave `minify4u.output.scss` **empty** if a dedicated Sass compiler already handles your
> SCSS — otherwise both tools compile the same file.

> Languages without a built-in mapping must be configured via `minify4u.rules`;
> otherwise a message appears in the "Minify4U" output channel.

### Excluding files

`minify4u.exclude` takes globs (relative to the folder root) that Minify4U ignores
completely, for every language:

```jsonc
{
  "minify4u.exclude": ["**/node_modules/**", "**/.vscode/**", "**/vendor/**"]
}
```

The default is `["**/node_modules/**", "**/.vscode/**"]`. Keeping `.vscode` out matters more
than it looks: VS Code treats its own `settings.json` as JSONC, so without that entry every
edit to your project configuration would write a minified copy of it into your JSONC output
folder.

### Advanced: rules for globs & special cases

`minify4u.rules` supports glob matching, custom extensions and an explicit minifier.
Rules take **precedence** over `minify4u.output.<language>`:

```jsonc
{
  "minify4u.rules": [
    {
      "glob": "src/js/vendor/**/*.js",
      "savePath": "assets/js/vendor",
      "suffix": ".min.js",
      "minifier": "terser"
    }
  ]
}
```

| Field      | Required | Description |
|------------|:------:|--------------|
| `glob`     | –      | Glob relative to the folder root. Alternative to `type`. |
| `type`     | –      | VS Code language ID (`javascript`, `css`, `scss`, …). Alternative to `glob`. |
| `savePath` | ✓      | Target folder relative to the folder root. `*` writes next to the source file. |
| `suffix`   | ✓      | Output extension (replaces the original extension). |
| `minifier` | ✓      | One of the values from the minifier table below. |

> Either `glob` **or** `type` must be set.

> `minify4u.rules` is an array of objects, which the VS Code settings editor cannot render
> as a form — use "Edit in settings.json" (it offers autocompletion for `minifier`).

### Minifier values

| Value         | Result |
|---------------|----------|
| `terser`      | minify JavaScript |
| `clean-css`   | minify CSS |
| `sass`        | **compile** + minify SCSS/SASS → CSS |
| `less`        | **compile** + minify LESS → CSS |
| `html`        | minify HTML |
| `json`        | minify JSON/JSONC (compact) |
| `json-pretty` | convert JSON/JSONC to **readable** JSON (comments/trailing commas removed, indented) — *not* minified |

**Example — convert JSONC to readable JSON (instead of minifying):**

```jsonc
{
  "minify4u.rules": [
    {
      "glob": "config/**/*.jsonc",
      "savePath": "config",
      "suffix": ".json",
      "minifier": "json-pretty"
    }
  ]
}
```

## Multi-root workspaces

Every Minify4U setting is **resource-scoped**: the configuration is read for the saved file,
so each root folder in a multi-root workspace can use its own values. One project writes to
`assets/js`, the next to `dist/scripts`, a third disables CSS entirely — same setting, three
answers.

Put per-project values in `<project>/.vscode/settings.json`. More specific wins:

| Level     | Where                              | Priority |
|-----------|------------------------------------|----------|
| Folder    | `<project>/.vscode/settings.json`  | **highest** |
| Workspace | `*.code-workspace` → `"settings"`  | |
| User      | global `settings.json`             | |
| Default   | the extension's own default        | lowest |

> In the settings editor this per-project level is the **"Folder"** tab. It appears once your
> workspace has more than one root folder.

**Watch out for a global `"minify4u.enable": false`** — it silently disables Minify4U in every
project that does not set `enable: true` itself.

## Development

```bash
npm install
npm run compile      # esbuild → dist/extension.js
npm run watch        # watch mode
npm run typecheck    # tsc --noEmit
```

- **Debug:** `F5` launches the Extension Host (uses `.vscode/launch.json`).
- **Package:** `npm run package` (`vsce package`) creates a `.vsix` for local installation.

## Limitations

- Output is written **flat** into `savePath` (source basename + `suffix`); the subfolder
  structure under the glob is not mirrored yet.
- No autoprefixer yet — if you rely on one, a dedicated Sass compiler is still needed
  alongside.

## License

[MIT](LICENSE) © Frank Hackenberg (4UWeb)
