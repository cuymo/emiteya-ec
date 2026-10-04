// Ayudas de las pruebas del inventario (add-minimal-inventory): productos con o sin marca de control
// y la invariante del kárdex.
import { expect } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { reconcileStock } from "../../src/modules/inventory/infrastructure/reconciliation.ts";
import { sumExact } from "../../src/platform/decimal/fiscal-decimal.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";

let sequence = 0;

/** Producto de la empresa con IVA 15 %, marcado o no como controlado. */
export async function insertProduct(
  prisma: PrismaClient,
  company: FiscalCompany,
  options: {
    stockTracked?: boolean;
    kind?: "GOOD" | "SERVICE";
    name?: string;
    mainCode?: string;
  } = {},
): Promise<string> {
  sequence += 1;
  const name = options.name ?? `Producto de inventario ${sequence}`;
  return prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        companyId: company.companyId,
        kind: options.kind ?? "GOOD",
        mainCode: options.mainCode ?? null,
        searchMainCode: options.mainCode?.toLowerCase() ?? null,
        name,
        unitPrice: "8.75",
        stockTracked: options.stockTracked ?? true,
        searchName: name.toLowerCase(),
        createdBy: company.adminId,
        updatedBy: company.adminId,
      },
    });
    await tx.productTax.create({
      data: {
        productId: created.id,
        companyId: company.companyId,
        catalogType: "iva-rate",
        entryKey: "4",
      },
    });
    return created.id;
  });
}

/** El saldo de un producto, o null sin inventario inicializado. */
export async function balanceOf(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
): Promise<string | null> {
  const row = await prisma.stockBalance.findUnique({
    where: { companyId_productId: { companyId, productId } },
  });
  return row ? sumExact([row.balance.toFixed()]) : null;
}

/** Cada saldo de la empresa es la suma de su kárdex y el saldo después del último movimiento. */
export async function expectReconciled(prisma: PrismaClient, companyId?: string): Promise<void> {
  expect(await reconcileStock(prisma, companyId)).toEqual([]);
}
