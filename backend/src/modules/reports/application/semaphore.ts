// Semáforo de las exportaciones de esta instancia (add-reports-export, design D11): sin cola. Si no
// hay lugar, la exportación se rechaza en el acto; nunca espera en memoria.
export type Semaphore = Readonly<{
  /** Un lugar y la función que lo libera (una sola vez), o null si están todos ocupados. */
  tryAcquire(): (() => void) | null;
  inUse(): number;
}>;

export function createSemaphore(capacity: number): Semaphore {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacidad inválida");
  let used = 0;
  return {
    tryAcquire() {
      if (used >= capacity) return null;
      used += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        used -= 1;
      };
    },
    inUse: () => used,
  };
}
