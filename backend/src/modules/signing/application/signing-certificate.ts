// Casos de uso de la firma electrónica (add-signing-certificate, design D3, D7, D8, D9 y D12).
// La inspección y la firma de prueba corren en el pool criptográfico, fuera de la transacción; la
// transacción solo bloquea, compara, sella con AES (rápido) y escribe con su auditoría.
import { randomUUID } from "node:crypto";
import {
  expiryAlertSchema,
  uploadSigningCertificateSchema,
  type CertificateValidityView,
  type RucMatch,
} from "@facturador/contracts";
import type { AuditChanges } from "../../audit/domain/audit-event.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { SigningCertificateReadiness } from "../../taxpayer/application/ports.ts";
import {
  DEFAULT_EXPIRY_ALERT_DAYS,
  deriveValidity,
  rucMatch,
  type CertificateValidity,
} from "../domain/certificate.ts";
import { SecretBytes, SecretText } from "../domain/secret.ts";
import {
  certificateChanged,
  certificateNotValidNow,
  certificateRejected,
  certificateRucNotFound,
  certificateTooLarge,
  custodyDisabled,
} from "./errors.ts";
import type {
  CertificateInspector,
  CertificateRepository,
  CertificateVault,
  CompanyRucReader,
  NewCertificate,
  SigningUnitOfWork,
  StoredCertificate,
} from "./ports.ts";

export type CertificateEntry = Readonly<{
  certificate: StoredCertificate;
  validity: CertificateValidity;
  companyRuc: string | null;
  rucMatch: RucMatch;
}>;

export type SigningCertificateDependencies = {
  uow: SigningUnitOfWork;
  certificates: CertificateRepository;
  companyRuc: CompanyRucReader;
  inspector: CertificateInspector;
  /** null cuando la custodia está deshabilitada (solo desarrollo y pruebas). */
  vault: CertificateVault | null;
  authorizer: Authorizer;
  maxBytes: number;
  now?: () => Date;
};

/** CN de un nombre distinguido "C=EC, …, CN=…", o el nombre completo si no tiene. */
const commonName = (dn: string) => /(?:^|,\s*)CN=([^,]+)/.exec(dn)?.[1] ?? dn;

function describe(
  prefix: string,
  certificate: Omit<StoredCertificate, "secret">,
  companyRuc: string | null,
): AuditChanges {
  return {
    [`${prefix}.subject`]: certificate.subject,
    [`${prefix}.issuer`]: certificate.issuer,
    [`${prefix}.serialNumber`]: certificate.serialNumber,
    [`${prefix}.fingerprint`]: certificate.fingerprint,
    [`${prefix}.notBefore`]: certificate.notBefore.toISOString(),
    [`${prefix}.notAfter`]: certificate.notAfter.toISOString(),
    [`${prefix}.detectedRuc`]: certificate.detectedRuc,
    [`${prefix}.rucMatch`]: rucMatch(certificate.detectedRuc, companyRuc),
  };
}

export function createSigningCertificates(deps: SigningCertificateDependencies) {
  const { uow, certificates, authorizer, vault } = deps;
  const now = deps.now ?? (() => new Date());

  const keyAvailable = (certificate: StoredCertificate) =>
    vault !== null && certificate.secret !== null && vault.canOpen(certificate.secret);
  const alertDays = async (companyId: string) =>
    (await certificates.expiryAlertDays(companyId)) ?? DEFAULT_EXPIRY_ALERT_DAYS;
  const validityOf = (certificate: StoredCertificate, expiryAlertDays: number) =>
    deriveValidity({
      notAfter: certificate.notAfter,
      now: now(),
      expiryAlertDays,
      keyAvailable: keyAvailable(certificate),
    });
  const entryOf = (
    certificate: StoredCertificate,
    expiryAlertDays: number,
    companyRuc: string | null,
  ): CertificateEntry => ({
    certificate,
    validity: validityOf(certificate, expiryAlertDays),
    companyRuc,
    rucMatch: rucMatch(certificate.detectedRuc, companyRuc),
  });

  async function usable(companyId: string): Promise<boolean> {
    const certificate = await certificates.findActive(companyId);
    return certificate !== null && validityOf(certificate, await alertDays(companyId)).usable;
  }

  return {
    /** Firma vigente completa y anticipación del aviso (solo administradores). */
    async get(
      ctx: RequestContext,
    ): Promise<{ entry: CertificateEntry | null; expiryAlertDays: number }> {
      authorizer.requirePermission(ctx, "certificate.read");
      const [certificate, expiryAlertDays, companyRuc] = await Promise.all([
        certificates.findActive(ctx.companyId),
        alertDays(ctx.companyId),
        deps.companyRuc.currentRuc(ctx.companyId),
      ]);
      return {
        entry: certificate ? entryOf(certificate, expiryAlertDays, companyRuc) : null,
        expiryAlertDays,
      };
    },

    /** Solo la vigencia (administradores y operadores). */
    async validity(ctx: RequestContext): Promise<CertificateValidityView> {
      authorizer.requirePermission(ctx, "certificateValidity.read");
      const certificate = await certificates.findActive(ctx.companyId);
      if (!certificate) return { state: "NONE", usable: false, notAfter: null, daysToExpiry: null };
      const validity = validityOf(certificate, await alertDays(ctx.companyId));
      return {
        state: validity.state,
        usable: validity.usable,
        notAfter: certificate.notAfter.toISOString(),
        daysToExpiry: validity.daysToExpiry,
      };
    },

    /**
     * Carga, reemplazo (design D3 y D7) o recuperación de la custodia (repair-signing-certificate-
     * reseal-after-master-key-change, design D1 a D4). Cargar otra vez la firma vigente no cambia
     * nada mientras su secreto se abra con la clave configurada.
     */
    async upload(
      ctx: RequestContext,
      body: unknown,
    ): Promise<{ entry: CertificateEntry; unchanged: boolean }> {
      authorizer.requirePermission(ctx, "certificate.manage");
      const input = parseInput(uploadSigningCertificateSchema, body);
      if (!vault) throw custodyDisabled();
      const bytes = Buffer.from(input.file, "base64");
      try {
        if (bytes.length > deps.maxBytes) throw certificateTooLarge(deps.maxBytes);
        if (bytes.length === 0) throw certificateRejected("CERTIFICATE_UNREADABLE");
        const inspected = await deps.inspector.inspect(bytes, input.password);
        if (!inspected.ok) throw certificateRejected(inspected.code, inspected.reason);
        const info = inspected.certificate;
        const notBefore = new Date(info.notBefore);
        const notAfter = new Date(info.notAfter);
        const at = now();
        if (at < notBefore || at > notAfter) throw certificateNotValidNow(notBefore, notAfter);
        if (!info.detectedRuc)
          throw certificateRucNotFound(commonName(info.subject), commonName(info.issuer));
        const detectedRuc = info.detectedRuc;
        const companyRuc = await deps.companyRuc.currentRuc(ctx.companyId);

        /** Sella el P12 subido y su contraseña con la clave activa, ligados a la firma indicada. */
        const seal = (certificateId: string) => {
          const binding = { companyId: ctx.companyId, certificateId };
          const material = {
            p12: new SecretBytes(Buffer.from(bytes)),
            password: new SecretText(input.password),
          };
          const sealed = vault.seal(material, binding);
          material.p12.wipe();
          return { sealed, binding };
        };

        const result = await uow.run(async (scope) => {
          await scope.certificates.lock(ctx.companyId);
          const current = await scope.certificates.findActive(ctx.companyId);
          if (current && current.fingerprint === info.fingerprint) {
            if (keyAvailable(current)) return { stored: current, unchanged: true };
            // La clave configurada no abre su secreto (se cambió o se perdió): esta carga, ya
            // validada como cualquier otra, vuelve a custodiar la misma firma con la clave actual.
            if (current.id !== input.expectedCurrentId) throw certificateChanged();
            const { sealed, binding } = seal(current.id);
            await scope.certificates.deleteSecret(current.id);
            await scope.certificates.insertSecret(sealed, binding);
            await scope.audit.append({
              companyId: ctx.companyId,
              actor: { type: "USER", userId: ctx.userId },
              action: "signing_certificate.custody_restored",
              changes: {
                ...describe("certificate", current, companyRuc),
                "custody.keyVersion.from": current.secret?.keyVersion ?? null,
                "custody.keyVersion.to": sealed.keyVersion,
              },
              correlationId: ctx.requestId,
            });
            const stored: StoredCertificate = {
              ...current,
              secret: { keyVersion: sealed.keyVersion, keyCheck: sealed.keyCheck },
            };
            return { stored, unchanged: false };
          }
          if ((current?.id ?? null) !== input.expectedCurrentId) throw certificateChanged();

          const created: NewCertificate = {
            id: randomUUID(),
            companyId: ctx.companyId,
            subject: info.subject,
            issuer: info.issuer,
            serialNumber: info.serialNumber,
            fingerprint: info.fingerprint,
            notBefore,
            notAfter,
            detectedRuc,
            keyAlgorithm: info.keyAlgorithm,
            keyBits: info.keyBits,
            uploadedAt: at,
            uploadedBy: ctx.userId,
          };
          const { sealed, binding } = seal(created.id);
          if (current) {
            await scope.certificates.deleteSecret(current.id);
            await scope.certificates.markReplaced(current.id, at);
          }
          await scope.certificates.insert(created);
          await scope.certificates.insertSecret(sealed, binding);
          if (current) await scope.certificates.linkReplacement(current.id, created.id);
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: current ? "signing_certificate.replaced" : "signing_certificate.loaded",
            changes: {
              ...describe("certificate", created, companyRuc),
              ...(current ? describe("previous", current, companyRuc) : {}),
            },
            correlationId: ctx.requestId,
          });
          const stored: StoredCertificate = {
            ...created,
            secret: { keyVersion: sealed.keyVersion, keyCheck: sealed.keyCheck },
          };
          return { stored, unchanged: false };
        });
        return {
          entry: entryOf(result.stored, await alertDays(ctx.companyId), companyRuc),
          unchanged: result.unchanged,
        };
      } finally {
        bytes.fill(0);
      }
    },

    /** Anticipación del aviso como estado deseado: el mismo valor no escribe ni audita. */
    async setExpiryAlert(ctx: RequestContext, body: unknown): Promise<number> {
      authorizer.requirePermission(ctx, "certificate.manage");
      const { days } = parseInput(expiryAlertSchema, body);
      return uow.run(async (scope) => {
        await scope.certificates.lock(ctx.companyId);
        const current =
          (await scope.certificates.expiryAlertDays(ctx.companyId)) ?? DEFAULT_EXPIRY_ALERT_DAYS;
        if (current === days) return days;
        await scope.certificates.setExpiryAlertDays(ctx.companyId, days);
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "signing_certificate.expiry_alert_changed",
          changes: { "expiryAlertDays.from": current, "expiryAlertDays.to": days },
          correlationId: ctx.requestId,
        });
        return days;
      });
    },

    /** Requisito de firma de la preparación para emitir (design D12). */
    readiness: { isMet: usable } satisfies SigningCertificateReadiness,

    /** Firmas vigentes cuyo secreto no puede abrirse con la clave configurada (para el arranque). */
    async unopenable(): Promise<StoredCertificate[]> {
      return (await certificates.listActive()).filter((certificate) => !keyAvailable(certificate));
    },

    /** Vigencia de cada firma vigente, para las métricas (sin descifrar nada). */
    async validityOfAll(): Promise<{ companyId: string; validity: CertificateValidity }[]> {
      const active = await certificates.listActive();
      return Promise.all(
        active.map(async (certificate) => ({
          companyId: certificate.companyId,
          validity: validityOf(certificate, await alertDays(certificate.companyId)),
        })),
      );
    },
  };
}

export type SigningCertificates = ReturnType<typeof createSigningCertificates>;
