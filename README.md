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
2. If no rule matches, **`minify4u.output`** (language → folder) is used.

The file is then minified with the matching minifier and written to the target folder
(relative to the workspace root) with the configured extension.

## Configuration

### Simple: output folder per language

For the common case, `minify4u.output` is enough — a map of **language → folder**.
The minifier and extension are chosen automatically:

```jsonc
{
  "minify4u.enable": true,
  "minify4u.output": {
    "javascript": "assets/js",
    "css": "assets/css",
    "scss": "assets/css",
    "less": "assets/css",
    "html": "assets/html",
    "json": "assets/json"
  }
}
```

| Language ID     | Minifier   | Action               | Extension  |
|-----------------|------------|----------------------|------------|
| `javascript`    | terser     | minify               | `.min.js`  |
| `css`           | clean-css  | minify               | `.min.css` |
| `scss` / `sass` | sass       | **compile** + minify | `.min.css` |
| `less`          | less       | **compile** + minify | `.min.css` |
| `html`          | html       | minify               | `.min.html`|
| `json` / `jsonc`| json       | minify (compact)     | `.min.json`|

> Languages without a built-in mapping must be configured via `minify4u.rules`;
> otherwise a message appears in the "Minify4U" output channel.

### Advanced: rules for globs & special cases

`minify4u.rules` supports glob matching, custom extensions and an explicit minifier.
Rules take **precedence** over `minify4u.output`:

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
| `glob`     | –      | Glob relative to the workspace root. Alternative to `type`. |
| `type`     | –      | VS Code language ID (`javascript`, `css`, `scss`, …). Alternative to `glob`. |
| `savePath` | ✓      | Target folder relative to the workspace root. |
| `suffix`   | ✓      | Output extension (replaces the original extension). |
| `minifier` | ✓      | One of the values from the minifier table below. |

> Either `glob` **or** `type` must be set.

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

## License

[MIT](LICENSE) © Frank Hackenberg (4UWeb)
