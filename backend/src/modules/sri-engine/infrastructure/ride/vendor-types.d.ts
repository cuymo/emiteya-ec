// Tipos mínimos de pdfmake 0.3 y fontkit 2, solo lo que usa el RIDE (ADR 0022). `@types/pdfmake`
// declara `/// <reference lib="dom" />` y mete los globales del navegador en todo el programa del
// backend (por ejemplo, cambia el tipo del cuerpo de `fetch`): no se usa. fontkit no publica tipos.

declare module "pdfmake" {
  export type Content = string | Readonly<Record<string, unknown>> | readonly Content[];
  export type TableCell = string | Readonly<Record<string, unknown>>;
  export type DocumentDefinition = Readonly<Record<string, unknown>> & { content: Content };
  type FontFiles = Readonly<Record<"normal" | "bold" | "italics" | "bolditalics", string>>;
  type TableLayout = Readonly<Record<string, (...args: never[]) => number | string>>;
  interface CreatedPdf {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfMake {
    readonly virtualfs: { writeFileSync(name: string, content: Buffer): void };
    setFonts(fonts: Readonly<Record<string, FontFiles>>): void;
    setUrlAccessPolicy(policy: (url: string) => boolean): void;
    setLocalAccessPolicy(policy: (path: string) => boolean): void;
    setTableLayouts(layouts: Readonly<Record<string, TableLayout>>): void;
    createPdf(definition: DocumentDefinition): CreatedPdf;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}

declare module "fontkit" {
  export interface Font {
    readonly numGlyphs: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Buffer): Font;
}
