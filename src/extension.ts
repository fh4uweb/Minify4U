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
  | "sass-expanded"
  | "less"
  | "less-expanded"
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

interface LangDefault {
  minifier: Minifier;
  suffix: string;
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
  | { kind: "written"; wrote: Written[] }
  | { kind: "noRule"; setting: string }
  | { kind: "disabled" }
  | { kind: "alreadyMinified" }
  | { kind: "notDependent" }
  | { kind: "error"; message: string };

// One written file and the setting that asked for it — kept per file rather than
// joined into a string, so each one can still name its own origin.
interface Written {
  rel: string;
  setting: string;
}

// A rule to apply, plus the setting that decided it ("rules", "output.<lang>" or
// "expanded.<lang>").
interface Applied {
  rule: Rule;
  setting: string;
}

// What applies to a document: none, one, or both of minified and expanded output.
// `setting` names what was consulted even when nothing applies — that is exactly
// what the user needs to be told then.
interface Resolved {
  applied: Applied[];
  setting: string;
}

// Standard-Minifier + Endung je Sprache für die einfache `minify4u.output`-Map.
// SCSS/SASS/LESS werden hier kompiliert + minifiziert (→ .min.css).
const LANG_DEFAULTS: Record<string, LangDefault> = {
  javascript: { minifier: "terser", suffix: ".min.js" },
  css: { minifier: "clean-css", suffix: ".min.css" },
  scss: { minifier: "sass", suffix: ".min.css" },
  sass: { minifier: "sass", suffix: ".min.css" },
  less: { minifier: "less", suffix: ".min.css" },
  html: { minifier: "html", suffix: ".min.html" },
  json: { minifier: "json", suffix: ".min.json" },
  jsonc: { minifier: "json", suffix: ".min.json" }
};

// Readable output for `minify4u.expanded.<lang>`, written alongside the minified
// file (main.scss → main.css *and* main.min.css). Only for languages where
// compiling and minifying are two different things: "expanded JavaScript" would
// merely copy the source, and expanded CSS with savePath "*" would overwrite the
// source with itself. JSON already has this through the "json-pretty" minifier.
const EXPANDED_DEFAULTS: Record<string, LangDefault> = {
  scss: { minifier: "sass-expanded", suffix: ".css" },
  sass: { minifier: "sass-expanded", suffix: ".css" },
  less: { minifier: "less-expanded", suffix: ".css" }
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
        `${name} → ${outcome.wrote
          .map(
            (w) =>
              `${w.rel} (minify4u.${w.setting}, from ${originOf(config, w.setting)})`
          )
          .join(" · ")}`
      );
      break;
    case "noRule":
      void tell(
        "warn",
        `Nothing to do for "${doc.languageId}" — ${noRuleReason(config, outcome.setting)}.`
      );
      break;
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
    return;
  }
  // Only for languages Minify4U could handle: every other save (.md, .ts, …)
  // reports "no rule" too, and logging those would drown the channel in noise
  // that says nothing but "this file was never meant for me".
  if (outcome.kind === "noRule" && LANG_DEFAULTS[doc.languageId]) {
    output.appendLine(
      `• ${path.basename(doc.fileName)}: nothing to do — ${noRuleReason(config, outcome.setting)}`
    );
  }
}

// Saving a file that is fully configured and still produces nothing is the one
// case worth interrupting for — a line in the output channel is easy to miss,
// and this exact silence once cost an hour of debugging. Errors already raise
// their own notification; "no output configured" and "already minified" stay out
// of the notifications and only reach the channel, since neither means something
// went wrong.
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
  const { applied, setting } = resolveRules(config, doc, folder);
  if (applied.length === 0) {
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
  // were merely opened and saved. Any applying suffix is reason enough.
  if (applied.some((a) => isAlreadyMinified(doc.fileName, a.rule.suffix))) {
    output.appendLine(
      `• ${path.basename(doc.fileName)}: skipped — already minified`
    );
    return { kind: "alreadyMinified" };
  }

  try {
    const wrote: Written[] = [];

    for (const a of applied) {
      const result = await minifyCode(a.rule.minifier, doc.getText(), doc.fileName);

      if (result.loadedUrls) {
        sassDeps.set(key(doc.fileName), new Set(result.loadedUrls.map(key)));
      }
      // Same source, same imports whatever the style — so this decides for every
      // output at once, before the first of them is written.
      if (onlyIfImports && !result.loadedUrls?.some((u) => key(u) === onlyIfImports)) {
        return { kind: "notDependent" };
      }

      const target = resolveTarget(folder, doc, a.rule);
      await vscode.workspace.fs.writeFile(target, Buffer.from(result.code, "utf8"));
      const rel = path.relative(folder.uri.fsPath, target.fsPath);
      output.appendLine(`✓ ${path.basename(doc.fileName)} → ${rel}`);
      wrote.push({ rel, setting: a.setting });
    }

    return { kind: "written", wrote };
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

// Picks what to build: the first matching `rules` entry (globs/exceptions, they
// win and stay a single output), otherwise the per-language settings — which can
// ask for both a minified and an expanded file from one source. `setting` names
// what decided, so the outcome can be explained without re-deriving it.
function resolveRules(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder
): Resolved {
  const rules = config.get<Rule[]>("rules", []);
  const rule = rules.find((r) => matches(r, doc, folder));
  if (rule) {
    return { applied: [{ rule, setting: "rules" }], setting: "rules" };
  }

  const setting = `output.${doc.languageId}`;
  const minified = languageRule(config, doc, setting, LANG_DEFAULTS[doc.languageId]);
  const expanded = languageRule(
    config,
    doc,
    `expanded.${doc.languageId}`,
    EXPANDED_DEFAULTS[doc.languageId]
  );

  // Configured, but Minify4U has no idea what to run on it. Only worth saying for
  // the minified path: `expanded.<lang>` exists for three languages by design.
  if (
    !minified &&
    !LANG_DEFAULTS[doc.languageId] &&
    config.get<string>(setting)?.trim()
  ) {
    output.appendLine(
      `✗ ${doc.languageId}: no default minifier mapping — please configure it via "minify4u.rules" with "minifier"/"suffix".`
    );
  }

  // Either one alone is a complete setup: expanded-only replaces a dedicated Sass
  // compiler that just writes main.css, minified-only is the classic build.
  const applied = [minified, expanded].filter((a): a is Applied => a !== undefined);
  return { applied, setting };
}

// One per-language setting → one rule, or nothing when the language is switched
// off (empty) or has no default for this kind of output.
function languageRule(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  setting: string,
  def: LangDefault | undefined
): Applied | undefined {
  // Empty = this output is disabled (e.g. leave "scss" empty to let a dedicated
  // Sass compiler handle it instead).
  const savePath = config.get<string>(setting)?.trim();
  if (!savePath || !def) {
    return undefined;
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
// "Set explicitly to empty here" and "nobody ever configured it" both mean no
// output, but only one of them is something the user did on purpose. Shared by
// the notification and the output channel so both can never drift apart.
function noRuleReason(
  config: vscode.WorkspaceConfiguration,
  setting: string
): string {
  const from = originOf(config, setting);
  return from === "the default"
    ? `minify4u.${setting} is not set anywhere`
    : `minify4u.${setting} is empty, set by ${from}`;
}

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

// Would this language write anything here at all — minified, expanded, or both?
// Either one alone means a save was meant to produce something.
function languageOutput(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument
): boolean {
  const set = (setting: string): boolean =>
    (config.get<string>(setting) ?? "").trim().length > 0;
  return set(`output.${doc.languageId}`) || set(`expanded.${doc.languageId}`);
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

    case "sass":
    case "sass-expanded": {
      // Compiled from disk rather than from the editor buffer: onDidSave means
      // both are identical, and the file-based API resolves @use/@import against
      // the real file and reports every loaded file in `loadedUrls`. The indented
      // .sass syntax is derived from the extension automatically.
      const result = sass.compile(fileName, {
        style: minifier === "sass" ? "compressed" : "expanded",
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

    case "less":
    case "less-expanded": {
      const rendered = await less.render(code, {
        filename: fileName,
        paths: [dir]
      });
      // Less has no "style" option — it always renders readable CSS, and the
      // minified variant is that output run through clean-css.
      return {
        code: minifier === "less" ? cleanCss(rendered.css) : rendered.css
      };
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
