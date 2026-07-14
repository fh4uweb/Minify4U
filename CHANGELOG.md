# Changelog

Alle nennenswerten Änderungen an Minify4U.
Format orientiert an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.2.0] – 2026-07-14

### Hinzugefügt
- Mehrsprachen-Unterstützung: **SCSS/SASS** und **LESS** (kompilieren + minifizieren zu CSS),
  **HTML** (html-minifier-terser), **JSON/JSONC** (jsonc-parser).
- Einstellung **`minify4u.output`** – einfache Zuordnung *Sprache → Ausgabe-Ordner*;
  Minifier und Endung werden je Sprache automatisch gewählt.
- Minifier **`json-pretty`** – JSONC in lesbare JSON umwandeln (Kommentare/Trailing-Commas
  entfernt, eingerückt).
- Extension-Icon.

### Geändert
- Abhängigkeiten werden als `node_modules` mit ausgeliefert (`sass`/`less` sind nicht bündelbar).

## [0.1.0] – 2026-07-14

### Hinzugefügt
- Erste Version: JavaScript (Terser) und CSS (clean-css) beim Speichern minifizieren.
- Einstellung **`minify4u.rules`** – Ausgabe-Pfad, Endung und Minifier je Glob/Dateityp.
