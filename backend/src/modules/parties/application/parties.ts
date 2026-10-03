// Catálogo de terceros de la empresa (add-parties-and-products, design D3, D4, D10, D13 y D14).
// La empresa sale siempre del contexto de la sesión. La identificación se valida con la regla del
// catálogo fiscal vigente hoy en Ecuador; la unicidad la decide la base de datos. El consumidor
// final no se corrige ni se desactiva. Solo los cambios reales se auditan, en la misma transacción.
import {
  changePartyStatusSchema,
  createPartySchema,
  listPartiesQuerySchema,
  updatePartySchema,
  type PartyData,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { identificationProblem, partyChanges, type PartyRecord } from "../domain/party.ts";
import {
  identificationInvalid,
  identificationReserved,
  identificationTaken,
  identificationTypeUnavailable,
  partyChanged,
  partyNotFound,
  partySystemRecord,
} from "./errors.ts";
import {
  DuplicateIdentificationError,
  type IdentificationRules,
  type PartiesUnitOfWork,
  type PartyRepository,
} from "./ports.ts";

export type PartiesDependencies = {
  parties: PartyRepository;
  uow: PartiesUnitOfWork;
  rules: IdentificationRules;
  authorizer: Authorizer;
  /** Fecha de hoy en Ecuador, para resolver las reglas vigentes. */
  today: () => string;
};

/** Tercero con la denominación oficial de su tipo de identificación. */
export type PartyResult = PartyRecord & { identificationTypeLabel: string | null };

export function createParties({ parties, uow, rules, authorizer, today }: PartiesDependencies) {
  async function labels(codes: readonly string[]): Promise<Map<string, string | null>> {
    const date = today();
    const result = new Map<string, string | null>();
    for (const code of new Set(codes)) {
      result.set(code, (await rules.identificationRule(code, date))?.officialLabel ?? null);
    }
    return result;
  }

  async function withLabel(party: PartyRecord): Promise<PartyResult> {
    const label = (await labels([party.identificationType])).get(party.identificationType);
    return { ...party, identificationTypeLabel: label ?? null };
  }

  async function validateIdentification(data: PartyData) {
    const rule = await rules.identificationRule(data.identificationType, today());
    const problem = identificationProblem(rule, data.identification);
    if (!problem) return;
    if (problem.kind === "TYPE_UNAVAILABLE") throw identificationTypeUnavailable();
    if (problem.kind === "RESERVED") throw identificationReserved();
    throw identificationInvalid(problem.rule.officialLabel, problem.rule.description);
  }

  /** Traduce la unicidad de la base de datos al error estable, con el tercero existente. */
  async function takenError(companyId: string, data: PartyData) {
    const existing = await parties.findByIdentification(
      companyId,
      data.identificationType,
      data.identification,
    );
    return identificationTaken(existing?.legalName ?? "", existing?.status === "INACTIVE");
  }

  async function requireParty(ctx: RequestContext, partyId: string): Promise<PartyRecord> {
    const party = await parties.find(ctx.companyId, partyId);
    if (!party) throw partyNotFound();
    return party;
  }

  return {
    async list(ctx: RequestContext, query: unknown) {
      authorizer.requirePermission(ctx, "parties.read");
      const parsed = parseInput(listPartiesQuerySchema, query);
      const { items, total } = await parties.search(ctx.companyId, parsed);
      const names = await labels(items.map((party) => party.identificationType));
      return {
        items: items.map((party) => ({
          ...party,
          identificationTypeLabel: names.get(party.identificationType) ?? null,
        })),
        meta: { page: parsed.page, pageSize: parsed.pageSize, total },
      };
    },

    async get(ctx: RequestContext, partyId: string): Promise<PartyResult> {
      authorizer.requirePermission(ctx, "parties.read");
      return withLabel(await requireParty(ctx, partyId));
    },

    async create(ctx: RequestContext, body: unknown): Promise<PartyResult> {
      authorizer.requirePermission(ctx, "parties.manage");
      const data = parseInput(createPartySchema, body);
      await validateIdentification(data);
      try {
        const created = await uow.run(async (scope) => {
          const party = await scope.parties.create(ctx.companyId, data, ctx.userId);
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: "party.created",
            changes: {
              partyId: party.id,
              identificationType: party.identificationType,
              identification: party.identification,
              legalName: party.legalName,
              roles: party.roles,
            },
            correlationId: ctx.requestId,
          });
          return party;
        });
        return withLabel(created);
      } catch (error) {
        if (error instanceof DuplicateIdentificationError)
          throw await takenError(ctx.companyId, data);
        throw error;
      }
    },

    async update(ctx: RequestContext, partyId: string, body: unknown): Promise<PartyResult> {
      authorizer.requirePermission(ctx, "parties.manage");
      const { expectedVersion, ...data } = parseInput(updatePartySchema, body);
      const before = await requireParty(ctx, partyId);
      if (before.systemRecord) throw partySystemRecord();
      if (before.version !== expectedVersion) throw partyChanged();
      const changes = partyChanges(before, data);
      if (!changes) return withLabel(before);
      if (
        before.identificationType !== data.identificationType ||
        before.identification !== data.identification
      ) {
        await validateIdentification(data);
      }
      try {
        const updated = await uow.run(async (scope) => {
          const applied = await scope.parties.updateIfVersion(
            ctx.companyId,
            partyId,
            expectedVersion,
            data,
            ctx.userId,
          );
          if (!applied) {
            throw (await scope.parties.find(ctx.companyId, partyId))
              ? partyChanged()
              : partyNotFound();
          }
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: "party.updated",
            changes: { partyId, ...changes },
            correlationId: ctx.requestId,
          });
          return (await scope.parties.find(ctx.companyId, partyId))!;
        });
        return withLabel(updated);
      } catch (error) {
        if (error instanceof DuplicateIdentificationError)
          throw await takenError(ctx.companyId, data);
        throw error;
      }
    },

    /** Estado deseado: repetirlo no cambia nada ni audita (design D14). */
    async changeStatus(ctx: RequestContext, partyId: string, body: unknown): Promise<PartyResult> {
      authorizer.requirePermission(ctx, "parties.changeStatus");
      const { status } = parseInput(changePartyStatusSchema, body);
      const before = await requireParty(ctx, partyId);
      if (before.systemRecord) throw partySystemRecord();
      const after = await uow.run(async (scope) => {
        const changed = await scope.parties.changeStatusIfDifferent(
          ctx.companyId,
          partyId,
          status,
          ctx.userId,
        );
        if (changed) {
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: status === "INACTIVE" ? "party.deactivated" : "party.reactivated",
            changes: {
              partyId,
              identificationType: before.identificationType,
              identification: before.identification,
            },
            correlationId: ctx.requestId,
          });
        }
        return (await scope.parties.find(ctx.companyId, partyId)) ?? before;
      });
      return withLabel(after);
    },
  };
}

export type Parties = ReturnType<typeof createParties>;
