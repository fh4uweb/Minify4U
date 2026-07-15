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
2. If no rule matches, **`minify4u.output.<language>`** is used.

The file is then minified with the matching minifier and written to the target folder
(relative to the folder root) with the configured extension.

**Already-minified files are skipped.** Saving `app.min.js` does *not* produce
`app.min.min.js`, and vendor bundles you merely open and save are left alone. A file counts
as already minified when its name ends with the rule's `suffix`, or when its base name ends
with `.min`. Skipped saves are reported in the "Minify4U" output channel.

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

> Leave `minify4u.output.scss` **empty** if a dedicated Sass compiler already handles your
> SCSS — otherwise both tools compile the same file.

> Languages without a built-in mapping must be configured via `minify4u.rules`;
> otherwise a message appears in the "Minify4U" output channel.

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
- No exclude globs yet — files are selected by `glob`/`type` only.
- SCSS partials (`_*.scss`) are compiled like any other file; there is no dependency
  tracking that rebuilds the main files importing them. No source maps, no autoprefixer.

## License

[MIT](LICENSE) © Frank Hackenberg (4UWeb)
