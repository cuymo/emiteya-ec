// Codemod de un solo uso (adopt-premium-design-foundation-and-shell, design D3): pasa la escala de
// espaciado del frontend de base 8 (`--spacing: 0.5rem`) a base 4 (`0.25rem`) sin cambiar ninguna
// medida efectiva. Duplica el número de cada utilidad de Tailwind 4 que multiplica `--spacing`, solo
// dentro de los literales de cadena y de plantilla de `frontend/src`, y fija la escala nueva en
// `globals.css`. No es idempotente: se niega a ejecutarse si la escala ya es de base 4.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** Utilidades cuyo valor numérico es `n × --spacing` en Tailwind 4. */
export const SPACING_UTILITIES: readonly string[] = [
  ...["p", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe"],
  ...["m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me"],
  ...["gap", "gap-x", "gap-y", "space-x", "space-y"],
  ...["w", "h", "size", "min-w", "min-h", "max-w", "max-h"],
  ...["inset", "inset-x", "inset-y", "top", "right", "bottom", "left", "start", "end"],
  ...["translate-x", "translate-y", "basis", "indent", "leading"],
  ...["scroll-m", "scroll-mx", "scroll-my", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
  ...["scroll-ms", "scroll-me", "scroll-p", "scroll-px", "scroll-py", "scroll-pt", "scroll-pr"],
  ...["scroll-pb", "scroll-pl", "scroll-ps", "scroll-pe"],
  ...["border-spacing", "border-spacing-x", "border-spacing-y"],
];

const UTILITY = new RegExp(
  `^(!?)(-?)(${[...SPACING_UTILITIES].sort((a, b) => b.length - a.length).join("|")})-(\\d+(?:\\.\\d+)?)(!?)$`,
);

/** Índice de los `:` de variante que están fuera de corchetes y paréntesis. */
function variantSplit(token: string): number {
  let depth = 0;
  let last = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) last = index;
  }
  return last;
}

/** Reescribe un token de clase; devuelve el mismo token si no es una utilidad de espaciado. */
export function rebaseToken(token: string): string {
  const split = variantSplit(token);
  const prefix = token.slice(0, split + 1);
  const utility = token.slice(split + 1);
  const match = UTILITY.exec(utility);
  if (!match) return token;
  const [, leading, negative, name, value, trailing] = match;
  const number = Number(value);
  if (number === 0) return token;
  return `${prefix}${leading}${negative}${name}-${String(number * 2)}${trailing}`;
}

/** Reescribe cada token separado por espacios de un texto de literal. */
export function rebaseText(text: string): string {
  return text.replace(/[^\s]+/g, (token) => rebaseToken(token));
}

type Edit = { start: number; end: number; text: string };

/** Literales de cadena y de plantilla del archivo, con su contenido sin delimitadores. */
export function rebaseSource(
  fileName: string,
  source: string,
): { output: string; changes: string[] } {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const edits: Edit[] = [];
  const changes: string[] = [];
  const visit = (node: ts.Node) => {
    // Los especificadores de módulo no son clases.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    let open = 0;
    let close = 0;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      open = 1;
      close = 1;
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      open = 1;
      close = 2;
    } else if (ts.isTemplateTail(node)) {
      open = 1;
      close = 1;
    }
    if (open > 0) {
      const start = node.getStart(file) + open;
      const end = node.getEnd() - close;
      const raw = source.slice(start, end);
      const text = rebaseText(raw);
      if (text !== raw) {
        edits.push({ start, end, text });
        const { line } = file.getLineAndCharacterOfPosition(start);
        changes.push(`${line + 1}: ${raw.trim()} → ${text.trim()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return { output, changes };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export const BASE_8 = "--spacing: 0.5rem;";
export const BASE_4 = "--spacing: 0.25rem;";

/** Ejecuta el codemod sobre `frontend/src` del repositorio y devuelve el código de salida. */
export function run(root: string, log: (line: string) => void = console.log): number {
  const frontendSrc = join(root, "frontend", "src");
  const globals = join(frontendSrc, "app", "globals.css");
  const css = readFileSync(globals, "utf8");
  if (css.includes(BASE_4) || !css.includes(BASE_8)) {
    log("rebase-spacing-to-4px: la escala ya no es de base 8; el codemod no se vuelve a ejecutar.");
    return 1;
  }
  let total = 0;
  for (const path of sourceFiles(frontendSrc)) {
    const source = readFileSync(path, "utf8");
    const { output, changes } = rebaseSource(path, source);
    if (changes.length === 0) continue;
    writeFileSync(path, output);
    total += changes.length;
    log(`${relative(root, path)} (${changes.length})`);
    for (const change of changes) log(`  ${change}`);
  }
  writeFileSync(globals, css.replace(BASE_8, BASE_4));
  log(`rebase-spacing-to-4px: ${total} literales reescritos; --spacing pasa a 0.25rem.`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = run(join(import.meta.dirname, "..", ".."));
}
