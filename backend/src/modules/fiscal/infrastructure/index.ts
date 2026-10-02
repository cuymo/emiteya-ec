// Ensamblado del módulo fiscal para main.ts y las pruebas (add-fiscal-numbering, design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createEstablishmentRepository } from "../../taxpayer/infrastructure/prisma-establishments.ts";
import { createSequenceAdministration } from "../application/sequence-administration.ts";
import { sequencesRouter } from "./http/sequences-router.ts";
import { createSequenceRepository } from "./prisma-sequences.ts";
import { createFiscalUnitOfWork } from "./unit-of-work.ts";

export function fiscalRouters({
  prisma,
  authorizer,
}: {
  prisma: PrismaClient;
  authorizer: Authorizer;
}) {
  return [
    sequencesRouter(
      createSequenceAdministration({
        uow: createFiscalUnitOfWork(prisma),
        sequences: createSequenceRepository(prisma),
        establishments: createEstablishmentRepository(prisma),
        authorizer,
      }),
    ),
  ];
}
