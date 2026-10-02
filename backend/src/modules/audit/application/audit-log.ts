// Puertos del rastro de auditoría. Solo agregar y leer por empresa: no existe actualización ni
// borrado, y la base de datos los rechaza también (trigger de solo agregado).
import type { AuditEvent, AuditEventInput } from "../domain/audit-event.ts";

export interface AuditLog {
  append(event: AuditEventInput): Promise<void>;
}

export interface AuditReader {
  listForCompany(companyId: string, options?: { limit?: number }): Promise<AuditEvent[]>;
}
