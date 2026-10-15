// Salida de la revisión visual (design D17): la carpeta de la etiqueta, el manifiesto y las hojas de
// contacto en HTML con su PNG, sacado con el mismo navegador. Con `REVIEW_COMPARE_WITH`, también las
// hojas que ponen cada captura junto a su par de otra etiqueta.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "@playwright/test";
import { sheetOf, WIDTH_ORDER, type Group, type WidthKey } from "./matrix";

const FRONTEND = join(import.meta.dirname, "..", "..");
export const REVIEW_ROOT = join(FRONTEND, ".review", "visual");

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: FRONTEND, encoding: "utf8" }).trim();

/** Commit corto, marcado si el árbol tiene cambios sin commitear. */
export const COMMIT = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain") ? "+cambios" : ""}`;

const today = new Date().toISOString().slice(0, 10);
export const LABEL = process.env.REVIEW_LABEL || `${today}-${COMMIT.replace("+cambios", "")}`;
export const OUTPUT = join(REVIEW_ROOT, LABEL);

const buildFile = join(FRONTEND, ".next", "BUILD_ID");
export const BUILD = existsSync(buildFile) ? readFileSync(buildFile, "utf8").trim() : null;

export type Entry = {
  key: string;
  route: string;
  state: string;
  path: string;
  group: Group;
  width: WidthKey;
  viewport: { width: number; height: number };
  scale: number;
  collapsed: boolean;
  theme: "claro" | "oscuro";
  screenshot: string;
  geometry: string;
  commit: string;
  build: string | null;
  date: string;
};

/** Miniaturas al 30 %, con un mínimo para que un teléfono siga siendo legible. */
const thumbWidth = (viewport: { width: number }) =>
  Math.min(432, Math.max(195, Math.round(viewport.width * 0.3)));

const escape = (value: string) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

function readEntries(folder: string): Entry[] {
  const geometry = join(folder, "geometry");
  if (!existsSync(geometry)) return [];
  return readdirSync(geometry)
    .filter((file) => file.endsWith(".json"))
    .map(
      (file) => (JSON.parse(readFileSync(join(geometry, file), "utf8")) as { meta: Entry }).meta,
    );
}

const PAGE_STYLE = `
  body { margin: 16px; font: 13px/1.4 system-ui, sans-serif; background: #f4f4f5; color: #18181b;
    display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  h1 { font-size: 18px; margin: 0; flex-basis: 100%; }
  p.meta { margin: 0; color: #52525b; flex-basis: 100%; }
  section { padding: 12px; background: #fff; border: 1px solid #d4d4d8; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  .row { display: flex; gap: 12px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #3f3f46; margin-bottom: 4px; }
  img { display: block; border: 1px solid #a1a1aa; background: #fff; }
  .missing { padding: 24px; border: 1px dashed #a1a1aa; color: #71717a; }
`;

const htmlPage = (title: string, meta: string, body: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title>` +
  `<style>${PAGE_STYLE}</style></head><body><h1>${escape(title)}</h1>` +
  `<p class="meta">${escape(meta)}</p>${body}</body></html>\n`;

const image = (src: string, entry: Entry, caption: string) =>
  `<figure><figcaption>${escape(caption)}</figcaption><img src="${escape(src)}" width="${thumbWidth(entry.viewport)}" alt="${escape(entry.key)}"></figure>`;

/** Agrupa las capturas de una hoja por pantalla, estado y tema, con las anchuras en orden. */
function rows(entries: Entry[]): Map<string, Entry[]> {
  const result = new Map<string, Entry[]>();
  for (const entry of [...entries].sort(
    (a, b) => WIDTH_ORDER.indexOf(a.width) - WIDTH_ORDER.indexOf(b.width),
  )) {
    const key = `${entry.route} · ${entry.state} · ${entry.theme} · ${entry.path}`;
    result.set(key, [...(result.get(key) ?? []), entry]);
  }
  return result;
}

async function renderPng(browser: Browser, html: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() =>
    Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
  );
  await page.screenshot({ path: html.replace(/\.html$/, ".png"), fullPage: true });
  await page.close();
}

/** Escribe el manifiesto y las hojas; devuelve las claves de la matriz que no tienen captura. */
export async function writeSheets(
  browser: Browser,
  expected: string[],
): Promise<{ missing: string[]; sheets: string[] }> {
  const entries = readEntries(OUTPUT).sort(
    (a, b) => expected.indexOf(a.key) - expected.indexOf(b.key),
  );
  const present = new Set(
    entries.filter((entry) => existsSync(join(OUTPUT, entry.screenshot))).map((entry) => entry.key),
  );
  const missing = expected.filter((key) => !present.has(key));
  const sheets: string[] = [];
  const meta = `Etiqueta ${LABEL} · commit ${COMMIT} · build ${BUILD ?? "desconocido"}`;

  const bySheet = new Map<string, Entry[]>();
  for (const entry of entries) {
    const sheet = sheetOf(entry);
    bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), entry]);
  }
  for (const [sheet, list] of bySheet) {
    const body = [...rows(list)]
      .map(
        ([title, row]) =>
          `<section><h2>${escape(title)}</h2><div class="row">${row
            .map((entry) => image(`../${entry.screenshot}`, entry, entry.width))
            .join("")}</div></section>`,
      )
      .join("");
    const file = join(OUTPUT, "contact-sheets", `${sheet}.html`);
    writeFileSync(file, htmlPage(`Revisión ${LABEL}: ${sheet}`, meta, body));
    await renderPng(browser, file);
    sheets.push(`contact-sheets/${sheet}.html`, `contact-sheets/${sheet}.png`);
  }

  const compareWith = process.env.REVIEW_COMPARE_WITH;
  if (compareWith) {
    const other = join(REVIEW_ROOT, compareWith);
    const before = new Map(readEntries(other).map((entry) => [entry.key, entry]));
    for (const [sheet, list] of bySheet) {
      const body = list
        .map((entry) => {
          const pair = before.get(entry.key);
          const left = pair
            ? image(`../../${compareWith}/${pair.screenshot}`, pair, compareWith)
            : `<div class="missing">Sin captura en ${escape(compareWith)}</div>`;
          return `<section><h2>${escape(entry.key)}</h2><div class="row">${left}${image(
            `../${entry.screenshot}`,
            entry,
            LABEL,
          )}</div></section>`;
        })
        .join("");
      const file = join(OUTPUT, "contact-sheets", `compare-${compareWith}-${sheet}.html`);
      writeFileSync(file, htmlPage(`${compareWith} frente a ${LABEL}: ${sheet}`, meta, body));
      await renderPng(browser, file);
      sheets.push(
        `contact-sheets/compare-${compareWith}-${sheet}.html`,
        `contact-sheets/compare-${compareWith}-${sheet}.png`,
      );
    }
  }

  writeFileSync(
    join(OUTPUT, "manifest.json"),
    `${JSON.stringify(
      {
        label: LABEL,
        commit: COMMIT,
        build: BUILD,
        date: new Date().toISOString(),
        compareWith: compareWith ?? null,
        missing,
        sheets,
        entries,
      },
      null,
      2,
    )}\n`,
  );
  return { missing, sheets };
}
