// Cabeceras de seguridad de cada documento (enforce-frontend-security-headers-csp, design D1 y D8).
// Genera un nonce nuevo por petición y escribe la política del módulo `web-security-policy` en la
// petición, de donde Next.js extrae el nonce para sus scripts, y en la respuesta, que es lo que
// aplica el navegador. No registra nada: el nonce nunca llega a los logs.
import { NextResponse, type NextRequest } from "next/server";
import { createNonce, documentSecurityHeaders } from "@/lib/web-security-policy";

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const headers = documentSecurityHeaders(
    nonce,
    process.env.NODE_ENV === "development" ? "development" : "production",
  );
  // `set` reemplaza cualquier valor que traiga el cliente: el nonce solo lo fija el servidor.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]!);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

// Solo documentos (design D8): la API conserva sus cabeceras de helmet, los recursos estáticos no
// necesitan política y los prefetch no son documentos.
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
