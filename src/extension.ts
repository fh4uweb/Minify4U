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

// Why a build did or did not produce output. On save most outcomes stay silent
// on purpose; the "Minify Current File" command turns every one of them into an
// answer, because a save that does nothing is otherwise indistinguishable from
// a broken extension.
type Outcome =
  | { kind: "written"; rel: string; setting: string }
  | { kind: "noRule"; setting: string }
  | { kind: "disabled" }
  | { kind: "alreadyMinified" }
  | { kind: "notDependent" }
  | { kind: "error"; message: string };

// The rule that applies, plus the setting that decided it ("rules" or
// "output.<lang>"). `rule` is undefined when nothing applies — `setting` still
// names what was consulted, which is exactly what the user needs to be told.
interface Resolved {
  rule: Rule | undefined;
  setting: string;
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

// Folders already told that Minify4U is switched off, so the notification does
// not repeat on every save. Reset whenever the setting changes.
const disabledWarned = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Minify4U");
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void handleSave(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "minify4u.minifyCurrentFile",
      (target?: vscode.Uri) => minifyCurrentFile(target)
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("minify4u")) {
        return;
      }
      // Switching the extension back on and off again should warn again, and a
      // changed exclude list can invalidate which files the cached dependencies
      // were collected from.
      disabledWarned.clear();
      sassDeps.clear();
    })
  );

  output.appendLine("Minify4U activated.");
}

// Saving stays quiet unless there is something to say — otherwise the channel
// would fill up in every project. This command is the deliberate question:
// it runs the same pipeline on the active file and always answers, as a
// notification rather than a line nobody reads.
// `target` is set when invoked from the explorer context menu, where the active
// editor may be something else entirely; from the palette or the editor menu it
// is the file in front of the user.
async function minifyCurrentFile(target?: vscode.Uri): Promise<void> {
  const doc = await resolveDocument(target);
  if (!doc) {
    void tell("warn", "No file is open.");
    return;
  }

  const name = path.basename(doc.fileName);

  if (doc.uri.scheme !== "file") {
    void tell("warn", `${name} is not a file on disk.`);
    return;
  }
  if (doc.isDirty) {
    // Sass compiles from disk, so an unsaved buffer would report the previous
    // content — and saving runs the whole pipeline anyway.
    void tell("warn", `${name} has unsaved changes — save it first.`);
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) {
    void tell("warn", `${name} is outside every workspace folder.`);
    return;
  }

  const config = vscode.workspace.getConfiguration("minify4u", doc.uri);

  if (isExcluded(config, doc, folder)) {
    void tell("info", `${name} is ignored — it matches minify4u.exclude.`);
    return;
  }

  if (isSassPartial(doc)) {
    const built = await rebuildDependents(config, doc, folder);
    void tell(
      "info",
      built.length > 0
        ? `${name} is a partial — rebuilt ${built.join(", ")}.`
        : `${name} is a partial, but no main file imports it.`
    );
    return;
  }

  const outcome = await buildDocument(config, doc, folder);
  switch (outcome.kind) {
    case "written":
      void tell(
        "info",
        `${name} → ${outcome.rel}  (minify4u.${outcome.setting}, from ${originOf(config, outcome.setting)})`
      );
      break;
    case "noRule": {
      const from = originOf(config, outcome.setting);
      // "Set explicitly to empty here" and "nobody ever configured it" both mean
      // no output, but only one of them is something the user did on purpose.
      void tell(
        "warn",
        from === "the default"
          ? `Nothing to do for "${doc.languageId}" — minify4u.${outcome.setting} is not set anywhere.`
          : `Nothing to do for "${doc.languageId}" — minify4u.${outcome.setting} is empty, set by ${from}.`
      );
      break;
    }
    case "disabled":
      void tell(
        "warn",
        `Minify4U is switched off here — minify4u.enable = false, set by ${originOf(config, "enable")}.`
      );
      break;
    case "alreadyMinified":
      void tell("info", `${name} is already minified — skipped.`);
      break;
    case "error":
      // buildDocument already raised the error notification.
      break;
    case "notDependent":
      break;
  }
}

async function resolveDocument(
  target?: vscode.Uri
): Promise<vscode.TextDocument | undefined> {
  if (!target) {
    return vscode.window.activeTextEditor?.document;
  }
  try {
    return await vscode.workspace.openTextDocument(target);
  } catch {
    // Right-clicking a folder, or a binary VS Code refuses to open as text.
    return undefined;
  }
}

async function tell(level: "info" | "warn", message: string): Promise<void> {
  const text = `Minify4U: ${message}`;
  // Called on vscode.window directly — pulling the method into a variable would
  // strip its receiver.
  const pick =
    level === "warn"
      ? await vscode.window.showWarningMessage(text, "Show output")
      : await vscode.window.showInformationMessage(text, "Show output");
  if (pick) {
    output.show(true);
  }
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
        warnDisabledOnce(config, folder);
      }
      return;
    }
    await rebuildDependents(config, doc, folder);
    return;
  }

  const outcome = await buildDocument(config, doc, folder);
  if (outcome.kind === "disabled") {
    warnDisabledOnce(config, folder);
  }
}

// Saving a file that is fully configured and still produces nothing is the one
// case worth interrupting for — a line in the output channel is easy to miss,
// and this exact silence once cost an hour of debugging. Errors already raise
// their own notification; "no output configured" and "already minified" stay
// quiet, since neither means something went wrong.
//
// Once per folder per session: enough to learn about it, not enough to nag while
// working in a project that is switched off on purpose.
function warnDisabledOnce(
  config: vscode.WorkspaceConfiguration,
  folder: vscode.WorkspaceFolder
): void {
  if (disabledWarned.has(key(folder.uri.fsPath))) {
    return;
  }
  disabledWarned.add(key(folder.uri.fsPath));
  void tell(
    "warn",
    `Nothing was written in "${folder.name}" — minify4u.enable = false, set by ${originOf(config, "enable")}.`
  );
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
): Promise<Outcome> {
  const { rule, setting } = resolveRule(config, doc, folder);
  if (!rule) {
    return { kind: "noRule", setting };
  }

  // Report the disabled state only once a rule would actually have applied,
  // so an unrelated save never logs noise — but a save that "should" have
  // produced output explains itself instead of failing silently.
  if (!config.get<boolean>("enable", true)) {
    output.appendLine(
      `✗ ${path.basename(doc.fileName)}: skipped — Minify4U is disabled (minify4u.enable = false)`
    );
    return { kind: "disabled" };
  }

  // Never re-minify an already minified file: it would append the suffix a
  // second time (app.min.js → app.min.min.js) and rewrite vendor bundles that
  // were merely opened and saved.
  if (isAlreadyMinified(doc.fileName, rule.suffix)) {
    output.appendLine(
      `• ${path.basename(doc.fileName)}: skipped — already minified`
    );
    return { kind: "alreadyMinified" };
  }

  try {
    const result = await minifyCode(rule.minifier, doc.getText(), doc.fileName);

    if (result.loadedUrls) {
      sassDeps.set(key(doc.fileName), new Set(result.loadedUrls.map(key)));
    }
    if (onlyIfImports && !result.loadedUrls?.some((u) => key(u) === onlyIfImports)) {
      return { kind: "notDependent" };
    }

    const target = resolveTarget(folder, doc, rule);
    await vscode.workspace.fs.writeFile(target, Buffer.from(result.code, "utf8"));
    const rel = path.relative(folder.uri.fsPath, target.fsPath);
    output.appendLine(`✓ ${path.basename(doc.fileName)} → ${rel}`);
    return { kind: "written", rel, setting };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`✗ ${path.basename(doc.fileName)}: ${msg}`);
    void vscode.window.showErrorMessage(`Minify4U: ${msg}`);
    return { kind: "error", message: msg };
  }
}

// Rebuilds every main file that imports the saved partial.
async function rebuildDependents(
  config: vscode.WorkspaceConfiguration,
  partial: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): Promise<string[]> {
  const name = path.basename(partial.fileName);
  const partialKey = key(partial.fileName);
  const candidates = await findCandidateMains(config, partial.fileName, folder);

  if (candidates.length === 0) {
    output.appendLine(`• ${name}: partial saved — no main file found to rebuild`);
    return [];
  }

  const built: string[] = [];
  for (const main of candidates) {
    // A main already known not to import this partial needs no compile at all.
    const known = sassDeps.get(key(main));
    if (known && !known.has(partialKey)) {
      continue;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(main));
    const outcome = await buildDocument(config, doc, folder, partialKey);
    if (outcome.kind === "written") {
      built.push(path.basename(main));
    }
  }

  if (built.length === 0) {
    output.appendLine(`• ${name}: partial saved — no main file imports it`);
  }
  return built;
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

// Picks the rule to apply: the first matching `rules` entry (globs/exceptions,
// they win), otherwise the per-language `output.<lang>` setting. `setting` names
// whichever one decided, so the outcome can be explained without re-deriving it.
function resolveRule(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): Resolved {
  const rules = config.get<Rule[]>("rules", []);
  const rule = rules.find((r) => matches(r, doc, folder));
  if (rule) {
    return { rule, setting: "rules" };
  }

  const setting = `output.${doc.languageId}`;

  // Empty = language disabled (e.g. leave "scss" empty to let a dedicated
  // Sass compiler handle it instead).
  const savePath = config.get<string>(setting)?.trim();
  if (!savePath) {
    return { rule: undefined, setting };
  }

  const def = LANG_DEFAULTS[doc.languageId];
  if (!def) {
    output.appendLine(
      `✗ ${doc.languageId}: no default minifier mapping — please configure it via "minify4u.rules" with "minifier"/"suffix".`
    );
    return { rule: undefined, setting };
  }

  return {
    rule: {
      type: doc.languageId,
      savePath,
      suffix: def.suffix,
      minifier: def.minifier
    },
    setting
  };
}

// Which level actually supplied a value. The settings editor shows the effective
// value but not where it came from — the cause of every "but the field is empty"
// confusion: an empty field means "this level says nothing", not "off".
function originOf(
  config: vscode.WorkspaceConfiguration,
  setting: string
): string {
  const info = config.inspect(setting);
  if (info?.workspaceFolderValue !== undefined) {
    return "this project";
  }
  if (info?.workspaceValue !== undefined) {
    return "the workspace";
  }
  if (info?.globalValue !== undefined) {
    return "your user settings";
  }
  return "the default";
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
