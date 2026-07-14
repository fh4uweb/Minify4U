# Minify4U

VS-Code-Extension, die Quelldateien **beim Speichern** minifiziert und den Output an einen
**je Dateityp/Glob frei konfigurierbaren Pfad** schreibt.

Damit schließt Minify4U die Lücke von *MinifyAll* (schreibt nur *neben* die Quelle) und
vereinheitlicht das 4u-Build-Muster `files4u/` → `assets/` über alle Dateitypen.

## Funktionsweise

Bei jedem Speichern bestimmt die Extension die anzuwendende Regel:

1. **`minify4u.rules`** – die **erste** passende Regel (per `glob` oder `type`) gewinnt.
2. Greift keine Regel, wird **`minify4u.output`** (Sprache → Ordner) herangezogen.

Danach wird die Datei mit dem passenden Minifier minifiziert und nach dem Ziel-Ordner
(relativ zum Workspace-Root) geschrieben, mit der jeweiligen Endung.

## Konfiguration

### Einfach: Ausgabe-Ordner je Sprache

Für den Normalfall reicht `minify4u.output` – eine Zuordnung **Sprache → Ordner**.
Minifier und Endung werden automatisch gewählt:

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

| Sprach-ID       | Minifier   | Aktion                         | Endung     |
|-----------------|------------|--------------------------------|------------|
| `javascript`    | terser     | minifizieren                   | `.min.js`  |
| `css`           | clean-css  | minifizieren                   | `.min.css` |
| `scss` / `sass` | sass       | **kompilieren** + minifizieren | `.min.css` |
| `less`          | less       | **kompilieren** + minifizieren | `.min.css` |
| `html`          | html       | minifizieren                   | `.min.html`|
| `json` / `jsonc`| json       | minifizieren (kompakt)         | `.min.json`|

> Sprachen ohne Standard-Zuordnung müssen über `minify4u.rules` konfiguriert werden;
> ansonsten erscheint eine Meldung im Output-Channel „Minify4U".

### Fein: Regeln für Globs & Sonderfälle

`minify4u.rules` erlaubt Glob-Matching, eigene Endungen und expliziten Minifier. Regeln
haben **Vorrang** vor `minify4u.output`:

```jsonc
{
  "minify4u.rules": [
    {
      "glob": "files4u/js/vendor/**/*.js",
      "savePath": "assets/js/vendor",
      "suffix": ".min.js",
      "minifier": "terser"
    }
  ]
}
```

| Feld       | Pflicht | Beschreibung |
|------------|:------:|--------------|
| `glob`     | –      | Glob relativ zum Workspace-Root. Alternativ `type`. |
| `type`     | –      | VS-Code-Sprach-ID (`javascript`, `css`, `scss`, …). Alternativ zu `glob`. |
| `savePath` | ✓      | Ziel-Ordner relativ zum Workspace-Root. |
| `suffix`   | ✓      | Output-Endung (ersetzt die Original-Endung). |
| `minifier` | ✓      | Einer der Werte aus der Minifier-Tabelle unten. |

> Es muss entweder `glob` **oder** `type` gesetzt sein.

### Minifier-Werte

| Wert          | Ergebnis |
|---------------|----------|
| `terser`      | JavaScript minifizieren |
| `clean-css`   | CSS minifizieren |
| `sass`        | SCSS/SASS **kompilieren** + minifizieren → CSS |
| `less`        | LESS **kompilieren** + minifizieren → CSS |
| `html`        | HTML minifizieren |
| `json`        | JSON/JSONC minifizieren (kompakt) |
| `json-pretty` | JSON/JSONC in **lesbare** JSON umwandeln (Kommentare/Trailing-Commas raus, eingerückt) – *nicht* minifiziert |

**Beispiel – JSONC lesbar zu JSON umwandeln (statt minifizieren):**

```jsonc
{
  "minify4u.rules": [
    {
      "glob": "files4u/jsonc/**/*.jsonc",
      "savePath": "config",
      "suffix": ".json",
      "minifier": "json-pretty"
    }
  ]
}
```

## Entwicklung

```bash
npm install
npm run compile      # esbuild → dist/extension.js
npm run watch        # Watch-Modus
npm run typecheck    # tsc --noEmit
```

- **Debuggen:** `F5` startet den Extension-Host (nutzt `.vscode/launch.json`).
- **Paketieren:** `npm run package` (`vsce package`) erzeugt eine `.vsix` zur lokalen Installation.

## Grenzen

- Output wird **flach** in `savePath` abgelegt (Dateiname der Quelle + `suffix`); die
  Unterordner-Struktur unter dem Glob wird noch nicht gespiegelt.
