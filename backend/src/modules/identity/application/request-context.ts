// Contexto de una operación protegida (design D3). Lo resuelve el servidor desde la sesión y la
// membresía activa; los casos de uso lo reciben como datos simples, nunca como objeto de Express.
import type { Role } from "../domain/roles.ts";

export type RequestContext = Readonly<{
  userId: string;
  companyId: string;
  role: Role;
  requestId: string;
}>;
