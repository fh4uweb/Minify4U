// Minimale Typdeklaration für html-minifier-terser (Paket liefert keine eigenen Typen).
declare module "html-minifier-terser" {
  export interface Options {
    collapseWhitespace?: boolean;
    removeComments?: boolean;
    removeRedundantAttributes?: boolean;
    minifyCSS?: boolean;
    minifyJS?: boolean;
    [option: string]: unknown;
  }
  export function minify(text: string, options?: Options): Promise<string>;
}
