// Aprovisionamiento al arrancar (design D7). Una sola empresa es política operativa: la garantizan
// el advisory lock, la comprobación previa y la ausencia de cualquier vía para crear empresas, no
// una restricción del modelo de datos.
import type { CompanyReader, UnitOfWork } from "./unit-of-work.ts";

export const PROVISIONAL_COMPANY = { name: "Mi empresa", slug: "mi-empresa" } as const;
export const INITIAL_ADMIN_NAME = "Administrador";

export type InitialAdminCredentials = Readonly<{ email: string; password: string }>;

export type ProvisioningResult = "provisioned" | "already_provisioned";

export type ProvisioningDependencies = {
  uow: UnitOfWork;
  companies: Pick<CompanyReader, "exists">;
  /** Valida y devuelve las credenciales; solo se invoca si falta la empresa. */
  initialAdmin: () => InitialAdminCredentials;
  correlationId: string;
};

export async function provisionInstallation({
  uow,
  companies,
  initialAdmin,
  correlationId,
}: ProvisioningDependencies): Promise<ProvisioningResult> {
  if (await companies.exists()) return "already_provisioned";
  // Falla aquí, antes de crear nada, si la configuración inicial falta o es inválida.
  const admin = initialAdmin();

  return uow.run(
    async ({
      identity,
      memberships,
      audit,
      companies: current,
      acquireLock,
      initializeCompany,
    }) => {
      await acquireLock("provisioning");
      if (await current.exists()) return "already_provisioned";

      const companyId = await identity.createCompany(PROVISIONAL_COMPANY);
      // La empresa confirma con sus registros del sistema; la base de datos lo exige (design D5).
      await initializeCompany(companyId);
      // Cada paso busca antes de crear, por si un arranque anterior quedó a medias.
      const userId =
        (await identity.findUserIdByEmail(admin.email)) ??
        (await identity.createUser({ name: INITIAL_ADMIN_NAME, ...admin }));
      if (!(await memberships.findInCompany(companyId, userId))) {
        await identity.addMembership({ companyId, userId, role: "ADMIN" });
      }
      await audit.append({
        companyId,
        actor: { type: "SYSTEM" },
        action: "company.provisioned",
        targetUserId: userId,
        changes: { role: "ADMIN" },
        correlationId,
      });
      return "provisioned";
    },
  );
}
