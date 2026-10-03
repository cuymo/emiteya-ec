// Catálogo de productos y servicios de la empresa (add-parties-and-products, design D6 a D8, D10,
// D13 y D14). La empresa sale siempre del contexto de la sesión. Las referencias fiscales nuevas o
// cambiadas se validan con la disponibilidad que publica `catalogs` hoy en Ecuador; las invariantes
// del tipo, sobre el estado final de la solicitud. El estado tributario se deriva en cada consulta.
// Solo se auditan las altas, los estados y los cambios de precio o de impuestos.
import {
  changeProductStatusSchema,
  createProductSchema,
  listProductsQuerySchema,
  PRODUCT_TAX_SLOTS,
  updateProductSchema,
  type ProductData,
  type ProductTaxSlot,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  goodsOnlyViolations,
  productChanges,
  productDiffers,
  taxReferences,
  type ProductRecord,
  type TaxReference,
} from "../domain/product.ts";
import {
  isReviewReason,
  referenceReason,
  taxConfiguration,
  type TaxConfiguration,
} from "../domain/tax-configuration.ts";
import {
  goodsOnly,
  mainCodeTaken,
  productChanged,
  productNotFound,
  taxUnavailable,
} from "./errors.ts";
import {
  DuplicateMainCodeError,
  type CatalogAvailability,
  type EntryAvailability,
  type ProductRepository,
  type ProductsUnitOfWork,
  type TaxStatusFilter,
} from "./ports.ts";

export type ProductsDependencies = {
  products: ProductRepository;
  uow: ProductsUnitOfWork;
  catalogs: CatalogAvailability;
  authorizer: Authorizer;
  /** Fecha de hoy en Ecuador: la de la configuración y la de la evaluación del estado. */
  today: () => string;
};

type Availability = Record<ProductTaxSlot, Map<string, EntryAvailability>>;

export type ProductTaxResult = TaxReference & {
  code: string;
  availability: EntryAvailability | null;
};

export type ProductResult = ProductRecord & {
  taxDetails: ProductTaxResult[];
  taxConfiguration: TaxConfiguration & { evaluatedOn: string };
};

export function createProducts({
  products,
  uow,
  catalogs,
  authorizer,
  today,
}: ProductsDependencies) {
  async function availabilityOn(companyId: string, date: string): Promise<Availability> {
    const [iva, ice, irbpnr] = await Promise.all(
      (["iva", "ice", "irbpnr"] as const).map((slot) =>
        catalogs.availability(companyId, PRODUCT_TAX_SLOTS[slot], date),
      ),
    );
    return { iva: iva!, ice: ice!, irbpnr: irbpnr! };
  }

  const lookup = (availability: Availability) => (reference: TaxReference) => {
    const entry = availability[reference.slot].get(reference.entryKey);
    return entry
      ? {
          code: entry.code,
          applicable: entry.applicable !== null,
          withdrawn: entry.withdrawn,
          usable: entry.usable,
          calculationData: entry.calculationData,
        }
      : undefined;
  };

  function toResult(
    product: ProductRecord,
    availability: Availability,
    date: string,
  ): ProductResult {
    const references = taxReferences(product.taxes);
    return {
      ...product,
      taxDetails: references.map((reference) => {
        const entry = availability[reference.slot].get(reference.entryKey) ?? null;
        return { ...reference, code: entry?.code ?? reference.entryKey, availability: entry };
      }),
      taxConfiguration: {
        ...taxConfiguration(references, lookup(availability)),
        evaluatedOn: date,
      },
    };
  }

  /** Claves no utilizables y sin datos de cálculo, para filtrar y contar sin SQL cruzado (D8). */
  function statusSets(availability: Availability): TaxStatusFilter {
    const review: { catalogType: string; entryKey: string }[] = [];
    const incomplete: { catalogType: string; entryKey: string }[] = [];
    for (const slot of ["iva", "ice", "irbpnr"] as const) {
      for (const entryKey of availability[slot].keys()) {
        const reason = referenceReason(
          lookup(availability)({ slot, catalogType: PRODUCT_TAX_SLOTS[slot], entryKey }),
        );
        if (!reason) continue;
        const key = { catalogType: PRODUCT_TAX_SLOTS[slot], entryKey };
        if (isReviewReason(reason)) review.push(key);
        else incomplete.push(key);
      }
    }
    return { review, incomplete };
  }

  /** Valida las referencias nuevas o distintas de las guardadas (design D7). */
  function validateReferences(
    data: ProductData,
    availability: Availability,
    before?: ProductRecord,
  ) {
    for (const reference of taxReferences(data.taxes)) {
      if (before && before.taxes[reference.slot] === reference.entryKey) continue;
      const entry = availability[reference.slot].get(reference.entryKey);
      if (!entry) throw taxUnavailable(reference.slot, reference.entryKey, "NOT_FOUND");
      if (!entry.applicable)
        throw taxUnavailable(reference.slot, reference.entryKey, "NOT_IN_FORCE");
      if (!entry.usable) throw taxUnavailable(reference.slot, reference.entryKey, "DISABLED");
    }
  }

  function validateKind(data: ProductData) {
    const violations = goodsOnlyViolations(data);
    if (violations.length > 0) throw goodsOnly(violations);
  }

  async function requireProduct(ctx: RequestContext, productId: string): Promise<ProductRecord> {
    const product = await products.find(ctx.companyId, productId);
    if (!product) throw productNotFound();
    return product;
  }

  const auditTaxes = (data: ProductData) => ({
    "taxes.iva": data.taxes.iva,
    "taxes.ice": data.taxes.ice,
    "taxes.irbpnr": data.taxes.irbpnr,
  });

  return {
    async list(ctx: RequestContext, query: unknown) {
      authorizer.requirePermission(ctx, "products.read");
      const parsed = parseInput(listProductsQuerySchema, query);
      const date = today();
      const availability = await availabilityOn(ctx.companyId, date);
      const { items, total } = await products.search(
        ctx.companyId,
        parsed,
        statusSets(availability),
      );
      return {
        items: items.map((product) => toResult(product, availability, date)),
        meta: { page: parsed.page, pageSize: parsed.pageSize, total },
      };
    },

    async get(ctx: RequestContext, productId: string): Promise<ProductResult> {
      authorizer.requirePermission(ctx, "products.read");
      const product = await requireProduct(ctx, productId);
      const date = today();
      return toResult(product, await availabilityOn(ctx.companyId, date), date);
    },

    async taxSummary(ctx: RequestContext) {
      authorizer.requirePermission(ctx, "products.read");
      const date = today();
      const summary = await products.taxSummary(
        ctx.companyId,
        statusSets(await availabilityOn(ctx.companyId, date)),
      );
      return { evaluatedOn: date, ...summary };
    },

    async create(ctx: RequestContext, body: unknown): Promise<ProductResult> {
      authorizer.requirePermission(ctx, "products.manage");
      const data = parseInput(createProductSchema, body);
      validateKind(data);
      const date = today();
      const availability = await availabilityOn(ctx.companyId, date);
      validateReferences(data, availability);
      try {
        const created = await uow.run(async (scope) => {
          const product = await scope.products.create(ctx.companyId, data, ctx.userId);
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: "product.created",
            changes: {
              productId: product.id,
              mainCode: product.mainCode,
              auxiliaryCode: product.auxiliaryCode,
              name: product.name,
              kind: product.kind,
              unitPrice: product.unitPrice,
              ...auditTaxes(data),
            },
            correlationId: ctx.requestId,
          });
          return product;
        });
        return toResult(created, availability, date);
      } catch (error) {
        if (error instanceof DuplicateMainCodeError) throw mainCodeTaken(data.mainCode ?? "");
        throw error;
      }
    },

    async update(ctx: RequestContext, productId: string, body: unknown): Promise<ProductResult> {
      authorizer.requirePermission(ctx, "products.manage");
      const { expectedVersion, ...data } = parseInput(updateProductSchema, body);
      const before = await requireProduct(ctx, productId);
      if (before.version !== expectedVersion) throw productChanged();
      const date = today();
      const availability = await availabilityOn(ctx.companyId, date);
      if (!productDiffers(before, data)) return toResult(before, availability, date);
      validateKind(data);
      validateReferences(data, availability, before);
      const changes = productChanges(before, data);
      try {
        const updated = await uow.run(async (scope) => {
          const applied = await scope.products.updateIfVersion(
            ctx.companyId,
            productId,
            expectedVersion,
            data,
            ctx.userId,
          );
          if (!applied) {
            throw (await scope.products.find(ctx.companyId, productId))
              ? productChanged()
              : productNotFound();
          }
          if (changes) {
            await scope.audit.append({
              companyId: ctx.companyId,
              actor: { type: "USER", userId: ctx.userId },
              action: "product.updated",
              changes: { productId, ...changes },
              correlationId: ctx.requestId,
            });
          }
          return (await scope.products.find(ctx.companyId, productId))!;
        });
        return toResult(updated, availability, date);
      } catch (error) {
        if (error instanceof DuplicateMainCodeError) throw mainCodeTaken(data.mainCode ?? "");
        throw error;
      }
    },

    /** Estado deseado: repetirlo no cambia nada ni audita (design D14). */
    async changeStatus(
      ctx: RequestContext,
      productId: string,
      body: unknown,
    ): Promise<ProductResult> {
      authorizer.requirePermission(ctx, "products.changeStatus");
      const { status } = parseInput(changeProductStatusSchema, body);
      const before = await requireProduct(ctx, productId);
      const after = await uow.run(async (scope) => {
        if (
          await scope.products.changeStatusIfDifferent(ctx.companyId, productId, status, ctx.userId)
        ) {
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: status === "INACTIVE" ? "product.deactivated" : "product.reactivated",
            changes: { productId, mainCode: before.mainCode, name: before.name },
            correlationId: ctx.requestId,
          });
        }
        return (await scope.products.find(ctx.companyId, productId)) ?? before;
      });
      const date = today();
      return toResult(after, await availabilityOn(ctx.companyId, date), date);
    },
  };
}

export type Products = ReturnType<typeof createProducts>;
