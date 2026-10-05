// Métricas de las notas de crédito (add-credit-notes, design D20): reservas confirmadas por causa,
// rechazos por capacidad por motivo y las reservas acreditables sin concluir hace más de 24 horas
// (la señal de la alerta: fallar cerrado retiene la capacidad de una nota sin conclusión), leídas de
// la base en cada consulta de las métricas. Sin empresa ni comprobante como etiqueta.
import { Counter, Gauge, type Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { CreditNoteEmissionObserver } from "../application/emission.ts";

/** Antigüedad desde la que una reserva sin conclusión pide atención. */
export const STALE_RESERVATION_MS = 24 * 3_600_000;

export function registerCreditNoteMetrics(
  registry: Registry,
  sources: { prisma: PrismaClient; now?: () => Date },
): CreditNoteEmissionObserver {
  const now = sources.now ?? (() => new Date());
  const reservations = new Counter({
    name: "credit_note_reservations_total",
    help: "Notas de crédito reservadas, por causa.",
    labelNames: ["cause"] as const,
    registers: [registry],
  });
  const conflicts = new Counter({
    name: "credit_note_reservation_conflicts_total",
    help: "Notas de crédito rechazadas por capacidad, por motivo.",
    labelNames: ["reason"] as const,
    registers: [registry],
  });
  new Gauge({
    name: "credit_note_reservations_unconcluded_over_24h",
    help: "Reservas acreditables RESERVED de hace más de 24 horas: notas sin conclusión del SRI (revisión manual o resultado incierto) que retienen la capacidad de su factura.",
    registers: [registry],
    async collect() {
      this.set(
        await sources.prisma.creditReservation.count({
          where: {
            status: "RESERVED",
            reservedAt: { lt: new Date(now().getTime() - STALE_RESERVATION_MS) },
          },
        }),
      );
    },
  });
  return {
    reserved: (cause) => reservations.inc({ cause }),
    conflict: (reason) => conflicts.inc({ reason }),
  };
}
