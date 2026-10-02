// Límite de inicios de sesión fallidos por correo e IP (design D9, capa 1). Estado en memoria del
// proceso: válido solo con una instancia de API (docs/architecture/deployment.md). Un inicio
// correcto reinicia el contador; alcanzado el límite, se rechaza hasta que termine la ventana.

type Entry = { failures: number; resetAt: number };

export type LoginThrottlePolicy = { max: number; windowMs: number };

// Al llegar al máximo se poda hasta el 90 %: el coste de la poda queda amortizado por inserción.
const MAX_ENTRIES = 50_000;
const AFTER_PRUNE = 45_000;

export class LoginThrottle {
  readonly #entries = new Map<string, Entry>();
  readonly #policy: LoginThrottlePolicy;
  readonly #now: () => number;

  constructor(policy: LoginThrottlePolicy, now: () => number = Date.now) {
    this.#policy = policy;
    this.#now = now;
  }

  isBlocked(key: string): boolean {
    const entry = this.#current(key);
    return entry !== undefined && entry.failures >= this.#policy.max;
  }

  recordFailure(key: string): void {
    const entry = this.#current(key);
    if (entry) {
      entry.failures += 1;
      return;
    }
    this.#prune();
    this.#entries.set(key, { failures: 1, resetAt: this.#now() + this.#policy.windowMs });
  }

  reset(key: string): void {
    this.#entries.delete(key);
  }

  get size(): number {
    return this.#entries.size;
  }

  #current(key: string): Entry | undefined {
    const entry = this.#entries.get(key);
    if (entry && entry.resetAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Acota la memoria ante muchos correos distintos: primero vencidos, luego los más antiguos. */
  #prune(): void {
    if (this.#entries.size < MAX_ENTRIES) return;
    const now = this.#now();
    for (const [key, entry] of this.#entries) if (entry.resetAt <= now) this.#entries.delete(key);
    for (const key of this.#entries.keys()) {
      if (this.#entries.size <= AFTER_PRUNE) break;
      this.#entries.delete(key);
    }
  }
}
