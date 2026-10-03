// Material secreto de la firma (ADR 0011): nunca se serializa ni se imprime. `reveal` es la única
// forma de leerlo y `wipe` lo sobrescribe con ceros en cuanto deja de hacer falta.
import { inspect } from "node:util";

const REDACTED = "[secreto]";

abstract class Redacted {
  toJSON(): string {
    return REDACTED;
  }
  toString(): string {
    return REDACTED;
  }
  [inspect.custom](): string {
    return REDACTED;
  }
}

export class SecretBytes extends Redacted {
  readonly #bytes: Buffer;
  constructor(bytes: Buffer) {
    super();
    this.#bytes = bytes;
  }
  reveal(): Buffer {
    return this.#bytes;
  }
  wipe(): void {
    this.#bytes.fill(0);
  }
}

/** Texto secreto (la contraseña del P12). JavaScript no permite borrar una cadena de memoria. */
export class SecretText extends Redacted {
  readonly #text: string;
  constructor(text: string) {
    super();
    this.#text = text;
  }
  reveal(): string {
    return this.#text;
  }
}

export type SigningMaterial = Readonly<{ p12: SecretBytes; password: SecretText }>;
