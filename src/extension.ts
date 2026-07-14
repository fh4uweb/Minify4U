// @file: src/extension.ts
// Minify4U – minifiziert Quelldateien beim Speichern und schreibt den Output
// an einen je Regel (Glob/Typ) konfigurierbaren Pfad relativ zum Workspace-Root.
import * as vscode from "vscode";
import * as path from "path";
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

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Minify4U");
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void handleSave(doc);
    })
  );

  output.appendLine("Minify4U aktiviert.");
}

export function deactivate(): void {
  // nichts aufzuräumen – Subscriptions werden vom Context entsorgt.
}

async function handleSave(doc: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration("minify4u");
  if (!config.get<boolean>("enable", true)) {
    return;
  }
  if (doc.uri.scheme !== "file") {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) {
    return;
  }

  const rule = resolveRule(config, doc, folder);
  if (!rule) {
    return;
  }

  try {
    const code = await minifyCode(rule.minifier, doc.getText(), doc.fileName);
    const target = resolveTarget(folder, doc, rule);
    await vscode.workspace.fs.writeFile(target, Buffer.from(code, "utf8"));
    const rel = path.relative(folder.uri.fsPath, target.fsPath);
    output.appendLine(`✓ ${path.basename(doc.fileName)} → ${rel}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`✗ ${path.basename(doc.fileName)}: ${msg}`);
    void vscode.window.showErrorMessage(`Minify4U: ${msg}`);
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

  const outputMap = config.get<Record<string, string>>("output", {});
  const savePath = outputMap[doc.languageId];
  if (savePath === undefined) {
    return undefined;
  }

  const def = LANG_DEFAULTS[doc.languageId];
  if (!def) {
    output.appendLine(
      `✗ ${doc.languageId}: keine Standard-Minifier-Zuordnung – bitte per "minify4u.rules" mit "minifier"/"suffix" konfigurieren.`
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
): Promise<string> {
  const dir = path.dirname(fileName);

  switch (minifier) {
    case "terser": {
      const result = await terserMinify(code);
      if (result.code === undefined) {
        throw new Error("Terser lieferte keinen Output.");
      }
      return result.code;
    }

    case "clean-css":
      return cleanCss(code);

    case "sass": {
      // .sass = eingerückte Syntax, .scss (Default) = geschweifte Syntax.
      const syntax = fileName.endsWith(".sass") ? "indented" : "scss";
      return sass.compileString(code, {
        style: "compressed",
        syntax,
        loadPaths: [dir]
      }).css;
    }

    case "less": {
      const rendered = await less.render(code, {
        filename: fileName,
        paths: [dir]
      });
      return cleanCss(rendered.css);
    }

    case "html":
      return htmlMinify(code, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        minifyCSS: true,
        minifyJS: true
      });

    case "json":
      return minifyJson(code, 0);

    case "json-pretty":
      return minifyJson(code, 2);

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
      `JSON-Parsefehler (${printParseErrorCode(e.error)}) an Offset ${e.offset}.`
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
  return vscode.Uri.joinPath(folder.uri, rule.savePath, fileName);
}
