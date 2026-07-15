# Minify4U

[English](README.md) · [**Deutsch**](README.de.md)

VS-Code-Extension, die Quelldateien **beim Speichern** minifiziert und den Output an einen
**je Dateityp/Glob frei konfigurierbaren Pfad** schreibt.

Anders als Minifier, die nur *neben* die Quelle schreiben, routet Minify4U jeden Dateityp in
seinen eigenen Ausgabe-Ordner – z. B. Quellen in `src/` kompiliert und minifiziert nach `assets/`.

## Unterstützte Sprachen

| Sprache      | Minifier             | Aktion                    | Endung     |
|--------------|----------------------|---------------------------|------------|
| JavaScript   | terser               | minifizieren              | `.min.js`  |
| CSS          | clean-css            | minifizieren              | `.min.css` |
| SCSS / SASS  | sass                 | **kompilieren** + minif.  | `.min.css` |
| LESS         | less                 | **kompilieren** + minif.  | `.min.css` |
| HTML         | html-minifier-terser | minifizieren              | `.min.html`|
| JSON / JSONC | jsonc-parser         | minifizieren (kompakt)    | `.min.json`|

## Funktionsweise

Bei jedem Speichern bestimmt die Extension die anzuwendende Regel:

1. **`minify4u.rules`** – die **erste** passende Regel (per `glob` oder `type`) gewinnt.
2. Greift keine Regel, wird **`minify4u.output.<sprache>`** herangezogen.

Danach wird die Datei mit dem passenden Minifier minifiziert und nach dem Ziel-Ordner
(relativ zum Ordner-Root) geschrieben, mit der jeweiligen Endung.

**Bereits minifizierte Dateien werden übersprungen.** Aus `app.min.js` entsteht **kein**
`app.min.min.js`, und Vendor-Bundles, die man nur öffnet und speichert, bleiben unangetastet.
Als bereits minifiziert gilt eine Datei, deren Name auf den `suffix` der Regel endet oder
deren Basename auf `.min` endet. Übersprungene Saves melden sich im Output-Channel „Minify4U".

## Sass-Partials

Ein Partial (`_variables.scss`) ist kein eigenes Stylesheet – einzeln kompiliert käme ein
Fragment heraus oder gar nichts, wenn er nur Variablen und Mixins definiert. Minify4U
kompiliert Partials deshalb **nie direkt**. Beim Speichern werden stattdessen die
Hauptdateien neu gebaut, die ihn importieren – auch **indirekt** über andere Partials.

Die Abhängigkeiten werden nicht aus `@use`/`@import` geraten: Dart Sass meldet jede Datei,
die es tatsächlich geladen hat, und Minify4U dreht das um. Zwei Details, die man kennen
sollte:

- **Geschrieben wird nur, was den Partial wirklich importiert.** Alles andere bleibt
  unangetastet – ein Upload-on-Save-Watcher deployt so keine Stylesheets, die sich gar nicht
  geändert haben.
- **Beim ersten Partial-Save nach einem Neustart** sind die Abhängigkeiten noch unbekannt.
  Minify4U läuft dann vom Partial nach oben bis zum ersten Verzeichnis mit einer
  Nicht-Partial-Datei und nimmt dessen Teilbaum als Kandidaten – SCSS an anderer Stelle im
  Projekt (etwa ein Eltern-Theme) wird dabei nie angefasst.

## Konfiguration

### Einfach: Ausgabe-Ordner je Sprache

Für den Normalfall reicht **eine Einstellung je Sprache**. Minifier und Endung werden
automatisch gewählt:

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

Jede dieser Einstellungen nimmt einen Ordner-Pfad relativ zum Ordner-Root entgegen:

| Wert        | Bedeutung |
|-------------|-----------|
| `assets/js` | Output in diesen Ordner schreiben |
| `*`         | Output **neben die Quelldatei** schreiben |
| *(leer)*    | **deaktiviert** – diese Sprache wird ignoriert |

| Einstellung                  | Minifier   | Aktion                    | Endung     |
|------------------------------|------------|---------------------------|------------|
| `minify4u.output.javascript` | terser     | minifizieren              | `.min.js`  |
| `minify4u.output.css`        | clean-css  | minifizieren              | `.min.css` |
| `minify4u.output.scss`       | sass       | **kompilieren** + minif.  | `.min.css` |
| `minify4u.output.sass`       | sass       | **kompilieren** + minif.  | `.min.css` |
| `minify4u.output.less`       | less       | **kompilieren** + minif.  | `.min.css` |
| `minify4u.output.html`       | html       | minifizieren              | `.min.html`|
| `minify4u.output.json`       | json       | minifizieren (kompakt)    | `.min.json`|
| `minify4u.output.jsonc`      | json       | minifizieren (kompakt)    | `.min.json`|

> `minify4u.output.scss` **leer lassen**, wenn ein eigener Sass-Compiler das SCSS schon
> übernimmt – sonst kompilieren beide dieselbe Datei.

> Sprachen ohne Standard-Zuordnung müssen über `minify4u.rules` konfiguriert werden;
> ansonsten erscheint eine Meldung im Output-Channel „Minify4U".

### Dateien ausschließen

`minify4u.exclude` nimmt Globs (relativ zum Ordner-Root), die Minify4U komplett ignoriert –
für alle Sprachen:

```jsonc
{
  "minify4u.exclude": ["**/node_modules/**", "**/.vscode/**", "**/vendor/**"]
}
```

Default ist `["**/node_modules/**", "**/.vscode/**"]`. Das `.vscode` ist wichtiger, als es
aussieht: VS Code behandelt seine eigene `settings.json` als JSONC – ohne diesen Eintrag
würde jede Änderung an der Projektkonfiguration eine minifizierte Kopie davon in den
JSONC-Ausgabe-Ordner schreiben.

### Fein: Regeln für Globs & Sonderfälle

`minify4u.rules` erlaubt Glob-Matching, eigene Endungen und expliziten Minifier. Regeln
haben **Vorrang** vor `minify4u.output.<sprache>`:

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

| Feld       | Pflicht | Beschreibung |
|------------|:------:|--------------|
| `glob`     | –      | Glob relativ zum Ordner-Root. Alternativ `type`. |
| `type`     | –      | VS-Code-Sprach-ID (`javascript`, `css`, `scss`, …). Alternativ zu `glob`. |
| `savePath` | ✓      | Ziel-Ordner relativ zum Ordner-Root. `*` schreibt neben die Quelldatei. |
| `suffix`   | ✓      | Output-Endung (ersetzt die Original-Endung). |
| `minifier` | ✓      | Einer der Werte aus der Minifier-Tabelle unten. |

> Es muss entweder `glob` **oder** `type` gesetzt sein.

> `minify4u.rules` ist ein Array aus Objekten – dafür kann der VS-Code-Settings-Editor kein
> Formular rendern. Also „In settings.json bearbeiten" nutzen (dort gibt es Autocomplete
> für `minifier`).

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
      "glob": "config/**/*.jsonc",
      "savePath": "config",
      "suffix": ".json",
      "minifier": "json-pretty"
    }
  ]
}
```

## Multi-Root-Workspaces

Alle Einstellungen von Minify4U sind **resource-scoped**: die Konfiguration wird für die
*gespeicherte Datei* gelesen. Damit kann jedes Projekt in einem Multi-Root-Workspace eigene
Werte nutzen – ein Projekt schreibt nach `assets/js`, das nächste nach `dist/scripts`, ein
drittes schaltet CSS ganz ab. Dieselbe Einstellung, drei Antworten.

Projektspezifische Werte gehören nach `<projekt>/.vscode/settings.json`. Spezifischer
schlägt allgemeiner:

| Ebene         | Wo                                 | Priorität |
|---------------|------------------------------------|-----------|
| Projekt       | `<projekt>/.vscode/settings.json`  | **höchste** |
| Arbeitsbereich| `*.code-workspace` → `"settings"`  | |
| Benutzer      | globale `settings.json`            | |
| Default       | Vorgabe der Extension              | niedrigste |

> Im Settings-Editor heißt diese Projekt-Ebene **„Ordner"** (engl. „Folder") – sonst sucht
> man vergeblich. Der Reiter erscheint, sobald der Workspace mehr als einen Root-Ordner hat.

**Achtung bei global gesetztem `"minify4u.enable": false`** – das schaltet Minify4U in
*jedem* Projekt stumm ab, das nicht selbst `enable: true` setzt.

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
- Noch keine Source Maps und kein Autoprefixer, und die Sass-Ausgabe ist immer komprimiert –
  eine zusätzliche expandierte `.css` lässt sich nicht erzeugen. Dafür braucht es weiterhin
  einen eigenen Sass-Compiler.

## Lizenz

[MIT](LICENSE) © Frank Hackenberg (4UWeb)
