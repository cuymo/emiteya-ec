// Reserva atómica del siguiente secuencial (add-fiscal-numbering, design D3 y D4). Operación interna,
// sin ruta HTTP: la invocará add-invoice-emission dentro de su transacción. Un número queda reservado
// cuando esa transacción se confirma; hasta entonces, nadie debe tratarlo como reservado.
import { documentNumber } from "@facturador/contracts";
import { isEmissionPointAvailable } from "../../taxpayer/domain/emission-structure.ts";
import { emissionPointNotFound, emissionPointUnavailable, sequenceExhausted } from "./errors.ts";
import type { FiscalScope, FiscalUnitOfWork, SequenceKey } from "./ports.ts";

export type ReservationInput = SequenceKey &
  Readonly<{ reservedBy: string | null; correlationId: string }>;

export type Reservation = Readonly<{
  reservationId: string;
  sequential: number;
  documentNumber: string;
}>;

/**
 * Reserva dentro de una transacción abierta. El paso 1 es el comienzo de la reserva: si en ese
 * instante el punto o su establecimiento están inactivos se rechaza sin tocar el contador; si estaban
 * activos, la reserva se completa aunque una desactivación se confirme mientras está en curso.
 */
export async function reserveSequentialIn(
  scope: FiscalScope,
  input: ReservationInput,
): Promise<Reservation> {
  const { reservedBy, correlationId, ...key } = input;
  const found = await scope.points.findPointWithEstablishment(key.companyId, key.emissionPointId);
  if (!found || found.establishment.id !== key.establishmentId) throw emissionPointNotFound();
  if (!isEmissionPointAvailable(found.point, found.establishment)) throw emissionPointUnavailable();

  await scope.sequences.ensure(key);
  const sequential = await scope.sequences.increment(key);
  const point = `${found.establishment.code}-${found.point.code}`;
  if (sequential === null) throw sequenceExhausted(key.documentType, point, key.environment);
  await scope.sequences.setLastReserved(key, sequential);
  const { id } = await scope.sequences.record({ key, sequential, reservedBy, correlationId });
  return {
    reservationId: id,
    sequential,
    documentNumber: documentNumber(found.establishment.code, found.point.code, sequential),
  };
}

/** Reserva en su propia transacción; la usan las pruebas y la medición de ERS AC-04. */
export function createSequentialReservation(uow: FiscalUnitOfWork) {
  return {
    reserve: (input: ReservationInput) => uow.run((scope) => reserveSequentialIn(scope, input)),
  };
}
