// Lista de las guías de remisión de una empresa (add-shipping-guides, design D21 y D22): por número,
// por el transportista congelado en el registro de la guía (identificación o razón social) o por la
// identificación o el nombre de cualquiera de sus destinatarios (la tabla común, con su índice), y por
// estado, las más recientes primero.
import type { DbClient } from "../../../platform/db/database.ts";
import { toStoredDocument } from "../../fiscal/infrastructure/index.ts";
import type { ShippingGuideListReader } from "../application/ports.ts";

export function createShippingGuideListReader(db: DbClient): ShippingGuideListReader {
  return {
    async list(companyId, query) {
      const search = query.search?.trim();
      const where = {
        companyId,
        documentType: "06",
        ...(query.state ? { state: query.state } : {}),
        ...(search
          ? {
              OR: [
                { documentNumber: { contains: search } },
                {
                  shippingGuide: {
                    is: {
                      OR: [
                        { carrierIdentification: { contains: search } },
                        { carrierName: { contains: search, mode: "insensitive" as const } },
                      ],
                    },
                  },
                },
                {
                  recipients: {
                    some: {
                      OR: [
                        { identification: { contains: search } },
                        { name: { contains: search, mode: "insensitive" as const } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.electronicDocument.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.electronicDocument.count({ where }),
      ]);
      return { items: rows.map(toStoredDocument), total };
    },
  };
}
