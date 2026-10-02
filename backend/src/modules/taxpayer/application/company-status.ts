// Ambiente y preparación para emitir de la empresa (design D6 y D9), para administradores y
// operadores. Se calcula en cada lectura; add-invoice-emission bloqueará la emisión con la misma
// evaluación.
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { evaluateReadiness, type Readiness } from "../domain/readiness.ts";
import { DEFAULT_ENVIRONMENT, type Environment } from "../domain/taxpayer-config.ts";
import type {
  CompanyConfigRepository,
  EstablishmentRepository,
  SigningCertificateReadiness,
} from "./ports.ts";

/** Sin el cambio de firma electrónica, el requisito de firma siempre está pendiente. */
export const PENDING_SIGNING_CERTIFICATE: SigningCertificateReadiness = {
  isMet: () => Promise.resolve(false),
};

export type CompanyStatus = Readonly<{
  environment: Environment;
  displayName: string | null;
  readiness: Readiness;
}>;

export type CompanyStatusDependencies = {
  configs: Pick<CompanyConfigRepository, "findCurrent">;
  establishments: Pick<EstablishmentRepository, "hasAvailablePoint">;
  signingCertificate: SigningCertificateReadiness;
  authorizer: Authorizer;
};

export function createCompanyStatus({
  configs,
  establishments,
  signingCertificate,
  authorizer,
}: CompanyStatusDependencies) {
  return {
    async get(ctx: RequestContext): Promise<CompanyStatus> {
      authorizer.requirePermission(ctx, "readiness.read");
      const [current, hasPoint, certificate] = await Promise.all([
        configs.findCurrent(ctx.companyId),
        establishments.hasAvailablePoint(ctx.companyId),
        signingCertificate.isMet(ctx.companyId),
      ]);
      const profile = current?.config.profile;
      return {
        environment: current?.config.environment ?? DEFAULT_ENVIRONMENT,
        displayName: profile ? (profile.tradeName ?? profile.legalName) : null,
        readiness: evaluateReadiness({
          TAXPAYER_DATA: current !== null,
          EMISSION_POINT: hasPoint,
          SIGNING_CERTIFICATE: certificate,
        }),
      };
    },
  };
}

export type CompanyStatusService = ReturnType<typeof createCompanyStatus>;
