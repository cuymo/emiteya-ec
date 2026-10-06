// Habilitación por empresa (add-fiscal-catalogs, design D9): una sola función decide qué significa
// la ausencia de una decisión, para que todo lector la interprete igual.
import {
  isSelectableScope,
  type EnablementPolicy,
  type ScopeClassification,
} from "@facturador/contracts";

export type Enablement = {
  enabled: boolean;
  /** DEFAULT: rige la política del catálogo; COMPANY: decisión explícita de la empresa. */
  source: "DEFAULT" | "COMPANY" | "NOT_ENABLEABLE";
};

export function effectiveEnablement({
  decision,
  policy,
}: {
  /** Decisión explícita de la empresa, si existe. */
  decision: boolean | undefined;
  /** Política del catálogo, de la última versión aplicada de su dataset. */
  policy: EnablementPolicy;
}): Enablement {
  if (policy === "NOT_ENABLEABLE") return { enabled: true, source: "NOT_ENABLEABLE" };
  if (decision !== undefined) return { enabled: decision, source: "COMPANY" };
  return { enabled: policy === "DEFAULT_ENABLED", source: "DEFAULT" };
}

/**
 * Una entrada es utilizable si está habilitada y tiene versión aplicable en la fecha, y esa versión
 * está soportada (add-withholding-receipts, design D11; las entradas sin clasificación lo están).
 * Una entrada vencida, retirada o fuera de alcance nunca es utilizable por más que la empresa la
 * tuviera habilitada.
 */
export const isUsable = (
  applicable: { scopeClassification: ScopeClassification | null } | null | undefined,
  enablement: Enablement,
): boolean =>
  applicable !== null &&
  applicable !== undefined &&
  enablement.enabled &&
  isSelectableScope(applicable.scopeClassification);
