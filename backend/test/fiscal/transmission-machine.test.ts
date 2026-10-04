// Máquina de la transmisión (add-sri-transmission, tarea 7.1, design D3): la tabla del dominio, sus
// terminales y causas, I-15 e I-16, y la doble defensa: el trigger de la migración repite la tabla.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_STATES,
  TERMINAL_STATES,
  TRANSITION_CAUSES,
  canTransition,
} from "../../src/modules/fiscal/domain/document.ts";

const MIGRATION = fileURLToPath(
  new URL(
    "../../prisma/migrations/20261005100000_add_sri_transmission/migration.sql",
    import.meta.url,
  ),
);
const allowed = () =>
  DOCUMENT_STATES.flatMap((from) =>
    DOCUMENT_STATES.filter((to) => to !== from && canTransition(from, to)).map(
      (to) => `${from}>${to}`,
    ),
  );

describe("máquina de la transmisión", () => {
  it("permite exactamente las transiciones de design D3", () => {
    expect(allowed().sort()).toEqual(
      [
        "RESERVED>SIGNED",
        "SIGNED>RECEIVED",
        "SIGNED>RETURNED",
        "SIGNED>SEND_UNKNOWN",
        "SEND_UNKNOWN>RECEIVED",
        "SEND_UNKNOWN>AUTHORIZED",
        "SEND_UNKNOWN>NOT_AUTHORIZED",
        "SEND_UNKNOWN>RETURNED",
        "SEND_UNKNOWN>MANUAL_REVIEW",
        "RECEIVED>AUTHORIZED",
        "RECEIVED>NOT_AUTHORIZED",
        "RECEIVED>MANUAL_REVIEW",
        "MANUAL_REVIEW>RECEIVED",
        "MANUAL_REVIEW>AUTHORIZED",
        "MANUAL_REVIEW>NOT_AUTHORIZED",
      ].sort(),
    );
  });

  it("los terminales no salen; devuelto tampoco en este cambio", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["AUTHORIZED", "NOT_AUTHORIZED"]);
    for (const from of ["AUTHORIZED", "NOT_AUTHORIZED", "RETURNED"] as const) {
      expect(DOCUMENT_STATES.filter((to) => canTransition(from, to))).toEqual([]);
    }
  });

  it("I-15 e I-16: ni RECIBIDA autoriza ni un resultado incierto concluye no autorizado", () => {
    expect(canTransition("SIGNED", "AUTHORIZED")).toBe(false);
    expect(canTransition("SIGNED", "NOT_AUTHORIZED")).toBe(false);
    expect(canTransition("SIGNED", "MANUAL_REVIEW")).toBe(false);
    expect(canTransition("RECEIVED", "RETURNED")).toBe(false);
    expect(canTransition("MANUAL_REVIEW", "RETURNED")).toBe(false);
    expect(canTransition("MANUAL_REVIEW", "SEND_UNKNOWN")).toBe(false);
  });

  it("las causas son las de la emisión, la firma y la transmisión", () => {
    expect(TRANSITION_CAUSES).toEqual([
      "EMISSION",
      "SIGNING",
      "TRANSMISSION",
      "AUTHORIZATION",
      "RECONCILIATION",
    ]);
  });

  it("el trigger de la base de datos permite las mismas transiciones (doble defensa)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const block =
      /NOT IN \(([\s\S]*?\))\) THEN\s+RAISE EXCEPTION 'transición de estado no permitida/.exec(
        sql,
      )![1]!;
    const pairs = [...block.matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)'\)/g)].map(
      ([, a, b]) => `${a}>${b}`,
    );
    expect(pairs.sort()).toEqual(allowed().sort());
  });
});
