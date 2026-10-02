// Unidad de trabajo de design D2: una transacción de Prisma en la que Better Auth escribe con un
// adapter ligado a esa transacción (`runWithAdapter`), junto con la auditoría y las lecturas propias.
// `runWithAdapter`, `auth.$context` y las escrituras con el adapter solo aparecen en este módulo (D2b).
import { getCurrentAdapter, runWithAdapter } from "@better-auth/core/context";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import type { DbClient } from "../../../../platform/db/database.ts";
import { createAuditLog } from "../../../audit/infrastructure/prisma-audit-log.ts";
import {
  EmailInUseError,
  PasswordPolicyError,
  type IdentityWriter,
  type TransactionScope,
  type UnitOfWork,
} from "../../application/unit-of-work.ts";
import { createCompanyReader } from "../prisma-companies.ts";
import { createMembershipReader } from "../prisma-memberships.ts";
import type { Auth, AuthSettings } from "./auth.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

function isEmailInUse(error: unknown): boolean {
  if (error instanceof APIError)
    return String(error.body?.code ?? "").startsWith("USER_ALREADY_EXISTS");
  // Dos altas simultáneas: la restricción única del correo deja ganar a una (P2002 de Prisma).
  return (error as { code?: unknown } | null)?.code === "P2002";
}

function createIdentityWriter(auth: Auth, policy: AuthSettings["password"]): IdentityWriter {
  const assertPolicy = (password: string) => {
    // createUser del plugin admin no aplica la longitud (S-1, E2): se exige aquí también.
    if (password.length < policy.minLength || password.length > policy.maxLength) {
      throw new PasswordPolicyError(policy);
    }
  };
  const adapter = async () => getCurrentAdapter((await auth.$context).adapter);

  return {
    async createUser({ name, email, password }) {
      assertPolicy(password);
      try {
        const { user } = await auth.api.createUser({ body: { name, email, password } });
        return user.id;
      } catch (error) {
        if (isEmailInUse(error)) throw new EmailInUseError();
        throw error;
      }
    },

    async findUserIdByEmail(email) {
      const found = await (await auth.$context).internalAdapter.findUserByEmail(email);
      return found?.user.id ?? null;
    },

    async createCompany({ name, slug }) {
      const created = await (
        await adapter()
      ).create<{ name: string; slug: string; createdAt: Date }, { id: string }>({
        model: "organization",
        data: { name, slug, createdAt: new Date() },
      });
      return created.id;
    },

    async addMembership({ companyId, userId, role }) {
      await (
        await adapter()
      ).create({
        model: "member",
        data: { organizationId: companyId, userId, role, status: "ACTIVE", createdAt: new Date() },
      });
    },

    async updateMembership(companyId, userId, change) {
      const updated = await (
        await adapter()
      ).update({
        model: "member",
        where: [
          { field: "organizationId", value: companyId },
          { field: "userId", value: userId },
        ],
        update: change,
      });
      if (!updated) throw new Error("La membresía no existe en la empresa");
    },

    async setPassword(userId, password) {
      assertPolicy(password);
      const context = await auth.$context;
      await context.internalAdapter.updatePassword(userId, await context.password.hash(password));
      await context.internalAdapter.deleteUserSessions(userId);
    },

    async revokeSessions(userId) {
      await (await auth.$context).internalAdapter.deleteUserSessions(userId);
    },
  };
}

function createScope(tx: DbClient, auth: Auth, settings: AuthSettings): TransactionScope {
  return {
    identity: createIdentityWriter(auth, settings.password),
    audit: createAuditLog(tx),
    memberships: createMembershipReader(tx),
    companies: createCompanyReader(tx),
    acquireLock: async (name) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`facturador:${name}`}))`;
    },
  };
}

export function createUnitOfWork(
  prisma: PrismaClient,
  auth: Auth,
  settings: AuthSettings,
): UnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        async (tx) => {
          const txAdapter = prismaAdapter(tx, { provider: "postgresql", transaction: false })(
            auth.options,
          );
          return runWithAdapter(txAdapter, () => work(createScope(tx, auth, settings)));
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}
