# Minify4U

[English](README.md) · [**Deutsch**](README.de.md)

[![Marketplace-Version](https://img.shields.io/visual-studio-marketplace/v/4uweb.minify4u?label=Marketplace&color=1f8ceb)](https://marketplace.visualstudio.com/items?itemName=4uweb.minify4u)
[![Installationen](https://img.shields.io/visual-studio-marketplace/i/4uweb.minify4u?label=Installationen)](https://marketplace.visualstudio.com/items?itemName=4uweb.minify4u)
[![Bewertung](https://img.shields.io/visual-studio-marketplace/r/4uweb.minify4u?label=Bewertung)](https://marketplace.visualstudio.com/items?itemName=4uweb.minify4u&ssr=false#review-details)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](LICENSE)

> 🇩🇪 **Neu in 0.8.0: deutsche Oberfläche.** Einstellungen, Meldungen und der Output-Channel
> richten sich nach der Anzeigesprache von VS Code – einzustellen ist nichts.

VS-Code-Extension, die Quelldateien **bei jeder Änderung** minifiziert und den Output an einen
**je Dateityp/Glob frei konfigurierbaren Pfad** schreibt.

Anders als Minifier, die nur *neben* die Quelle schreiben, routet Minify4U jeden Dateityp in
seinen eigenen Ausgabe-Ordner – z. B. Quellen in `src/` kompiliert und minifiziert nach `assets/`.

## Warum Minify4U?

Es vereint, wofür man sonst zwei Werkzeuge braucht – einen Minifier *und* einen CSS-Compiler –
und ergänzt das eine, was beiden meist fehlt: einen frei konfigurierbaren Ausgabe-Pfad je Dateityp.

| | **Minify4U** | Andere Minifier | Andere CSS-Compiler |
|---|:---:|:---:|:---:|
| Frei konfigurierbarer Ausgabe-Pfad je Dateityp | ✅ | – | nur CSS |
| Minifiziert JS / CSS / HTML / JSON | ✅ | ✅ | – |
| Kompiliert SCSS / Sass / LESS | ✅ | – | ✅ |
| Lesbare **und** minifizierte CSS aus einem Durchlauf | ✅ | – | – |
| Source Maps für kompilierte CSS | ✅ | – | ✅ |
| Autoprefixer | ✅ | – | ✅ |
| Sass-Partials – nur abhängige Dateien neu bauen | ✅ | – | – |
| Baut auch Dateien, die **außerhalb des Editors** geschrieben werden | ✅ | – | – |

## Unterstützte Sprachen

| Sprache      | Minifier             | Aktion                    | Endung     |
|--------------|----------------------|---------------------------|------------|
| JavaScript   | terser               | minifizieren              | `.min.js`  |
| CSS          | clean-css            | minifizieren              | `.min.css` |
| SCSS / SASS  | sass                 | **kompilieren** + minif.  | `.min.css` |
| LESS         | less                 | **kompilieren** + minif.  | `.min.css` |
| HTML         | html-minifier-terser | minifizieren              | `.min.html`|
| JSON / JSONC | jsonc-parser         | minifizieren (kompakt)    | `.min.json`|

## Wann gebaut wird

Minify4U beobachtet das Dateisystem – gebaut wird bei **jeder** Änderung an einer Quelldatei:
ein Speichern im Editor, ein `sed` im Terminal, ein Skript, ein Formatter, ein KI-Assistent,
der die Datei direkt schreibt. Genau die sind der Grund: Werkzeuge, die am Editor vorbei
schreiben, landeten bisher in der Quelle und nie im Output.

```jsonc
{ "minify4u.trigger": "watch" }  // Vorgabe
{ "minify4u.trigger": "save" }   // nur Editor-Saves – das Verhalten bis v0.4.1
```

Die beiden schließen sich **gegenseitig aus**, ein Speichern baut also nie doppelt. Auf `save`
umstellen, wo Datei-Watcher unzuverlässig sind – manche Remote-SSH-, WSL- und
Netzlaufwerk-Setups.

Auf die **eigene** Ausgabe reagiert Minify4U nie: Jede Datei, die es schreibt, wird vorher
angemeldet und für einen Moment ignoriert. Ohne das sähe eine kompilierte `main.css` wie eine
frische CSS-Quelle aus und erzeugte eine `main.min.css`, die niemand bestellt hat.

> **Eine im Editor geöffnete Datei mit ungespeicherten Änderungen wird übersprungen**, und der
> Output-Channel sagt das auch. Puffer und Datei auf der Platte gehen dann auseinander, und ein
> Build aus dem Puffer erzeugte einen Output, der zu keinem von beiden passt. Beim Speichern
> läuft der Build wie gewohnt.

## Funktionsweise

Bei jeder Änderung bestimmt die Extension die anzuwendende Regel:

1. **`minify4u.rules`** – die **erste** passende Regel (per `glob` oder `type`) gewinnt.
2. Greift keine Regel, wird **`minify4u.output.<sprache>`** herangezogen – bei SCSS/Sass/LESS
   zusätzlich **`minify4u.expanded.<sprache>`**, siehe unten.

Danach wird die Datei mit dem passenden Minifier minifiziert und nach dem Ziel-Ordner
(relativ zum Ordner-Root) geschrieben, mit der jeweiligen Endung.

**Bereits minifizierte Dateien werden übersprungen.** Aus `app.min.js` entsteht **kein**
`app.min.min.js`, und Vendor-Bundles, die man nur öffnet und speichert, bleiben unangetastet.
Als bereits minifiziert gilt eine Datei, deren Name auf den `suffix` der Regel endet oder
deren Basename auf `.min` endet. Übersprungene Durchläufe melden sich im Output-Channel
„Minify4U".

## Auf Knopfdruck nachfragen

Beim Bauen bleibt Minify4U still, solange es nichts zu melden gibt – sonst würde der
Output-Channel in jedem Projekt volllaufen. Genau das macht einen Durchlauf ohne Wirkung aber
mehrdeutig: nicht konfiguriert, abgeschaltet oder kaputt?

Der Befehl **`Minify4U: Minify Current File`** (Befehlspalette) ist die bewusste Nachfrage.
Er fährt dieselbe Pipeline auf der aktiven Datei und antwortet **immer**, als Meldung:

- `app.js → assets/js/app.min.js`
- `No output configured for "scss" in this folder — set minify4u.output.scss.`
- `Minify4U is switched off here (minify4u.enable = false).`
- `_header.scss is a partial — rebuilt styles.scss.`
- `app.min.js is already minified — skipped.`

Fehler melden sich immer als Pop-up, auch beim automatischen Bauen.

## Lesbares CSS neben der minifizierten Datei

Manche Setups laden schlichtes, nicht minifiziertes CSS – etwa eine `functions.php`, die
`assets/css/main.css` einbindet. Genau das schreibt `minify4u.expanded.<sprache>`, für
**SCSS, Sass und LESS**:

```jsonc
{
  "minify4u.output.scss":   "assets/css",  // main.scss → assets/css/main.min.css
  "minify4u.expanded.scss": "assets/css"   // main.scss → assets/css/main.css
}
```

Wie jede `output.*`-Einstellung gilt das **je Sprache, nicht je Datei**: betroffen ist jede
`.scss` im Ordner. Um eine einzelne Datei herauszugreifen, nimmt man einen
`minify4u.rules`-Eintrag mit dem Minifier `sass-expanded`.

Beide Einstellungen sind unabhängig, nehmen dieselben Werte (Ordner · `*` · leer), und eine
Änderung erzeugt, was man angefordert hat:

- **Beide gesetzt** – die minifizierte **und** die lesbare Datei, aus einem Durchlauf.
- **Nur `expanded`** – nur lesbares CSS. Das ist der Fall, der einen eigenen Sass-Compiler
  ersetzt, dessen Aufgabe das Schreiben einer schlichten `.css` war.
- **Nur `output`** – der klassische Build, unverändert.

Für JavaScript, CSS oder HTML gibt es kein `expanded`: Dort sind Kompilieren und Minifizieren
derselbe Schritt, „expandiert" wäre bloß eine Kopie der Quelle. JSON hat es über den Minifier
`json-pretty` in `minify4u.rules`.

> `expanded` schreibt eine echte Datei – zeigt es auf einen Ordner mit einer handgeschriebenen
> `main.css`, wird die überschrieben.

## Vendor-Prefixe

```jsonc
{ "minify4u.autoprefixer": true }
```

Standardmäßig aus. Angeschaltet läuft jede CSS-Datei, die Minify4U erzeugt – aus **SCSS,
Sass, LESS und reinem CSS**, minifiziert wie lesbar – durch
[Autoprefixer](https://github.com/postcss/autoprefixer). Die Prefixe kommen **vor** dem
Minifizieren rein, und die Source Maps zeigen weiterhin auf die Originalquelle.

**Die Ziel-Browser kommen aus dem Projekt**, nicht aus einer Einstellung: browserslist sucht
vom Quelldatei-Pfad aufwärts nach einem `"browserslist"`-Feld in der `package.json` oder
einer `.browserslistrc`. Das ist Absicht – dieselbe Konfiguration steuert schon dein übriges
Werkzeug, und zwei Orte für dieselbe Aussage sind einer zu viel. Ohne jede Konfiguration
greifen die Defaults von browserslist.

Für Projekte ohne eigene browserslist-Konfiguration übersteuert `minify4u.browserslist`:

```jsonc
{ "minify4u.browserslist": ["> 1%", "last 2 versions", "not dead"] }
```

Jeder Schreibvorgang nennt, wogegen geprefixt wurde – die Ziele sind nie ein stilles Raten:

```
✓ styles.scss → assets/css/styles.min.css (+ .map, prefixed for 14 browsers)
```

Standardmäßig aus, weil Prefixe die ausgelieferten Dateien verändern – das darf nie als
Nebenwirkung eines Updates ankommen.

## Source Maps

```jsonc
{ "minify4u.sourceMaps": true }
```

Ein Schalter, standardmäßig aus. Angeschaltet bekommt jede CSS-Datei, die aus **SCSS, Sass
oder LESS** kompiliert wurde – minifiziert wie lesbar, auch über `minify4u.rules`-Einträge
mit diesen Compilern – eine `<name>.css.map` daneben plus den `sourceMappingURL`-Kommentar.
Die DevTools zeigen dann die Zeile in der Quelle statt im kompilierten CSS.

Die Quellen sind relativ zur Map referenziert – das funktioniert auf einem Server, der die
lokale Struktur spiegelt. Zusätzlich ist der Quelltext in die Map eingebettet, es
funktioniert also selbst dort, wo der Quellbaum nicht deployt ist.

Standardmäßig aus, weil die Maps neben den Output-Dateien landen: ein Upload-beim-Speichern-
Watcher würde sie mit deployen, und niemand soll durch ein Update Überraschungsdateien
bekommen. Wird der Schalter wieder ausgeschaltet, verschwindet der Kommentar beim nächsten
Durchlauf von selbst – bereits geschriebene `.map`-Dateien bleiben liegen, die einmal von
Hand löschen.

## Sass-Partials

Ein Partial (`_variables.scss`) ist kein eigenes Stylesheet – einzeln kompiliert käme ein
Fragment heraus oder gar nichts, wenn er nur Variablen und Mixins definiert. Minify4U
kompiliert Partials deshalb **nie direkt**. Bei einer Änderung werden stattdessen die
Hauptdateien neu gebaut, die ihn importieren – auch **indirekt** über andere Partials.

Die Abhängigkeiten werden nicht aus `@use`/`@import` geraten: Dart Sass meldet jede Datei,
die es tatsächlich geladen hat, und Minify4U dreht das um. Zwei Details, die man kennen
sollte:

- **Geschrieben wird nur, was den Partial wirklich importiert.** Alles andere bleibt
  unangetastet – ein Upload-on-Save-Watcher deployt so keine Stylesheets, die sich gar nicht
  geändert haben.
- **Beim ersten Partial-Durchlauf nach einem Neustart** sind die Abhängigkeiten noch unbekannt.
  Minify4U läuft dann vom Partial nach oben bis zum ersten Verzeichnis mit einer
  Nicht-Partial-Datei und nimmt dessen Teilbaum als Kandidaten – SCSS an anderer Stelle im
  Projekt (etwa ein Eltern-Theme) wird dabei nie angefasst.

## Konfiguration

### Wo man die Einstellungen ändert

Zwei Wege, dasselbe Ergebnis:

**Im Einstellungs-Fenster** – `Strg+,` (macOS `Cmd+,`), dann oben `@ext:4uweb.minify4u`
eintippen. Damit sind alle Minify4U-Einstellungen beisammen, jede mit ihrer Erklärung. Für den
Normalfall ist das der bequemere Weg; die Beispiele in dieser Datei zeigen JSON, weil es sich
kürzer schreibt.

**In der `settings.json`** – über die Befehlspalette (`Strg+Umschalt+P`) → „Benutzereinstellungen
öffnen (JSON)", oder im Einstellungs-Fenster über das Symbol „In settings.json bearbeiten".

> ⚠ **`minify4u.rules` geht nur in der JSON-Datei.** Ein Array aus Objekten kann das
> Einstellungs-Fenster nicht als Formular darstellen – dort steht nur ein Knopf, der die JSON
> öffnet. Dafür gibt es in der JSON Autovervollständigung für `minifier`.

#### Benutzer oder Arbeitsbereich – und was „geerbt" bedeutet

Das Einstellungs-Fenster hat oben Reiter: **Benutzer** gilt für alle Projekte, **Arbeitsbereich**
nur für das gerade geöffnete (bei mehreren Projektordnern kommt **Ordner** dazu). Das Speziellere
gewinnt.

**Die Stolperfalle:** Ein **leeres Feld** im Reiter „Arbeitsbereich" heißt **nicht** „hier aus",
sondern „hier nichts gesetzt" – es gilt dann weiter der Wert von der Benutzer-Ebene. VS Code
schreibt in so einem Fall *„(Geändert in Benutzer)"* hinter den Namen der Einstellung; genau daran
erkennt man einen geerbten Wert.

Das ist kein Schönheitsfehler, sondern der häufigste Grund für Überraschungen: Wer
`minify4u.output.javascript` einmal auf `*` stellt, hat das in **jedem** Projekt stehen – auch in
solchen, an die er dabei nicht gedacht hat. Deshalb fragt Minify4U beim ersten Mal nach, siehe
[Wenn `*` geerbt ist](#wenn--geerbt-ist).

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
| `minify4u.expanded.scss`     | sass       | **kompilieren**, lesbar   | `.css`     |
| `minify4u.expanded.sass`     | sass       | **kompilieren**, lesbar   | `.css`     |
| `minify4u.expanded.less`     | less       | **kompilieren**, lesbar   | `.css`     |

> Die `expanded.*`-Einstellungen arbeiten neben ihrem `output.*`-Gegenstück – beide setzen
> ergibt beide Dateien aus einem Durchlauf. Siehe [Lesbares CSS neben der minifizierten Datei](#lesbares-css-neben-der-minifizierten-datei).

> `minify4u.output.scss` **leer lassen**, wenn ein eigener Sass-Compiler das SCSS schon
> übernimmt – sonst kompilieren beide dieselbe Datei.

> Sprachen ohne Standard-Zuordnung müssen über `minify4u.rules` konfiguriert werden;
> ansonsten erscheint eine Meldung im Output-Channel „Minify4U".

### Wenn `*` geerbt ist

`*` ist der einzige Ausgabe-Wert **ohne festes Ziel** – geschrieben wird **neben die Quelle**, in
welchem Ordner die auch immer liegt. Einmal in den Benutzer-Einstellungen gesetzt, gilt das für
Projekte, an die man dabei nie gedacht hat; und weil der Watcher auch sieht, was *Build-Werkzeuge*
schreiben, erreicht es Ordner, die niemand gemeint hat: esbuild schreibt `dist/bundle.js`, und
daneben erscheint eine `bundle.min.js`.

Deshalb fragt Minify4U beim ersten Schreiben mit einem **geerbten** `*` nach – einmal je
Einstellung und Projekt:

```
Minify4U put app.min.js next to its source, in "dist" — minify4u.output.javascript
is "*", inherited from your user settings. "dist" looks like a build folder.
What should apply in "mein-projekt"?

  [Keep it here]   [Choose folder…]   [Don't minify here]
```

| Antwort | schreibt in die Projekt-Einstellungen |
|---|---|
| Keep it here | `"*"` – unverändertes Verhalten, nur nicht mehr geerbt |
| Choose folder… | den gewählten Ordner, relativ zum Projekt-Root |
| Don't minify here | `""` – diese Sprache ist im Projekt aus |

Jede Antwort macht den Wert **explizit** – die Frage kommt nie wieder, weder in dieser Sitzung noch
in einer späteren. Einträge aus `minify4u.rules` lösen sie nie aus: Die sind von Hand geschrieben,
also eine Entscheidung und keine Vererbung.

Wird das Bauen abgeschaltet, bleibt liegen, was der vorherige Durchlauf geschrieben hat; der
Output-Channel nennt die Datei, gelöscht wird sie von Hand. **Minify4U löscht nie selbst.**

### Dateien ausschließen

`minify4u.exclude` nimmt Globs (relativ zum Ordner-Root), die Minify4U komplett ignoriert –
für alle Sprachen:

```jsonc
{
  "minify4u.exclude": ["**/node_modules/**", "**/.vscode/**", "**/vendor/**"]
}
```

Übersprungene Dateien nennt der Output-Channel „Minify4U" beim Namen – eine bewusst ignorierte
Datei sieht so nie wie eine kaputte Extension aus.

Default ist `["**/node_modules/**", "**/.vscode/**"]` – Build-Ordner stehen bewusst **nicht** drin,
denn still nicht mehr zu bauen, weil jemand seine Quellen in `build/` liegen hat, wäre schlimmer
als das Problem. Wie dieser Fall stattdessen gelöst ist, steht unter
[Wenn `*` geerbt ist](#wenn--geerbt-ist). Das `.vscode` ist wichtiger, als es
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

| Wert             | Ergebnis |
|------------------|----------|
| `terser`         | JavaScript minifizieren |
| `clean-css`      | CSS minifizieren |
| `sass`           | SCSS/SASS **kompilieren** + minifizieren → CSS |
| `sass-expanded`  | SCSS/SASS **kompilieren** → **lesbares** CSS – *nicht* minifiziert |
| `less`           | LESS **kompilieren** + minifizieren → CSS |
| `less-expanded`  | LESS **kompilieren** → **lesbares** CSS – *nicht* minifiziert |
| `html`           | HTML minifizieren |
| `json`           | JSON/JSONC minifizieren (kompakt) |
| `json-pretty`    | JSON/JSONC in **lesbare** JSON umwandeln (Kommentare/Trailing-Commas raus, eingerückt) – *nicht* minifiziert |

**Beispiel – lesbares CSS aus genau einer Datei.** `minify4u.expanded.<sprache>` gilt für
*jede* Datei dieser Sprache im Ordner; eine Regel ist der Weg, eine einzelne herauszugreifen:

```jsonc
{
  "minify4u.rules": [
    {
      "glob": "files4u/scss/main.scss",
      "savePath": "assets/css",
      "suffix": ".css",
      "minifier": "sass-expanded"
    }
  ]
}
```

> Dabei dran denken: Eine Regel **ersetzt** für die Dateien, auf die sie passt, die
> Sprach-Einstellungen und erzeugt genau **eine** Ausgabe – `output.scss` und
> `expanded.scss` gelten für `main.scss` dann nicht mehr.

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

Alle Einstellungen von Minify4U außer `minify4u.trigger` sind **resource-scoped**: die
Konfiguration wird für die *geänderte Datei* gelesen. Damit kann jedes Projekt in einem
Multi-Root-Workspace eigene
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

## Lizenz

[MIT](LICENSE) © Frank Hackenberg (4UWeb)

---

Entwickelt von **[ForYourWeb](https://4uweb.de)** — Frank Hackenberg, Full Stack Web Developer.
