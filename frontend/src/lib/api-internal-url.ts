// Destino interno de la API, el único para el reenvío de `/api` (next.config.ts) y para la descarga
// del paquete de portabilidad (harden-production-configuration-and-clock-ownership, design D5).
// Nunca se deriva de la petición (`Host` ni cabeceras reenviadas), y ningún error muestra el valor.

/** Solo `next dev` lo usa cuando la variable falta; producción nunca cae en él. */
export const DEVELOPMENT_API_INTERNAL_URL = "http://127.0.0.1:4000";

export class ApiInternalUrlError extends Error {
  constructor(rule: string) {
    super(`API_INTERNAL_URL: ${rule}`);
    this.name = "ApiInternalUrlError";
  }
}

/**
 * El origen al que se reenvía la API. Ausente o vacío: un error si `required`, si no el bucle local
 * de desarrollo. Presente: una URL absoluta `http:` o `https:`, sin credenciales y solo un origen
 * (una ruta la conservaría el reenvío y la perdería la descarga). No se exige HTTPS en este salto.
 */
export function resolveApiInternalUrl(
  value: string | undefined,
  { required }: { required: boolean },
): string {
  if (value === undefined || value === "") {
    if (required) throw new ApiInternalUrlError("es obligatoria en producción");
    return DEVELOPMENT_API_INTERNAL_URL;
  }
  if (!URL.canParse(value)) throw new ApiInternalUrlError("no es una URL absoluta válida");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiInternalUrlError("debe usar http o https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ApiInternalUrlError("no admite credenciales");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new ApiInternalUrlError("debe ser solo un origen, sin ruta, consulta ni fragmento");
  }
  return url.origin;
}
