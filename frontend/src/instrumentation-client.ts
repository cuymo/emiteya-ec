// Inicialización del cliente antes de la hidratación (Next.js `instrumentation-client`).
// Zod 4 prueba `new Function("")` al construir cada esquema para decidir si compila sus validadores.
// Con la política de seguridad, que no admite `eval`, esa prueba falla, Zod usa su validador normal y
// el navegador registra una violación aunque el error se capture. `jitless` omite la prueba: el
// comportamiento es el mismo y la política queda sin violaciones
// (enforce-frontend-security-headers-csp, design D12). Va aquí, con código síncrono, para que rija
// antes de que cualquier módulo construya un esquema.
import { z } from "zod";

z.config({ jitless: true });
