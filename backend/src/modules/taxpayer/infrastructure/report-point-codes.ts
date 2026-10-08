// Códigos del establecimiento y del punto de emisión para la hoja "Filtros" de los reportes
// (add-reports-export, design D6): el filtro llega como identificador y el XLSX muestra su código.
// Solo de la empresa; un identificador de otra empresa no tiene código.
import type { DbClient } from "../../../platform/db/database.ts";

export async function reportPointCodes(
  db: DbClient,
  companyId: string,
  ids: Readonly<{ establishmentId?: string; emissionPointId?: string }>,
): Promise<{ establishment: string | null; emissionPoint: string | null }> {
  const [establishment, point] = await Promise.all([
    ids.establishmentId
      ? db.establishment.findFirst({
          where: { companyId, id: ids.establishmentId },
          select: { code: true },
        })
      : null,
    ids.emissionPointId
      ? db.emissionPoint.findFirst({
          where: { companyId, id: ids.emissionPointId },
          select: { code: true, establishment: { select: { code: true } } },
        })
      : null,
  ]);
  return {
    establishment: establishment?.code ?? null,
    emissionPoint: point ? `${point.establishment.code}-${point.code}` : null,
  };
}
