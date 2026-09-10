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
import postcss from "postcss";
import autoprefixer from "autoprefixer";
// Autoprefixer resolves the browser targets through browserslist anyway; it is
// imported directly to be able to *report* what it resolved to.
import browserslist from "browserslist";

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

// The parts of a version-3 source map this extension touches. Dart Sass, Less
// and clean-css all emit this structure, just with differently shaped sources
// (file: URLs vs. absolute paths) — serializeMap normalizes that.
interface SourceMap {
  version: number | string;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

interface MinifyResult {
  code: string;
  // Only Dart Sass reports this: every file pulled in via @use/@import/@forward.
  loadedUrls?: string[];
  // Raw source map as the compiler handed it over; written by buildDocument.
  map?: SourceMap;
}

// What the settings ask of one build, gathered once per save rather than read
// from the config in every branch.
interface BuildOptions {
  sourceMap: boolean;
  autoprefixer: boolean;
  // Empty = let browserslist find the project's own config (package.json,
  // .browserslistrc) by walking up from the source file.
  browserslist: string[];
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
  map: boolean;
  prefixed: boolean;
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

// The minifiers whose output is CSS — the only ones autoprefixer applies to.
const CSS_MINIFIERS: Minifier[] = [
  "clean-css",
  "sass",
  "sass-expanded",
  "less",
  "less-expanded"
];

function producesCss(minifier: Minifier): boolean {
  return CSS_MINIFIERS.includes(minifier);
}

const SASS_LANGUAGES = ["scss", "sass"];
const SASS_IN_DIR = "*.{scss,sass}";
const SASS_IN_TREE = "**/*.{scss,sass}";

// Extensions the language defaults can build from — the watcher's base pattern.
// `minify4u.rules` may point a glob at anything at all (sftp.jsonc, *.txt), so
// every configured glob gets a watcher of its own on top of this one.
const WATCHED_GLOB = "**/*.{js,mjs,cjs,css,scss,sass,less,html,htm,json,jsonc}";

// Checked before the document is opened: a checkout or an npm install would
// otherwise push thousands of files through the pipeline. Deliberately short —
// "dist"/"build"/"vendor" are excluded from this list because they are somebody's
// source folder often enough, and minify4u.exclude is the setting for that.
const NEVER_WATCHED = ["node_modules", ".git"];

// How long a file Minify4U wrote itself stays invisible to the watcher. Long
// enough to cover the event round-trip, short enough that a real edit right
// afterwards is not swallowed.
const SELF_WRITE_TTL_MS = 3000;

// Collapses the burst of events a single write produces (create + change, plus
// whatever an upload-on-save watcher triggers on top).
const DEBOUNCE_MS = 150;

let output: vscode.OutputChannel;

// Which files a compiled main file pulled in, reported by Dart Sass itself
// (CompileResult.loadedUrls) — never guessed from @use/@import. Reversed when a
// partial is saved to find the main files that have to be rebuilt.
const sassDeps = new Map<string, Set<string>>();

// Folders already told that Minify4U is switched off, so the notification does
// not repeat on every save. Reset whenever the setting changes.
const disabledWarned = new Set<string>();

// Everything Minify4U has just written, so the watcher cannot react to the
// extension's own output. Filled *before* the write, because the event can
// arrive while writeFile is still awaited.
//
// This is the one mechanism the whole watcher hinges on: a naive watcher sees
// main.scss → main.css, treats that CSS as a source, and builds main.min.css
// from it — output nobody asked for, shipped by an upload-on-save watcher a
// second later. isAlreadyMinified() catches the *next* round and keeps it from
// running away forever, but only this stops the phantom build.
const selfWritten = new Map<string, number>();

// One pending build per path, so a burst of events becomes a single build.
const pending = new Map<string, ReturnType<typeof setTimeout>>();

// Disposed and rebuilt whenever the configuration or the folder list changes —
// the set of patterns is derived from minify4u.rules, which can change at
// runtime.
let watchers: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Minify4U");
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      // The two triggers are mutually exclusive on purpose: with both live, an
      // editor save fires this *and* the file event, and every save would build
      // twice. Keeping them exclusive means no de-duplication is needed at all.
      if (triggerMode() !== "save") {
        return;
      }
      void handleChange(doc);
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
      setUpWatchers();
    })
  );

  // A folder added to the workspace brings its own .vscode/settings.json, and
  // with it possibly its own rules — so the patterns have to be re-derived.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => setUpWatchers())
  );

  context.subscriptions.push({ dispose: disposeWatchers });

  setUpWatchers();
  output.appendLine("Minify4U activated.");
}

function triggerMode(): string {
  // Read without a resource: the trigger decides how the extension listens at
  // all, which cannot sensibly differ per folder within one window.
  return vscode.workspace
    .getConfiguration("minify4u")
    .get<string>("trigger", "watch");
}

function disposeWatchers(): void {
  for (const w of watchers) {
    w.dispose();
  }
  watchers = [];
}

// Watches every pattern Minify4U could have something to say about: the known
// extensions, plus each glob from minify4u.rules across all workspace folders.
// A pattern too many is harmless — handleChange drops what has no rule — while
// a missing one means a file silently never builds, which is the exact failure
// this watcher exists to end.
function setUpWatchers(): void {
  disposeWatchers();

  if (triggerMode() !== "watch") {
    output.appendLine("Trigger: editor save (minify4u.trigger = save).");
    return;
  }

  const globs = new Set<string>([WATCHED_GLOB]);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const rules = vscode.workspace
      .getConfiguration("minify4u", folder.uri)
      .get<Rule[]>("rules", []);
    for (const rule of rules) {
      if (rule.glob) {
        globs.add(rule.glob);
      }
    }
  }

  for (const glob of globs) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watchers.push(
      watcher,
      watcher.onDidCreate(onFileEvent),
      watcher.onDidChange(onFileEvent)
      // No onDidDelete: a deleted source has nothing to build, and removing its
      // generated output is the user's call, not the extension's.
    );
  }

  output.appendLine(
    `Trigger: file watcher, ${globs.size} pattern${globs.size === 1 ? "" : "s"}.`
  );
}

function onFileEvent(uri: vscode.Uri): void {
  if (uri.scheme !== "file") {
    return;
  }
  const parts = uri.fsPath.split(/[\\/]/);
  if (parts.some((part) => NEVER_WATCHED.includes(part))) {
    return;
  }
  if (isSelfWritten(uri.fsPath)) {
    return;
  }

  const k = key(uri.fsPath);
  const running = pending.get(k);
  if (running) {
    clearTimeout(running);
  }
  pending.set(
    k,
    setTimeout(() => {
      pending.delete(k);
      void buildFromDisk(uri);
    }, DEBOUNCE_MS)
  );
}

async function buildFromDisk(uri: vscode.Uri): Promise<void> {
  // Re-checked after the debounce: a build kicked off by an earlier event may
  // have written this very file while the timer was running.
  if (isSelfWritten(uri.fsPath)) {
    return;
  }

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    // Deleted again, still being written, or not text at all — nothing to build.
    return;
  }

  // An open editor hands back its *buffer*, not the file on disk. Building that
  // would compile something that exists nowhere — neither what was written nor
  // what the user meant to save. The buffer's own save fires the next event, so
  // nothing is lost; it is said out loud because a silent skip is precisely the
  // bug this watcher was built to end.
  if (doc.isDirty) {
    output.appendLine(
      `• ${path.basename(doc.fileName)}: skipped — the open editor has unsaved changes`
    );
    return;
  }

  await handleChange(doc);
}

// Files Minify4U writes itself are announced here before the write, and the
// watcher ignores them until the entry ages out. A path, not merely a time
// window: one build writes several files, and an unrelated edit in the same
// moment must still get through.
function markSelfWritten(fsPath: string): void {
  selfWritten.set(key(fsPath), Date.now());
}

function isSelfWritten(fsPath: string): boolean {
  const now = Date.now();
  for (const [k, at] of selfWritten) {
    if (now - at > SELF_WRITE_TTL_MS) {
      selfWritten.delete(k);
    }
  }
  // Deliberately not removed on a hit: one write can raise both a create and a
  // change event, and the second would otherwise be treated as a real edit.
  return selfWritten.has(key(fsPath));
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
              `${w.rel}${w.map ? " +map" : ""}${w.prefixed ? " +prefixes" : ""} (minify4u.${w.setting}, from ${originOf(config, w.setting)})`
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

// The one pipeline both triggers lead into — an editor save under
// minify4u.trigger "save", a change on disk under "watch".
async function handleChange(doc: vscode.TextDocument): Promise<void> {
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
    // Said out loud, because silence here is indistinguishable from a broken
    // extension: someone hunting for why nothing is built needs to learn that
    // the file was deliberately skipped, not overlooked.
    output.appendLine(
      `• ${path.basename(doc.fileName)}: ignored — it matches minify4u.exclude`
    );
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
  if (outcome.kind === "written") {
    askAboutInheritedOutputOnce(config, doc, folder, outcome.wrote);
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

// Folder names that almost always hold generated files rather than sources.
// Not a rule, only a hint in the notification's text: every name here could be
// somebody's source folder, and being wrong must not cost anyone a build.
const BUILD_FOLDERS = ["dist", "build", "out"];

// Asked once per setting per folder per session, then never again — and once
// answered, the explicit value it writes keeps it quiet forever.
const inheritedAsked = new Set<string>();

// `*` is the one output setting without a fixed target: it writes beside the
// source, whatever folder that happens to be. Inherited from the user settings
// it therefore applies to projects nobody thought about — and since 0.5.0 the
// watcher also sees what *build tools* write, so it reaches folders no one meant
// to touch. This extension minified its own dist/extension.js that way, and it
// only surfaced because the .vsix had one file too many.
//
// So the question is asked where the ambiguity actually is — not "should I skip
// this folder?" (which treats the symptom, one folder at a time) but "is the
// inherited value what you want here?". Every answer writes an explicit value
// into the project, after which nothing about it is inherited or surprising.
//
// Deliberately not a changed default: excluding dist/build/out out of the box
// would silently stop building for anyone whose sources live there.
function askAboutInheritedOutputOnce(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder,
  wrote: Written[]
): void {
  for (const written of wrote) {
    // `rules` entries are written by hand — that is a decision, not an
    // inheritance, and second-guessing it would be noise.
    if (written.setting === "rules") {
      continue;
    }
    if (config.get<string>(written.setting) !== "*") {
      continue;
    }
    // Inherited means: nothing in this workspace or folder says otherwise.
    const state = config.inspect<string>(written.setting);
    if (
      state?.workspaceFolderValue !== undefined ||
      state?.workspaceValue !== undefined
    ) {
      continue;
    }

    const seen = `${key(folder.uri.fsPath)}::${written.setting}`;
    if (inheritedAsked.has(seen)) {
      continue;
    }
    inheritedAsked.add(seen);
    void offerExplicitOutput(config, doc, folder, written);
    // One question at a time: a second language would queue a second dialog on
    // top of this one, and both write to the same file.
    return;
  }
}

async function offerExplicitOutput(
  config: vscode.WorkspaceConfiguration,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder,
  written: Written
): Promise<void> {
  const dir = path.basename(path.dirname(doc.fileName));
  const looksGenerated = BUILD_FOLDERS.includes(dir.toLowerCase());
  const keep = "Keep it here";
  const choose = "Choose folder…";
  const off = "Don't minify here";

  const pick = await vscode.window.showInformationMessage(
    `Minify4U put ${written.rel.split(/[\\/]/).pop()} next to its source, in "${dir}" — ` +
      `minify4u.${written.setting} is "*", inherited from ${originOf(config, written.setting)}.` +
      (looksGenerated ? ` "${dir}" looks like a build folder.` : "") +
      ` What should apply in "${folder.name}"?`,
    keep,
    choose,
    off
  );
  if (!pick) {
    return;
  }

  let value: string | undefined;
  if (pick === keep) {
    value = "*";
  } else if (pick === off) {
    value = "";
  } else {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: folder.uri,
      openLabel: "Use as output folder"
    });
    if (!picked?.[0]) {
      return;
    }
    const rel = path.relative(folder.uri.fsPath, picked[0].fsPath);
    // savePath is always relative to the folder root, so a target outside it
    // cannot be expressed — better to say so than to write a broken "..\..".
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      void tell(
        "warn",
        `That folder is outside "${folder.name}" — the output folder has to be inside the project. Nothing was changed.`
      );
      return;
    }
    // The project root itself is "" as a relative path, which would read as
    // "disabled"; "." says root and keeps the two apart.
    value = rel === "" ? "." : rel.split(path.sep).join("/");
  }

  try {
    await config.update(
      written.setting,
      value,
      vscode.ConfigurationTarget.WorkspaceFolder
    );
  } catch (err) {
    void tell(
      "warn",
      `Could not write minify4u.${written.setting}: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  output.appendLine(
    `• minify4u.${written.setting} set to ${value === "" ? '"" (off)' : `"${value}"`} for "${folder.name}"`
  );
  if (value !== "*") {
    // Never deleted on the extension's own initiative — but leaving it there
    // without a word is how stale build output survives unnoticed.
    output.appendLine(
      `  ↳ ${written.rel.split(/[\\/]/).join("/")} from the previous build is still there — remove it by hand if you don't want it.`
    );
  }
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
    const opts: BuildOptions = {
      sourceMap: config.get<boolean>("sourceMaps", false),
      autoprefixer: config.get<boolean>("autoprefixer", false),
      browserslist: config.get<string[]>("browserslist", [])
    };
    if (opts.autoprefixer) {
      // browserslist caches which config file it found for the process lifetime,
      // and this process is an editor that stays open for days: without this,
      // editing .browserslistrc would keep prefixing against the old targets
      // until VS Code restarts — silently. Verified against the library.
      browserslist.clearCaches();
    }
    const wrote: Written[] = [];

    for (const a of applied) {
      const result = await minifyCode(
        a.rule.minifier,
        doc.getText(),
        doc.fileName,
        opts
      );

      if (result.loadedUrls) {
        sassDeps.set(key(doc.fileName), new Set(result.loadedUrls.map(key)));
      }
      // Same source, same imports whatever the style — so this decides for every
      // output at once, before the first of them is written.
      if (onlyIfImports && !result.loadedUrls?.some((u) => key(u) === onlyIfImports)) {
        return { kind: "notDependent" };
      }

      const target = resolveTarget(folder, doc, a.rule);
      let code = result.code;
      if (result.map) {
        // Map first: by the time the CSS (and its sourceMappingURL) goes out —
        // possibly straight to a server via upload-on-save — the map it points
        // to already exists.
        const mapName = path.basename(target.fsPath) + ".map";
        const mapPath = target.fsPath + ".map";
        // Announced before the write, not after: under minify4u.trigger "watch"
        // the file event can arrive while writeFile is still being awaited, and
        // an unannounced write is one the watcher would hand straight back.
        markSelfWritten(mapPath);
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(mapPath),
          Buffer.from(serializeMap(result.map, target.fsPath), "utf8")
        );
        code = `${code}${code.endsWith("\n") ? "" : "\n"}/*# sourceMappingURL=${mapName} */\n`;
      }
      markSelfWritten(target.fsPath);
      await vscode.workspace.fs.writeFile(target, Buffer.from(code, "utf8"));
      const rel = path.relative(folder.uri.fsPath, target.fsPath);
      const prefixed = opts.autoprefixer && producesCss(a.rule.minifier);
      const extras = [
        result.map ? "+ .map" : "",
        prefixed
          ? `prefixed for ${browserTargets(opts, doc.fileName).count} browsers`
          : ""
      ].filter(Boolean);
      output.appendLine(
        `✓ ${path.basename(doc.fileName)} → ${rel}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`
      );
      wrote.push({
        rel,
        setting: a.setting,
        map: result.map !== undefined,
        prefixed
      });
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

// The compilers report sources as file: URLs (Dart Sass) or absolute paths
// (Less, clean-css). A browser resolves them against the map's own location,
// so each one is rewritten relative to the map — POSIX separators, which is
// what keeps the map portable to a server that mirrors the local tree.
function serializeMap(map: SourceMap, cssPath: string): string {
  const dir = path.dirname(cssPath);
  map.file = path.basename(cssPath);
  map.sources = map.sources.map((source) => {
    const abs = source.startsWith("file:") ? fileURLToPath(source) : source;
    if (!path.isAbsolute(abs)) {
      return source; // already relative — trust the compiler
    }
    return path.relative(dir, abs).split(path.sep).join("/");
  });
  return JSON.stringify(map);
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
  fileName: string,
  opts: BuildOptions
): Promise<MinifyResult> {
  const dir = path.dirname(fileName);
  const wantMap = opts.sourceMap;

  switch (minifier) {
    case "terser": {
      const result = await terserMinify(code);
      if (result.code === undefined) {
        throw new Error("Terser produced no output.");
      }
      return { code: result.code };
    }

    case "clean-css": {
      // Plain CSS: prefixes go in first, then it is minified. No map here —
      // a css → css map would only point at the file next to it.
      const prefixed = await autoprefix({ code }, fileName, opts);
      return cleanCss(prefixed.code);
    }

    case "sass":
    case "sass-expanded": {
      // Compiled from disk rather than from the editor buffer: onDidSave means
      // both are identical, and the file-based API resolves @use/@import against
      // the real file and reports every loaded file in `loadedUrls`. The indented
      // .sass syntax is derived from the extension automatically.
      const result = sass.compile(fileName, {
        style: minifier === "sass" ? "compressed" : "expanded",
        loadPaths: [dir],
        sourceMap: wantMap,
        // Embed the sources into the map: DevTools then show the SCSS even on a
        // server where the source tree is not deployed.
        sourceMapIncludeSources: wantMap
      });
      return autoprefix(
        {
          code: result.css,
          map: result.sourceMap,
          // fileURLToPath throws on anything but file:. Dart Sass does not
          // report built-in modules such as `sass:math` here, but a custom
          // importer could hand back another scheme.
          loadedUrls: result.loadedUrls
            .filter((url) => url.protocol === "file:")
            .map((url) => fileURLToPath(url))
        },
        fileName,
        opts
      );
    }

    case "less":
    case "less-expanded": {
      const rendered = await less.render(code, {
        filename: fileName,
        paths: [dir],
        // outputSourceFiles embeds the sources, matching sourceMapIncludeSources.
        sourceMap: wantMap ? { outputSourceFiles: true } : undefined
      });
      // Two Less quirks, both verified against the real library: it reports
      // sources relative to the entry file's directory (not absolute like the
      // other compilers), and it plants a guessed sourceMappingURL comment into
      // the CSS. Undo both here, where the base directory is still known —
      // buildDocument appends the comment with the real map name itself.
      const css = rendered.css.replace(
        /\/\*# sourceMappingURL=[^*]*\*\/\s*$/,
        ""
      );
      // Prefixes go in before minifying, so clean-css sees the final
      // declarations and the map is built over the prefixed CSS.
      const prefixed = await autoprefix(
        {
          code: css,
          map: rendered.map
            ? absolutizeSources(JSON.parse(rendered.map) as SourceMap, dir)
            : undefined
        },
        fileName,
        opts
      );
      if (minifier === "less-expanded") {
        return prefixed;
      }
      // Less has no "style" option — it always renders readable CSS, and the
      // minified variant is that output run through clean-css. The map is handed
      // along so the final one points at the .less source, not at the readable
      // intermediate.
      const result = cleanCss(
        prefixed.code,
        prefixed.map ? JSON.stringify(prefixed.map) : undefined
      );
      return {
        code: result.code,
        map: result.map ? absolutizeSources(result.map, dir) : undefined
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

// Adds vendor prefixes, threading any existing map through so the result still
// points at the original source instead of the un-prefixed intermediate.
// `from` is what lets browserslist discover the project's own config by walking
// up from the source file; `to` fixes what the emitted sources are relative to.
async function autoprefix(
  result: MinifyResult,
  fileName: string,
  opts: BuildOptions
): Promise<MinifyResult> {
  if (!opts.autoprefixer) {
    return result;
  }
  const processed = await postcss([
    autoprefixer(
      opts.browserslist.length > 0
        ? { overrideBrowserslist: opts.browserslist }
        : {}
    )
  ]).process(result.code, {
    from: fileName,
    to: fileName,
    map: result.map
      ? {
          prev: JSON.stringify(result.map),
          inline: false,
          // buildDocument appends the comment itself, with the real map name.
          annotation: false,
          sourcesContent: true
        }
      : false
  });
  return {
    ...result,
    code: processed.css,
    map: processed.map
      ? absolutizeSources(
          JSON.parse(processed.map.toString()) as SourceMap,
          path.dirname(fileName)
        )
      : result.map
  };
}

// Which browsers the prefixing targets, and who decided that. Autoprefixer would
// silently fall back to browserslist's defaults, which is exactly the kind of
// invisible decision this extension otherwise refuses to make.
function browserTargets(
  opts: BuildOptions,
  fileName: string
): { count: number; origin: string } {
  const dir = path.dirname(fileName);
  try {
    if (opts.browserslist.length > 0) {
      return {
        count: browserslist(opts.browserslist).length,
        origin: "minify4u.browserslist"
      };
    }
    const found = browserslist.findConfig(dir);
    return {
      count: browserslist(undefined, { path: dir }).length,
      origin: found
        ? "the project's browserslist config"
        : "browserslist defaults"
    };
  } catch (err) {
    // A broken query should be reported by the build itself, not here.
    return { count: 0, origin: "unresolved" };
  }
}

// Compilers report map sources inconsistently: absolute (Dart Sass, via file:
// URLs) or relative to some base only they know (Less, PostCSS). Pin the
// relative ones down while the base is still known — serializeMap trusts what
// it gets and would otherwise emit paths that resolve nowhere.
function absolutizeSources(map: SourceMap, base: string): SourceMap {
  return {
    ...map,
    sources: map.sources.map((s) => {
      if (s.startsWith("file:") || path.isAbsolute(s)) {
        return s;
      }
      return path.resolve(base, s);
    })
  };
}

// With an input map (the less → clean-css chain), clean-css consumes it and
// re-emits a map that points at the original .less source; sourceMapInlineSources
// carries the embedded sources through.
function cleanCss(code: string, inputMap?: string): MinifyResult {
  const cleaner = new CleanCSS(
    inputMap === undefined
      ? { returnPromise: false }
      : { returnPromise: false, sourceMap: true, sourceMapInlineSources: true }
  );
  const result =
    inputMap === undefined ? cleaner.minify(code) : cleaner.minify(code, inputMap);
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("; "));
  }
  return {
    code: result.styles,
    map: result.sourceMap
      ? (JSON.parse(result.sourceMap.toString()) as SourceMap)
      : undefined
  };
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
