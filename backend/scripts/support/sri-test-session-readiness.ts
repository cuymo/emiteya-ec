// Comprobación final de la sesión de certificación en Pruebas, antes de cualquier red
// (docs/quality/sri-test-environment-checklist.md, sección G). Es pura: recibe lo leído de la
// instalación, del entorno, de las confirmaciones del operador y del `verify` de la lista de
// permitidos, y devuelve cada comprobación sin imprimir valores sensibles (ni RUC, ni
// identificaciones, ni secretos). La primera transmisión sigue necesitando la autorización expresa del
// dueño del producto.
import { TRANSMISSION_SIZE_POLICY } from "../../src/modules/fiscal/domain/transmission-size-policy.ts";
import { resolveSriEndpoints } from "../../src/modules/sri-engine/infrastructure/endpoints.ts";

export const CERTIFICATION_DOCUMENT_TYPES = ["01", "03", "04", "05", "06", "07"] as const;
export const COUNTERPARTY_PLACEHOLDERS = [
  "TEST_IDENTIFIED_BUYER",
  "TEST_WITHHOLDING_SUBJECT",
  "TEST_PURCHASE_SETTLEMENT_SUPPLIER",
] as const;
export type CounterpartyPlaceholder = (typeof COUNTERPARTY_PLACEHOLDERS)[number];

/** Confirmaciones del operador: un archivo local fuera del repositorio, nunca commiteado. */
export type Confirmations = Readonly<{
  rucEnabledForElectronicInvoicing: boolean;
  testEnvironmentEnabled: boolean;
  taxDataMatchesSri: boolean;
  establishmentCode: string;
  emissionPointCode: string;
  documentTypesEnabled: readonly string[];
  /** Último secuencial ya usado en Pruebas por tipo en ese punto; ausente si el punto es nuevo. */
  lastUsedTestSequential?: Readonly<Partial<Record<string, number>>>;
  counterparties: Readonly<
    Partial<
      Record<
        CounterpartyPlaceholder,
        Readonly<{
          consent: "OWNER_CONTROLLED" | "WRITTEN_CONSENT";
          identificationType: string;
          identification: string;
        }>
      >
    >
  >;
}>;

/** Lo leído de la instalación de la certificación, sin red. */
export type Installation = Readonly<{
  companies: number;
  environment: string | null;
  companyRuc: string | null;
  documentsOutsideTest: number;
  establishmentActive: boolean | null;
  emissionPointActive: boolean | null;
  productionSequencesOnPoint: number;
  /** Siguiente número de Pruebas por tipo en el punto; null si el contador todavía no existe. */
  testNextNumbers: Readonly<Partial<Record<string, number | null>>>;
  certificate: Readonly<{
    present: boolean;
    secretPresent: boolean;
    notAfter: Date | null;
    detectedRuc: string | null;
  }>;
  /** Si cada contraparte existe como tercero activo de la empresa, por su identificación. */
  counterpartiesInInstallation: Readonly<Partial<Record<CounterpartyPlaceholder, boolean>>>;
}>;

export type EgressVerify = Readonly<{ verify: string; at: string }> | null;
export type Check = Readonly<{ name: string; ok: boolean; detail: string }>;

const MS_PER_DAY = 86_400_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export function evaluateSessionReadiness(
  input: Readonly<{
    confirmations: Confirmations;
    env: Record<string, string>;
    egress: EgressVerify;
    installation: Installation;
    now: Date;
    /** Días mínimos de vigencia del certificado para empezar o seguir la sesión. */
    minDaysToExpiry?: number;
    /** Antigüedad máxima del `verify` de la lista de permitidos. */
    maxEgressVerifyAgeHours?: number;
  }>,
): Check[] {
  const { confirmations: c, env, egress, installation: i, now } = input;
  const minDays = input.minDaysToExpiry ?? 7;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  add("single-company-installation", i.companies === 1, `${i.companies} empresa(s)`);
  add("company-environment-test", i.environment === "TEST", i.environment ?? "sin configurar");
  add(
    "documents-environment-test",
    i.documentsOutsideTest === 0,
    `${i.documentsOutsideTest} comprobante(s) fuera de Pruebas`,
  );
  add("ruc-enabled-confirmed", c.rucEnabledForElectronicInvoicing === true);
  add("test-environment-enabled-confirmed", c.testEnvironmentEnabled === true);
  add("tax-data-matches-sri-confirmed", c.taxDataMatchesSri === true);

  add(
    "p12-certification-ready",
    i.certificate.present && i.certificate.secretPresent,
    i.certificate.present ? "firma vigente con su secreto" : "sin firma vigente",
  );
  const daysLeft = i.certificate.notAfter
    ? Math.floor((i.certificate.notAfter.getTime() - now.getTime()) / MS_PER_DAY)
    : null;
  add(
    "certificate-not-expired",
    daysLeft !== null && daysLeft >= minDays,
    daysLeft === null
      ? "sin fecha de vencimiento"
      : daysLeft < minDays
        ? `CERTIFICATE_EXPIRY_TOO_CLOSE: quedan ${daysLeft} día(s); evaluar la renovación antes de seguir`
        : `quedan ${daysLeft} días (vence ${i.certificate.notAfter!.toISOString().slice(0, 10)})`,
  );
  add(
    "ruc-matches-company",
    i.certificate.detectedRuc !== null && i.certificate.detectedRuc === i.companyRuc,
  );

  add(
    "size-policy-active",
    TRANSMISSION_SIZE_POLICY.id === "PRODUCT_CONSERVATIVE_POLICY_V1" &&
      TRANSMISSION_SIZE_POLICY.limitBytes === 40_000,
    TRANSMISSION_SIZE_POLICY.id,
  );
  add(
    "transmission-disabled-during-preparation",
    env.SRI_TRANSMISSION_ENABLED === "0",
    `SRI_TRANSMISSION_ENABLED=${env.SRI_TRANSMISSION_ENABLED ?? "sin definir"}`,
  );

  const endpoints = resolveSriEndpoints(env);
  add(
    "test-endpoint-configured",
    Object.values(endpoints.TEST).every(
      (url) => url.startsWith("https://") && hostOf(url) === "celcer.sri.gob.ec",
    ),
    "celcer.sri.gob.ec",
  );
  add(
    "production-endpoint-inaccessible",
    Object.values(endpoints.PRODUCTION).every((url) => LOOPBACK.has(hostOf(url))),
    Object.values(endpoints.PRODUCTION).some((url) => hostOf(url) === "cel.sri.gob.ec")
      ? "PRODUCTION_ACCESS_BLOCKED: un endpoint de Producción apunta a cel.sri.gob.ec"
      : "sobrescritos a una dirección local cerrada",
  );
  const egressAgeHours = egress
    ? (now.getTime() - new Date(egress.at).getTime()) / 3_600_000
    : null;
  add(
    "egress-allowlist-ready",
    egress?.verify === "PASS" &&
      egressAgeHours !== null &&
      egressAgeHours <= (input.maxEgressVerifyAgeHours ?? 24),
    egress ? `verify ${egress.verify} hace ${Math.round(egressAgeHours ?? 0)} h` : "sin verify",
  );

  add(
    "establishment-confirmed",
    /^\d{3}$/.test(c.establishmentCode) && i.establishmentActive === true,
    c.establishmentCode,
  );
  add(
    "emission-point-confirmed",
    /^\d{3}$/.test(c.emissionPointCode) && i.emissionPointActive === true,
    c.emissionPointCode,
  );
  const missingTypes = CERTIFICATION_DOCUMENT_TYPES.filter(
    (type) => !c.documentTypesEnabled.includes(type),
  );
  add(
    "six-document-types-confirmed",
    missingTypes.length === 0,
    missingTypes.length === 0 ? "01, 03, 04, 05, 06 y 07" : `faltan ${missingTypes.join(", ")}`,
  );
  const sequencesBehind = CERTIFICATION_DOCUMENT_TYPES.filter((type) => {
    const last = c.lastUsedTestSequential?.[type];
    if (last === undefined) return false;
    const next = i.testNextNumbers[type] ?? 1;
    return next <= last;
  });
  add(
    "test-sequences-ready",
    i.productionSequencesOnPoint === 0 && sequencesBehind.length === 0,
    i.productionSequencesOnPoint > 0
      ? "el punto tiene contadores de Producción: no es un punto dedicado a Pruebas"
      : sequencesBehind.length > 0
        ? `el siguiente número no supera el último usado en Pruebas: ${sequencesBehind.join(", ")}`
        : CERTIFICATION_DOCUMENT_TYPES.map(
            (type) => `${type}:${i.testNextNumbers[type] ?? 1}`,
          ).join(" "),
  );

  const unresolved = COUNTERPARTY_PLACEHOLDERS.filter((placeholder) => {
    const party = c.counterparties[placeholder];
    if (!party) return true;
    if (party.consent !== "OWNER_CONTROLLED" && party.consent !== "WRITTEN_CONSENT") return true;
    if (!party.identification) return true;
    // El proveedor de la liquidación no tiene RUC activo: cédula (05) o pasaporte (06).
    if (
      placeholder === "TEST_PURCHASE_SETTLEMENT_SUPPLIER" &&
      !["05", "06"].includes(party.identificationType)
    )
      return true;
    return i.counterpartiesInInstallation[placeholder] !== true;
  });
  add(
    "test-counterparties-resolved",
    unresolved.length === 0,
    unresolved.length === 0
      ? "las tres contrapartes, con consentimiento"
      : `pendientes: ${unresolved.join(", ")}`,
  );
  return checks;
}
