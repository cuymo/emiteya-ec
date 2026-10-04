// Política de tamaño del envío al SRI (add-sri-transmission, design D17): tabla versionada, cargador,
// resolución por la fecha del envío y consulta HTTP. Usa la POLÍTICA SINTÉTICA DE PRUEBAS del arnés:
// la cifra oficial sigue pendiente (Q-47) y ninguna de estas pruebas la supone.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  DatasetValidationError,
  validateDatasets,
} from "../../src/modules/catalogs/domain/datasets.ts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import {
  SYNTHETIC_POLICY_BYTES,
  installSyntheticSizePolicy,
  syntheticSizePolicy,
} from "../support/synthetic-size-policy.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

const NOW = new Date("2026-10-03T15:00:00Z");

describe("política de tamaño del envío al SRI", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  const cookies: Record<string, string> = {};
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const view = async (who: string, query = "") => {
    const res = await request(api.app)
      .get(`/api/v1/fiscal-catalogs/sri-transmission-policy${query}`)
      .set("Cookie", cookies[who]!);
    expect(res.status).toBe(200);
    return (res.body as { data: Record<string, unknown> }).data;
  };
  const policy = (date: string) =>
    fiscalCatalogQueries(db.database.prisma).sriTransmissionSizePolicy(date);

  beforeAll(async () => {
    db = await createMigratedSchema("sri_transmission_policy");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { now: () => NOW });
    const companyId = await insertCompany(db.database.prisma, "Empresa A");
    for (const [name, email, role] of [
      ["admin", "admin@a.ec", "ADMIN"],
      ["operator", "operador@a.ec", "OPERATOR"],
    ] as const) {
      await createMember(api.uow, companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  it("sin fuente oficial verificada, la versión instalada no publica la política (Q-47)", async () => {
    expect(
      DATASET_FILES.some(
        (file) => (file as { catalogType: string }).catalogType === "sri-transmission-policy",
      ),
    ).toBe(false);
    expect(await policy("2026-10-03")).toBeNull();
    for (const who of ["admin", "operator"]) {
      expect(await view(who)).toEqual({
        source: null,
        at: "2026-10-03",
        applicable: null,
        versions: [],
      });
    }
  });

  describe("con la política sintética del arnés", () => {
    beforeAll(async () => {
      const report = await installSyntheticSizePolicy(db.database.prisma);
      expect(report.applied).toEqual([
        { catalogType: "sri-transmission-policy", version: 1, newEntries: 1 },
      ]);
    });

    it("se resuelve por la fecha del envío; antes de su vigencia no hay política", async () => {
      expect(await policy("2026-07-26")).toBeNull();
      expect(await policy("2026-07-27")).toMatchObject({
        maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES,
        effectiveTo: null,
        datasetVersion: 1,
      });
      expect((await policy("2030-01-01"))?.maxSignedDocumentBytes).toBe(SYNTHETIC_POLICY_BYTES);
    });

    it("ambos roles la consultan con la cifra, el texto, la sección, la unidad y la vigencia", async () => {
      const data = await view("operator");
      expect(data.source).toMatchObject({
        document: "POLÍTICA SINTÉTICA DE PRUEBAS: no es la cifra oficial (Q-47)",
      });
      expect(data.applicable).toMatchObject({
        maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES,
        sourceText: "Texto sintético de pruebas: no cita ninguna fuente oficial.",
        sourceSection: "Sección sintética",
        literalUnit: "bytes (sintético)",
        interpretation: "Cifra sintética de pruebas, sin interpretación oficial.",
        effectiveFrom: "2026-07-27",
        effectiveTo: null,
      });
      expect((await view("admin", "?at=2026-07-01")).applicable).toBeNull();
    });

    it("volver a cargar no cambia nada; alterar lo publicado falla", async () => {
      expect((await installSyntheticSizePolicy(db.database.prisma)).applied).toEqual([]);
      await expect(
        installSyntheticSizePolicy(db.database.prisma, [
          syntheticSizePolicy({ maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES + 1 }),
        ]),
      ).rejects.toThrow("sri-transmission-policy v1: ya aplicado con otro contenido");
    });

    it("una versión nueva de la fuente cierra la anterior y la conserva", async () => {
      const v2 = syntheticSizePolicy({ effectiveTo: "2026-12-31" }, 2);
      v2.versions.push({
        ...v2.versions[0]!,
        maxSignedDocumentBytes: 2 * SYNTHETIC_POLICY_BYTES,
        effectiveFrom: "2027-01-01",
        effectiveFromBasis: "SOURCE_STATED",
        effectiveTo: null,
      });
      // v1 tal como se publicó y v2 con el cierre: la cadena completa de archivos.
      const report = await installSyntheticSizePolicy(db.database.prisma, [
        syntheticSizePolicy(),
        v2,
      ]);
      expect(report.applied).toEqual([
        { catalogType: "sri-transmission-policy", version: 2, newEntries: 1 },
      ]);
      expect(await policy("2026-12-31")).toMatchObject({
        maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES,
        effectiveTo: "2026-12-31",
        datasetVersion: 1,
      });
      expect(await policy("2027-01-01")).toMatchObject({
        maxSignedDocumentBytes: 2 * SYNTHETIC_POLICY_BYTES,
        datasetVersion: 2,
      });
      const rows = await db.database.prisma.sriTransmissionPolicy.findMany({
        orderBy: { effectiveFrom: "asc" },
      });
      expect(rows.map((row) => [row.datasetVersion, row.closedInDatasetVersion])).toEqual([
        [1, 2],
        [2, null],
      ]);
      expect((await view("admin", "?at=2027-02-01")).versions).toHaveLength(2);
    });

    it("la base de datos no admite borrar, alterar lo publicado ni superponer versiones", async () => {
      const prisma = db.database.prisma;
      const first = await prisma.sriTransmissionPolicy.findFirstOrThrow({
        orderBy: { effectiveFrom: "asc" },
      });
      expect(
        await fails(prisma.sriTransmissionPolicy.delete({ where: { id: first.id } })),
      ).toContain("no admite DELETE");
      expect(
        await fails(
          prisma.sriTransmissionPolicy.update({
            where: { id: first.id },
            data: { maxSignedDocumentBytes: 1 },
          }),
        ),
      ).toContain("solo se cierra una vigencia abierta");
      expect(
        await fails(
          prisma.sriTransmissionPolicy.create({
            data: {
              maxSignedDocumentBytes: 1,
              sourceText: "x",
              sourceSection: "x",
              literalUnit: "x",
              interpretation: "x",
              effectiveFrom: new Date("2027-06-01"),
              effectiveFromBasis: "SOURCE_STATED",
              datasetVersion: 3,
            },
          }),
        ),
      ).toContain("versiones superpuestas");
      expect(
        await fails(
          prisma.sriTransmissionPolicy.create({
            data: {
              maxSignedDocumentBytes: 0,
              sourceText: " ",
              sourceSection: "x",
              literalUnit: "x",
              interpretation: "x",
              effectiveFrom: new Date("2020-01-01"),
              effectiveTo: new Date("2020-02-01"),
              effectiveFromBasis: "SOURCE_STATED",
              datasetVersion: 3,
            },
          }),
        ),
      ).toContain("sri_transmission_policy_values_check");
    });
  });

  it("el dataset exige una cifra entera positiva, la cita completa y una vigencia ordenada", () => {
    for (const invalid of [
      syntheticSizePolicy({ maxSignedDocumentBytes: 0 }),
      syntheticSizePolicy({ maxSignedDocumentBytes: 320.5 }),
      syntheticSizePolicy({ sourceText: "" }),
      syntheticSizePolicy({ interpretation: " " }),
      syntheticSizePolicy({ effectiveTo: "2026-01-01" }),
    ]) {
      expect(() => validateDatasets([invalid])).toThrow(DatasetValidationError);
    }
    const reopened = syntheticSizePolicy({}, 2);
    expect(() =>
      validateDatasets([syntheticSizePolicy({ effectiveTo: "2026-12-31" }), reopened]),
    ).toThrow("reabre la versión 2026-07-27");
  });
});
