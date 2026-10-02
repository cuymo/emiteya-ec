// Consulta y ajuste del siguiente secuencial (add-fiscal-numbering, design D9, D10 y D11). Orden:
// permiso -> pertenencia del punto a la empresa y al establecimiento -> validación -> transacción con
// el ajuste condicional y su evento de auditoría.
import {
  DOCUMENT_TYPES,
  adjustSequenceSchema,
  sequenceParamsSchema,
  sequencesQuerySchema,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type {
  EmissionPointRecord,
  EstablishmentRecord,
  EstablishmentRepository,
} from "../../taxpayer/application/ports.ts";
import { INITIAL_COUNTER, isExhausted, type CounterState } from "../domain/numbering.ts";
import {
  emissionPointNotFound,
  sequenceChanged,
  sequenceExhausted,
  sequenceNumberReserved,
} from "./errors.ts";
import type { FiscalUnitOfWork, SequenceKey, SequenceRepository } from "./ports.ts";

export type CounterEntry = Readonly<{
  establishment: EstablishmentRecord;
  point: EmissionPointRecord;
  key: SequenceKey;
  counter: CounterState;
}>;

export type SequenceAdministrationDependencies = {
  uow: FiscalUnitOfWork;
  sequences: Pick<SequenceRepository, "listForCompany">;
  establishments: Pick<EstablishmentRepository, "list" | "findPointWithEstablishment">;
  authorizer: Authorizer;
};

export function createSequenceAdministration({
  uow,
  sequences,
  establishments,
  authorizer,
}: SequenceAdministrationDependencies) {
  return {
    /** Todos los puntos de la empresa por los seis tipos; los contadores inexistentes, en su valor inicial. */
    async list(ctx: RequestContext, query: unknown): Promise<CounterEntry[]> {
      authorizer.requirePermission(ctx, "sequences.read");
      const { environment } = parseInput(sequencesQuerySchema, query);
      const [all, counters] = await Promise.all([
        establishments.list(ctx.companyId),
        sequences.listForCompany(ctx.companyId, environment),
      ]);
      const byKey = new Map(
        counters.map((stored) => [
          `${stored.key.emissionPointId}:${stored.key.documentType}`,
          stored,
        ]),
      );
      return all.flatMap((establishment) =>
        establishment.emissionPoints.flatMap((point) =>
          DOCUMENT_TYPES.map((documentType) => {
            const stored = byKey.get(`${point.id}:${documentType}`);
            return {
              establishment,
              point,
              key: {
                companyId: ctx.companyId,
                environment,
                establishmentId: establishment.id,
                emissionPointId: point.id,
                documentType,
              },
              counter: stored
                ? { nextNumber: stored.nextNumber, lastReserved: stored.lastReserved }
                : INITIAL_COUNTER,
            };
          }),
        ),
      );
    },

    async adjust(ctx: RequestContext, params: unknown, body: unknown): Promise<CounterEntry> {
      authorizer.requirePermission(ctx, "sequences.adjust");
      const route = parseInput(sequenceParamsSchema, params);
      const found = await establishments.findPointWithEstablishment(
        ctx.companyId,
        route.emissionPointId,
      );
      if (!found || found.establishment.id !== route.establishmentId) {
        throw authorizer.missingResource(ctx, "sequences.adjust", emissionPointNotFound());
      }
      const { nextNumber, expectedNextNumber, reason } = parseInput(adjustSequenceSchema, body);
      const key: SequenceKey = {
        companyId: ctx.companyId,
        environment: route.environment,
        establishmentId: route.establishmentId,
        emissionPointId: route.emissionPointId,
        documentType: route.documentType,
      };
      const point = `${found.establishment.code}-${found.point.code}`;
      const entry = (counter: CounterState): CounterEntry => ({
        establishment: found.establishment,
        point: found.point,
        key,
        counter,
      });

      return uow.run(async (scope) => {
        await scope.sequences.ensure(key);
        const current = (await scope.sequences.find(key)) ?? INITIAL_COUNTER;
        if (isExhausted(current)) throw sequenceExhausted(key.documentType, point, key.environment);
        if (nextNumber === expectedNextNumber) {
          if (current.nextNumber === expectedNextNumber) return entry(current);
          throw sequenceChanged();
        }
        if (!(await scope.sequences.adjust(key, expectedNextNumber, nextNumber))) {
          const fresh = (await scope.sequences.find(key)) ?? INITIAL_COUNTER;
          if (isExhausted(fresh)) throw sequenceExhausted(key.documentType, point, key.environment);
          if (fresh.nextNumber !== expectedNextNumber) throw sequenceChanged();
          throw sequenceNumberReserved(fresh.lastReserved ?? 0);
        }
        const after = (await scope.sequences.find(key)) ?? INITIAL_COUNTER;
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "fiscal_sequence.adjusted",
          changes: {
            environment: key.environment,
            establishmentCode: found.establishment.code,
            emissionPointCode: found.point.code,
            documentType: key.documentType,
            "nextNumber.from": expectedNextNumber,
            "nextNumber.to": nextNumber,
            lastReserved: after.lastReserved,
            decrease: nextNumber < expectedNextNumber,
            ...(reason ? { reason } : {}),
          },
          correlationId: ctx.requestId,
        });
        return entry(after);
      });
    },
  };
}

export type SequenceAdministration = ReturnType<typeof createSequenceAdministration>;
