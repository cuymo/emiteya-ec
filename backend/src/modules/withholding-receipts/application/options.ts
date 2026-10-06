// Opciones del borrador y búsqueda de proveedores (add-withholding-receipts, design D3, D6, D7 a D10,
// D21 y D25). Las opciones son solo las entradas utilizables para la empresa en la fecha de hoy: los
// conceptos de renta y los códigos del IVA soportados, vigentes y habilitados; los tipos de documento
// del MVP con sus sustentos compatibles y vigentes; los impuestos del documento con todos sus códigos
// de porcentaje y sus vigencias (se resuelven con la fecha del documento); las formas de pago de la
// empresa; y los límites efectivos de recursos. Los proveedores son los activos con RUC, cédula o
// pasaporte, sin el consumidor final.
import {
  listWithholdingSuppliersQuerySchema,
  type SupportDocumentType,
  type WithholdingLimits,
  type WithholdingOptionsView,
  type WithholdingTaxCode,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  SUPPORT_TAX_RATE_CATALOGS,
  WITHHELD_IDENTIFICATION_TYPES,
  type CatalogOption,
  type WithheldSubject,
} from "../domain/evaluation.ts";
import type { ContextReads } from "./context.ts";
import type { Page } from "./drafts.ts";

export type WithholdingOptionsDependencies = {
  context: ContextReads;
  authorizer: Authorizer;
  limits: WithholdingLimits;
  today: () => string;
};

const usable = (options: ReadonlyMap<string, CatalogOption>) =>
  [...options.values()]
    .filter((option) => option.usable && option.applicable)
    .map((option) => option.applicable!)
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

export function createWithholdingOptions(deps: WithholdingOptionsDependencies) {
  const { authorizer } = deps;
  const { reads, parties } = deps.context;

  return {
    async options(ctx: RequestContext): Promise<WithholdingOptionsView> {
      authorizer.requirePermission(ctx, "withholdings.draft");
      const date = deps.today();
      const [taxes, income, iva, types, codes, payments] = await Promise.all([
        reads.availability(ctx.companyId, "withholding-tax", date),
        reads.availability(ctx.companyId, "withholding-income-concept", date),
        reads.availability(ctx.companyId, "withholding-iva-code", date),
        reads.availability(ctx.companyId, "support-document-type", date),
        reads.availability(ctx.companyId, "support-code", date),
        reads.availability(ctx.companyId, "payment-method", date),
      ]);
      const supportCodes = new Map(usable(codes).map((code) => [code.code, code]));
      const supportTaxes: WithholdingOptionsView["supportTaxes"] = [];
      for (const tax of ["2", "3", "5"] as const) {
        const entry = await reads.resolve("tax", tax, date);
        if (!entry) continue;
        const versions = await reads.rateVersions(SUPPORT_TAX_RATE_CATALOGS[tax]);
        supportTaxes.push({
          tax,
          label: entry.officialLabel,
          rates: versions
            // El IVA diferenciado no tiene tarifa en el catálogo: no se puede declarar (design D6).
            .filter((version) => version.rateKind !== "DIFFERENTIATED")
            .map((version) => ({
              entryKey: version.entryKey,
              code: version.code,
              label: version.officialLabel,
              rateKind:
                version.rateKind as WithholdingOptionsView["supportTaxes"][number]["rates"][number]["rateKind"],
              percentage: version.percentage,
              effectiveFrom: version.effectiveFrom,
              effectiveTo: version.effectiveTo,
            })),
        });
      }
      return {
        evaluatedOn: date,
        limits: { ...deps.limits },
        withholdingTaxes: usable(taxes).map((tax) => ({
          code: tax.code as WithholdingTaxCode,
          label: tax.officialLabel,
        })),
        incomeConcepts: usable(income).map((entry) => ({
          entryKey: entry.entryKey,
          code: entry.code,
          label: entry.officialLabel,
          percentage: entry.percentage!,
        })),
        ivaCodes: usable(iva).map((entry) => ({
          entryKey: entry.entryKey,
          code: entry.code,
          label: entry.officialLabel,
          percentage: entry.percentage!,
          sourceRef: entry.sourceRef,
        })),
        documentTypes: usable(types).map((type) => ({
          code: type.code as SupportDocumentType,
          label: type.officialLabel,
          supportCodes: (type.allowedSupportCodes ?? [])
            .filter((code) => supportCodes.has(code))
            .map((code) => ({ code, label: supportCodes.get(code)!.officialLabel })),
        })),
        supportTaxes,
        paymentMethods: usable(payments).map((entry) => ({
          entryKey: entry.entryKey,
          code: entry.code,
          label: entry.officialLabel,
        })),
      };
    },

    async suppliers(ctx: RequestContext, query: unknown): Promise<Page<WithheldSubject>> {
      authorizer.requirePermission(ctx, "withholdings.draft");
      const { search, page, pageSize } = parseInput(listWithholdingSuppliersQuerySchema, query);
      const { items, total } = await parties.searchSuppliers(ctx.companyId, {
        search,
        identificationTypes: WITHHELD_IDENTIFICATION_TYPES,
        page,
        pageSize,
      });
      return { items, meta: { page, pageSize, total } };
    },
  };
}

export type WithholdingOptions = ReturnType<typeof createWithholdingOptions>;
