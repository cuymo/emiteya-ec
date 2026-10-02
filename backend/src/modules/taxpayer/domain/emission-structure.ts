// Establecimientos y puntos de emisión (design D7). Desactivar un establecimiento no cambia el
// estado propio de sus puntos: al reactivarlo vuelven los que seguían activos.

export type ActiveStatus = "ACTIVE" | "INACTIVE";

/** Un punto está disponible para emitir solo si él y su establecimiento están activos. */
export function isEmissionPointAvailable(
  point: { status: ActiveStatus },
  establishment: { status: ActiveStatus },
): boolean {
  return point.status === "ACTIVE" && establishment.status === "ACTIVE";
}
