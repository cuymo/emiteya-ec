// Política de seguridad del navegador para los documentos de la interfaz
// (enforce-frontend-security-headers-csp, design D1, D3, D4, D6 y D10). Es la única fuente de la
// política: `proxy.ts` solo la aplica, y la documentación la referencia sin copiarla.
// Sin efectos salvo `createNonce`, que lee la fuente aleatoria del sistema.

export type PolicyMode = "production" | "development";

/** 128 bits de entropía (design D1, contrato del nonce). */
const NONCE_BYTES = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Nonce de un solo uso: 16 bytes de `crypto.getRandomValues` en base64 estándar, válido en la
 * sintaxis `nonce-<base64-value>`. Nunca se deriva de la petición, del usuario ni de la sesión, y
 * nunca se guarda ni se registra.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Estructura del nonce: base64 estándar que decodifica a 16 bytes o más. */
export function isValidNonce(nonce: string): boolean {
  if (nonce.length % 4 !== 0 || !BASE64.test(nonce)) return false;
  return atob(nonce).length >= NONCE_BYTES;
}

/**
 * Capacidades del navegador que la interfaz no usa (design D6). La impresión y las descargas no
 * son características de esta cabecera.
 */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "bluetooth=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "serial=()",
  "usb=()",
].join(", ");

/**
 * Estilos en línea (design D4): variante C, la más amplia, hasta que la medición en Chrome de la
 * tarea 3.3 la acote. Nunca alcanza las directivas de scripts.
 */
const STYLE_DIRECTIVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["style-src", ["'self'"]],
  ["style-src-elem", ["'self'", "'unsafe-inline'"]],
  ["style-src-attr", ["'unsafe-inline'"]],
];

/** La `Content-Security-Policy` de un documento con su nonce (design D3). */
export function contentSecurityPolicy(nonce: string, mode: PolicyMode): string {
  if (!isValidNonce(nonce)) throw new Error("El nonce de la política no es válido.");
  // Desarrollo (design D10): React usa `eval` para reconstruir las pilas de error en el navegador.
  const development = mode === "development" ? ["'unsafe-eval'"] : [];
  const directives: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...development]],
    ["script-src-attr", ["'none'"]],
    ...STYLE_DIRECTIVES,
    ["img-src", ["'self'"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    // La impresión del RIDE carga una URL `blob:` en un iframe oculto; `blob:` no va en otra directiva.
    ["frame-src", ["blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Todos los formularios se envían con JavaScript: un envío nativo se bloquea.
    ["form-action", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * Cabeceras de seguridad de un documento HTML (design D3 y D6). Sin `Strict-Transport-Security`:
 * pertenece al proxy que termina TLS (design D7).
 */
export function documentSecurityHeaders(nonce: string, mode: PolicyMode): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(nonce, mode),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}
