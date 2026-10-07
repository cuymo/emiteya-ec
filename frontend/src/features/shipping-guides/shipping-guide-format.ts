// Presentación de las guías de remisión (add-shipping-guides, design D25): conteos, el transportista y
// el sustento de cada destinatario. Es presentación: los datos fiscales son del servidor.
import type { ShippingGuideView } from "@facturador/contracts";

export { recipientCountLabel } from "@/features/archive/archive-format";

/** "1 detalle", "3 detalles". */
export const detailCountLabel = (count: number) =>
  count === 1 ? "1 detalle" : `${count} detalles`;

/** "Transporte propio" o "Tercero" según el origen del transportista. */
export const TRANSPORTER_SOURCE_LABELS = { SELF: "Transporte propio", PARTY: "Tercero" } as const;

/** La partida: "Desde el establecimiento 001" o "Otra dirección". */
export const departureSourceLabel = (departure: ShippingGuideView["departure"]) =>
  departure.establishment
    ? `Desde el establecimiento ${departure.establishment.code}`
    : "Otra dirección";
