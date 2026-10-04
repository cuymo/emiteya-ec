// Puertos del job del RIDE (add-document-archive, design D3 a D5 y D14).
import type { DbClient } from "../../../../platform/db/database.ts";
import type { ArtifactStore } from "../ports.ts";

/**
 * Logo de una versión inmutable de la configuración (ADR 0017): lo implementa el módulo dueño de
 * esas tablas y lo compone el arranque. Solo de lectura; nunca la configuración vigente.
 */
export type RideLogoSource = (
  companyId: string,
  configVersionId: string,
) => Promise<Readonly<{
  content: Uint8Array;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}> | null>;

/** Transacción que guarda el RIDE y completa su job, guardada por el arriendo. */
export type RideScope = Readonly<{ db: DbClient; artifacts: ArtifactStore }>;

export interface RideUnitOfWork {
  run<T>(work: (scope: RideScope) => Promise<T>): Promise<T>;
}

/** Métricas del RIDE (design D14), sin datos de la empresa ni del comprobante. */
export type RideObserver = Readonly<{
  /** Duración del render en el worker, sin la espera. */
  rendered(seconds: number): void;
  /** Del momento en que el job debía correr al inicio del render: la espera de cola. */
  waited(seconds: number): void;
  /** Un fallo, por código acotado. */
  failed(code: string): void;
}>;
