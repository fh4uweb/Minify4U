// @file: esbuild.js
// Build-Script für die Extension: bündelt src/extension.ts nach dist/extension.js.
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    // Nur eigenen Code bündeln. Alle npm-Deps bleiben external (sass/less machen
    // dynamische require()s, die ein Single-File-Bundle nicht überleben) und werden
    // als Produktions-node_modules mit der .vsix ausgeliefert (vsce prunt devDeps).
    external: ["vscode"],
    packages: "external",
    sourcemap: !production,
    minify: production,
    logLevel: "info"
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
