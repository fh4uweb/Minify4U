// @file: src/extension.ts
// Minify4U – minifiziert Quelldateien beim Speichern und schreibt den Output
// an einen je Regel (Glob/Typ) konfigurierbaren Pfad relativ zum Workspace-Root.
import * as vscode from "vscode";
import * as path from "path";
import { fileURLToPath } from "url";
import { minify as terserMinify } from "terser";
import CleanCSS from "clean-css";
import * as sass from "sass";
import less from "less";
import { minify as htmlMinify } from "html-minifier-terser";
import { parse as jsoncParse, ParseError, printParseErrorCode } from "jsonc-parser";

type Minifier =
  | "terser"
  | "clean-css"
  | "sass"
  | "less"
  | "html"
  | "json"
  | "json-pretty";

interface Rule {
  glob?: string;
  type?: string;
  savePath: string;
  suffix: string;
  minifier: Minifier;
}

interface MinifyResult {
  code: string;
  // Only Dart Sass reports this: every file pulled in via @use/@import/@forward.
  loadedUrls?: string[];
}

// Standard-Minifier + Endung je Sprache für die einfache `minify4u.output`-Map.
// SCSS/SASS/LESS werden hier kompiliert + minifiziert (→ .min.css).
const LANG_DEFAULTS: Record<string, { minifier: Minifier; suffix: string }> = {
  javascript: { minifier: "terser", suffix: ".min.js" },
  css: { minifier: "clean-css", suffix: ".min.css" },
  scss: { minifier: "sass", suffix: ".min.css" },
  sass: { minifier: "sass", suffix: ".min.css" },
  less: { minifier: "less", suffix: ".min.css" },
  html: { minifier: "html", suffix: ".min.html" },
  json: { minifier: "json", suffix: ".min.json" },
  jsonc: { minifier: "json", suffix: ".min.json" }
};

const SASS_LANGUAGES = ["scss", "sass"];
const SASS_IN_DIR = "*.{scss,sass}";
const SASS_IN_TREE = "**/*.{scss,sass}";

let output: vscode.OutputChannel;

// Which files a compiled main file pulled in, reported by Dart Sass itself
// (CompileResult.loadedUrls) — never guessed from @use/@import. Reversed when a
// partial is saved to find the main files that have to be rebuilt.
const sassDeps = new Map<string, Set<string>>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Minify4U");
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void handleSave(doc);
    })
  );

  output.appendLine("Minify4U activated.");
}

export function deactivate(): void {
  // nichts aufzuräumen – Subscriptions werden vom Context entsorgt.
}

async function handleSave(doc: vscode.TextDocument): Promise<void> {
  if (doc.uri.scheme !== "file") {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) {
    return;
  }

  // Resource-scoped: in a multi-root workspace each folder can carry its own
  // .vscode/settings.json, so the config is read for the saved document.
  const config = vscode.workspace.getConfiguration("minify4u", doc.uri);

  if (isExcluded(config, doc, folder)) {
    return;
  }

  // A Sass partial is never a compilation unit of its own — compiling it alone
  // would emit a fragment (_header.scss → _header.min.css). Rebuild whatever
  // imports it instead.
  if (isSassPartial(doc)) {
    if (!config.get<boolean>("enable", true)) {
      if (languageOutput(config, doc)) {
        output.appendLine(
          `✗ ${path.basename(doc.fileName)}: skipped — Minify4U is disabled (minify4u.enable = false)`
        );
      }
      return;
    }
    await rebuildDependents(config, doc, folder);
    return;
  }

  await buildDocument(config, doc, folder);
}

// Compiles/minifies one document and writes the result. `onlyIfImports` is set
// when rebuilding after a partial was saved: the main file is compiled to learn
// its dependencies, but only written when it really imports that partial —
// otherwise an unrelated main would get a fresh mtime on every partial save and
// an upload-on-save watcher would ship it again.
async function buildDocument(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder,
  onlyIfImports?: string
): Promise<boolean> {
  const rule = resolveRule(config, doc, folder);
  if (!rule) {
    return false;
  }

  // Report the disabled state only once a rule would actually have applied,
  // so an unrelated save never logs noise — but a save that "should" have
  // produced output explains itself instead of failing silently.
  if (!config.get<boolean>("enable", true)) {
    output.appendLine(
      `✗ ${path.basename(doc.fileName)}: skipped — Minify4U is disabled (minify4u.enable = false)`
    );
    return false;
  }

  // Never re-minify an already minified file: it would append the suffix a
  // second time (app.min.js → app.min.min.js) and rewrite vendor bundles that
  // were merely opened and saved.
  if (isAlreadyMinified(doc.fileName, rule.suffix)) {
    output.appendLine(
      `• ${path.basename(doc.fileName)}: skipped — already minified`
    );
    return false;
  }

  try {
    const result = await minifyCode(rule.minifier, doc.getText(), doc.fileName);

    if (result.loadedUrls) {
      sassDeps.set(key(doc.fileName), new Set(result.loadedUrls.map(key)));
    }
    if (onlyIfImports && !result.loadedUrls?.some((u) => key(u) === onlyIfImports)) {
      return false;
    }

    const target = resolveTarget(folder, doc, rule);
    await vscode.workspace.fs.writeFile(target, Buffer.from(result.code, "utf8"));
    const rel = path.relative(folder.uri.fsPath, target.fsPath);
    output.appendLine(`✓ ${path.basename(doc.fileName)} → ${rel}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`✗ ${path.basename(doc.fileName)}: ${msg}`);
    void vscode.window.showErrorMessage(`Minify4U: ${msg}`);
    return false;
  }
}

// Rebuilds every main file that imports the saved partial.
async function rebuildDependents(
  config: vscode.WorkspaceConfiguration,
  partial: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): Promise<void> {
  const name = path.basename(partial.fileName);
  const partialKey = key(partial.fileName);
  const candidates = await findCandidateMains(config, partial.fileName, folder);

  if (candidates.length === 0) {
    output.appendLine(`• ${name}: partial saved — no main file found to rebuild`);
    return;
  }

  let built = 0;
  for (const main of candidates) {
    // A main already known not to import this partial needs no compile at all.
    const known = sassDeps.get(key(main));
    if (known && !known.has(partialKey)) {
      continue;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(main));
    if (await buildDocument(config, doc, folder, partialKey)) {
      built++;
    }
  }

  if (built === 0) {
    output.appendLine(`• ${name}: partial saved — no main file imports it`);
  }
}

// Cold start: with an empty dependency cache the importing main is unknown, so
// walk up from the partial to the first directory that holds a non-partial and
// take that subtree. Keeps the search inside the partial's own Sass tree —
// unrelated .scss elsewhere in the project (e.g. a parent theme) stays untouched.
async function findCandidateMains(
  config: vscode.WorkspaceConfiguration,
  partialPath: string,
  folder: vscode.WorkspaceFolder
): Promise<string[]> {
  const exclude = excludeGlob(config);
  const root = key(folder.uri.fsPath);
  let dir = path.dirname(partialPath);

  for (;;) {
    const here = await vscode.workspace.findFiles(
      new vscode.RelativePattern(dir, SASS_IN_DIR),
      exclude
    );
    if (here.some((u) => !isPartialName(u.fsPath))) {
      const tree = await vscode.workspace.findFiles(
        new vscode.RelativePattern(dir, SASS_IN_TREE),
        exclude
      );
      return tree.map((u) => u.fsPath).filter((p) => !isPartialName(p));
    }

    const parent = path.dirname(dir);
    if (key(dir) === root || parent === dir) {
      return [];
    }
    dir = parent;
  }
}

// Bestimmt die anzuwendende Regel: zuerst die erste passende `rules`-Regel
// (Ausnahmen/Globs, haben Vorrang), sonst Fallback auf die `output`-Map je Sprache.
function resolveRule(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): Rule | undefined {
  const rules = config.get<Rule[]>("rules", []);
  const rule = rules.find((r) => matches(r, doc, folder));
  if (rule) {
    return rule;
  }

  // One setting per language, e.g. "minify4u.output.javascript".
  // Empty = language disabled (e.g. leave "scss" empty to let a dedicated
  // Sass compiler handle it instead).
  const savePath = config.get<string>(`output.${doc.languageId}`)?.trim();
  if (!savePath) {
    return undefined;
  }

  const def = LANG_DEFAULTS[doc.languageId];
  if (!def) {
    output.appendLine(
      `✗ ${doc.languageId}: no default minifier mapping — please configure it via "minify4u.rules" with "minifier"/"suffix".`
    );
    return undefined;
  }

  return {
    type: doc.languageId,
    savePath,
    suffix: def.suffix,
    minifier: def.minifier
  };
}

// Windows paths differ in case and separators depending on who reports them
// (VS Code, Dart Sass, Node) — compare them through one normal form.
function key(fileOrPath: string): string {
  return path.normalize(fileOrPath).toLowerCase();
}

function isPartialName(fileName: string): boolean {
  return path.basename(fileName).startsWith("_");
}

function isSassPartial(doc: vscode.TextDocument): boolean {
  return SASS_LANGUAGES.includes(doc.languageId) && isPartialName(doc.fileName);
}

function languageOutput(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument
): string {
  return (config.get<string>(`output.${doc.languageId}`) ?? "").trim();
}

function excludeGlob(config: vscode.WorkspaceConfiguration): string | null {
  const globs = config.get<string[]>("exclude", []);
  if (globs.length === 0) {
    return null;
  }
  return globs.length === 1 ? globs[0] : `{${globs.join(",")}}`;
}

function isExcluded(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): boolean {
  return config
    .get<string[]>("exclude", [])
    .some(
      (glob) =>
        vscode.languages.match(
          { pattern: new vscode.RelativePattern(folder, glob) },
          doc
        ) > 0
    );
}

// Two checks: the rule's own suffix catches custom ones from `minify4u.rules`
// (.compressed.js), the generic ".min" catches vendor bundles whose name follows
// the ecosystem convention even when the active rule uses a different suffix.
function isAlreadyMinified(fileName: string, suffix: string): boolean {
  if (fileName.endsWith(suffix)) {
    return true;
  }
  const base = path.basename(fileName, path.extname(fileName));
  return base.endsWith(".min");
}

function matches(
  rule: Rule,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): boolean {
  if (rule.glob) {
    const pattern = new vscode.RelativePattern(folder, rule.glob);
    return vscode.languages.match({ pattern }, doc) > 0;
  }
  if (rule.type) {
    return doc.languageId === rule.type;
  }
  return false;
}

async function minifyCode(
  minifier: Minifier,
  code: string,
  fileName: string
): Promise<MinifyResult> {
  const dir = path.dirname(fileName);

  switch (minifier) {
    case "terser": {
      const result = await terserMinify(code);
      if (result.code === undefined) {
        throw new Error("Terser produced no output.");
      }
      return { code: result.code };
    }

    case "clean-css":
      return { code: cleanCss(code) };

    case "sass": {
      // Compiled from disk rather than from the editor buffer: onDidSave means
      // both are identical, and the file-based API resolves @use/@import against
      // the real file and reports every loaded file in `loadedUrls`. The indented
      // .sass syntax is derived from the extension automatically.
      const result = sass.compile(fileName, {
        style: "compressed",
        loadPaths: [dir]
      });
      return {
        code: result.css,
        // fileURLToPath throws on anything but file:. Dart Sass does not report
        // built-in modules such as `sass:math` here, but a custom importer could
        // hand back another scheme.
        loadedUrls: result.loadedUrls
          .filter((url) => url.protocol === "file:")
          .map((url) => fileURLToPath(url))
      };
    }

    case "less": {
      const rendered = await less.render(code, {
        filename: fileName,
        paths: [dir]
      });
      return { code: cleanCss(rendered.css) };
    }

    case "html":
      return {
        code: await htmlMinify(code, {
          collapseWhitespace: true,
          removeComments: true,
          removeRedundantAttributes: true,
          minifyCSS: true,
          minifyJS: true
        })
      };

    case "json":
      return { code: minifyJson(code, 0) };

    case "json-pretty":
      return { code: minifyJson(code, 2) };

    default: {
      const exhaustive: never = minifier;
      throw new Error(`Unbekannter Minifier: ${String(exhaustive)}`);
    }
  }
}

function cleanCss(code: string): string {
  const result = new CleanCSS({ returnPromise: false }).minify(code);
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("; "));
  }
  return result.styles;
}

// indent 0 = minifiziert (kompakt); indent > 0 = lesbar eingerückt (json-pretty).
function minifyJson(code: string, indent: number): string {
  const errors: ParseError[] = [];
  const data = jsoncParse(code, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const e = errors[0];
    throw new Error(
      `JSON parse error (${printParseErrorCode(e.error)}) at offset ${e.offset}.`
    );
  }
  return JSON.stringify(data, null, indent);
}

function resolveTarget(
  folder: vscode.WorkspaceFolder,
  doc: vscode.TextDocument,
  rule: Rule
): vscode.Uri {
  const base = path.basename(doc.fileName, path.extname(doc.fileName));
  const fileName = base + rule.suffix;
  // "*" = write next to the source file instead of a workspace-relative folder.
  if (rule.savePath.trim() === "*") {
    return vscode.Uri.file(path.join(path.dirname(doc.fileName), fileName));
  }
  return vscode.Uri.joinPath(folder.uri, rule.savePath, fileName);
}
