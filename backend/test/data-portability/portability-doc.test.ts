// La documentación de la portabilidad cita las rutas, las variables, el permiso, las acciones y los
// códigos reales, y ninguna variable que no exista; observability.md, sus métricas
// (add-data-portability, tarea 5.3).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DATA_EXPORT_ERROR_CODES,
  DATA_EXPORT_FAILURE_CODES,
  apiRoutes,
} from "@facturador/contracts";
import { AUDIT_ACTIONS } from "../../src/modules/audit/domain/audit-event.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const DOC = read("../../../docs/architecture/data-portability.md");
const BACKEND = read("../../../docs/architecture/backend.md");
const ENV = read("../../src/config/env.ts");
const POLICY = read("../../src/modules/identity/domain/access-policy.ts");
const METRICS = read("../../src/modules/data-portability/infrastructure/metrics.ts");
const OBSERVABILITY = read("../../../docs/quality/observability.md");
const NAVIGATION = read("../../../frontend/src/components/navigation.tsx");

describe("docs/architecture/data-portability.md", () => {
  it("cita cada ruta registrada de la portabilidad", () => {
    const routes = apiRoutes.filter((route) => route.path.startsWith("/data-exports"));
    expect(routes).toHaveLength(4);
    for (const route of routes) {
      const path = route.path.replace(/:(\w+)/g, "{$1}");
      expect(DOC).toContain(`${route.method.toUpperCase()} /api/v1${path}\``);
    }
  });

  it("cita las variables reales y ninguna que no exista", () => {
    const variables = [...ENV.matchAll(/^\s*(DATA_EXPORT_[A-Z_]+):/gm)].map((match) => match[1]!);
    expect(variables).toHaveLength(6);
    for (const variable of variables) expect(DOC).toContain(variable);
    const codes = new Set<string>([...DATA_EXPORT_FAILURE_CODES, ...DATA_EXPORT_ERROR_CODES]);
    const cited = new Set(DOC.match(/\bDATA_EXPORT_[A-Z_]+\b/g));
    for (const name of cited)
      expect([name, variables.includes(name) || codes.has(name)]).toEqual([name, true]);
  });

  it("cita el permiso, las acciones y los códigos, y observability.md las métricas", () => {
    expect(POLICY).toContain('"dataPortability.export"');
    expect(DOC).toContain("dataPortability.export");
    const actions = AUDIT_ACTIONS.filter((action) => action.startsWith("data_export."));
    expect(actions).toHaveLength(4);
    for (const action of actions) expect(DOC).toContain(action);
    for (const code of [...DATA_EXPORT_FAILURE_CODES, ...DATA_EXPORT_ERROR_CODES])
      expect(DOC).toContain(code);
    const metrics = [...METRICS.matchAll(/name: "([a-z_]+)"/g)].map((match) => match[1]!);
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) expect(OBSERVABILITY).toContain(metric);
  });

  it("la pantalla documentada coincide con la navegación implementada", () => {
    const entry =
      /\{\s*href: "(\/configuracion\/portabilidad)",\s*label: "([^"]+)",\s*icon: \w+,\s*permission: "([^"]+)",?\s*\}/.exec(
        NAVIGATION,
      );
    expect(entry?.slice(1)).toEqual([
      "/configuracion/portabilidad",
      "Portabilidad de datos",
      "dataPortability.export",
    ]);
    // En el grupo Configuración: después de su etiqueta y de la entrada de Usuarios.
    const group = NAVIGATION.indexOf('label: "Configuración"');
    expect(group).toBeGreaterThan(-1);
    expect(NAVIGATION.indexOf('href: "/configuracion/portabilidad"')).toBeGreaterThan(group);
    const screen = DOC.slice(DOC.indexOf("## Pantalla"));
    expect(screen).toContain("Portabilidad de datos, en `/configuracion/portabilidad`");
    expect(screen).toContain("grupo Configuración");
    expect(screen).toContain("`dataPortability.export`");
  });

  it("backend.md declara el dueño del job y que no se cancela", () => {
    expect(BACKEND).toMatch(/`data-portability`, de `portability\.export`/);
    expect(BACKEND).toMatch(/`portability\.export` no se cancelan en la versión 1/);
  });
});
