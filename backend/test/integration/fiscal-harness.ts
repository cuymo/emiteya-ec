// Arnés de las pruebas de la numeración fiscal: empresas con establecimientos y puntos, servicios
// sobre PostgreSQL y una unidad de trabajo que retiene la transacción antes de confirmar, para fijar
// el orden de dos operaciones concurrentes (design D3 y D4).
import { randomUUID } from "node:crypto";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import type { SecurityEvent } from "../../src/modules/identity/application/security-events.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import type { FiscalUnitOfWork } from "../../src/modules/fiscal/application/ports.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createSequenceAdministration } from "../../src/modules/fiscal/application/sequence-administration.ts";
import { createSequenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sequences.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { createEstablishmentRepository } from "../../src/modules/taxpayer/infrastructure/prisma-establishments.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

export type Deferred = { promise: Promise<void>; resolve: () => void };

export function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

/** Ejecuta el trabajo y, antes de confirmar, avisa en `reached` y espera a `release`. */
export function holdingUow(uow: FiscalUnitOfWork, reached: Deferred, release: Deferred) {
  return {
    run: <T>(work: Parameters<FiscalUnitOfWork["run"]>[0]) =>
      uow.run(async (scope) => {
        const result = (await work(scope)) as T;
        reached.resolve();
        await release.promise;
        return result;
      }),
  } as FiscalUnitOfWork;
}

/** true si la promesa sigue pendiente tras `ms`: la operación espera un bloqueo de PostgreSQL. */
export async function stillPending(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

export type FiscalCompany = {
  companyId: string;
  adminId: string;
  points: { establishmentId: string; emissionPointId: string; code: string }[];
};

/** Empresa con un administrador y `count` establecimientos, cada uno con su punto 001. */
export async function insertFiscalCompany(
  db: DbClient,
  name: string,
  count = 3,
): Promise<FiscalCompany> {
  const companyId = await insertCompany(db, name);
  const adminId = (await insertMember(db, companyId, { name: `Admin ${name}`, role: "ADMIN" }))
    .userId;
  const points = [];
  for (let index = 1; index <= count; index++) {
    const code = String(index).padStart(3, "0");
    const establishment = await db.establishment.create({
      data: { companyId, code, address: `Dirección ${code}` },
    });
    const point = await db.emissionPoint.create({
      data: { companyId, establishmentId: establishment.id, code: "001" },
    });
    points.push({ establishmentId: establishment.id, emissionPointId: point.id, code });
  }
  return { companyId, adminId, points };
}

export function adminContext(company: FiscalCompany): RequestContext {
  return {
    userId: company.adminId,
    companyId: company.companyId,
    role: "ADMIN",
    requestId: randomUUID(),
  };
}

export function fiscalServices(
  prisma: PrismaClient,
  options: { wrap?: (uow: FiscalUnitOfWork) => FiscalUnitOfWork; events?: SecurityEvent[] } = {},
) {
  const base = createFiscalUnitOfWork(prisma);
  const uow = options.wrap ? options.wrap(base) : base;
  const events = options.events ?? [];
  return {
    reservation: createSequentialReservation(uow),
    administration: createSequenceAdministration({
      uow,
      sequences: createSequenceRepository(prisma),
      establishments: createEstablishmentRepository(prisma),
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: (event) => void events.push(event) },
      }),
    }),
  };
}

export const key = (
  company: FiscalCompany,
  pointIndex = 0,
  documentType: "01" | "03" | "04" | "05" | "06" | "07" = "01",
  environment: "TEST" | "PRODUCTION" = "TEST",
) => ({
  companyId: company.companyId,
  environment,
  establishmentId: company.points[pointIndex]!.establishmentId,
  emissionPointId: company.points[pointIndex]!.emissionPointId,
  documentType,
});

export const reservationInput = (k: ReturnType<typeof key>, reservedBy: string | null = null) => ({
  ...k,
  reservedBy,
  correlationId: randomUUID(),
});

/** Parámetros de la ruta de ajuste para una clave. */
export const adjustParams = (k: ReturnType<typeof key>) => ({
  establishmentId: k.establishmentId,
  emissionPointId: k.emissionPointId,
  environment: k.environment,
  documentType: k.documentType,
});
