// Endpoints del SRI por ambiente y servicio (add-sri-transmission, tarea 5.1, design D10): los de
// CTX §7, que son las direcciones SOAP de los WSDL oficiales, sobrescribibles por configuración, y
// ninguna URL del SRI fuera de su módulo central.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SRI_DEFAULT_ENDPOINTS,
  endpointsValid,
  resolveSriEndpoints,
} from "../../src/modules/sri-engine/infrastructure/endpoints.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const WSDL_DIR = fileURLToPath(new URL("../../../docs/product/sri-wsdl/", import.meta.url));
const SRI_HOSTS = /celcer\.sri\.gob\.ec|\bcel\.sri\.gob\.ec|comprobantes-electronicos-ws/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("endpoints del SRI", () => {
  it("los de Pruebas son las direcciones SOAP de los WSDL oficiales", () => {
    const address = (file: string) =>
      /<soap:address location="([^"]+)"/.exec(readFileSync(join(WSDL_DIR, file), "utf8"))?.[1];
    expect(SRI_DEFAULT_ENDPOINTS.TEST).toEqual({
      RECEPTION: address("RecepcionComprobantesOffline.wsdl"),
      AUTHORIZATION: address("AutorizacionComprobantesOffline.wsdl"),
      VALIDITY: address("ConsultaComprobante.wsdl"),
    });
  });

  it("los de Producción son los de CTX §7.2 y §7.4, sin `?wsdl`", () => {
    expect(SRI_DEFAULT_ENDPOINTS.PRODUCTION).toEqual({
      RECEPTION: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
      AUTHORIZATION:
        "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline",
      VALIDITY: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante",
    });
  });

  it("cada variable sobrescribe solo su ambiente y su servicio", () => {
    const endpoints = resolveSriEndpoints({
      SRI_ENDPOINT_TEST_RECEPTION: "http://127.0.0.1:9000/recepcion",
      SRI_ENDPOINT_PRODUCTION_VALIDITY: "https://sri-simulado.invalid/consulta",
    });
    expect(endpoints.TEST.RECEPTION).toBe("http://127.0.0.1:9000/recepcion");
    expect(endpoints.TEST.AUTHORIZATION).toBe(SRI_DEFAULT_ENDPOINTS.TEST.AUTHORIZATION);
    expect(endpoints.PRODUCTION.VALIDITY).toBe("https://sri-simulado.invalid/consulta");
    expect(endpoints.PRODUCTION.RECEPTION).toBe(SRI_DEFAULT_ENDPOINTS.PRODUCTION.RECEPTION);
    expect(resolveSriEndpoints()).toEqual(SRI_DEFAULT_ENDPOINTS);
  });

  it("son válidos con https, o con http solo fuera de producción", () => {
    expect(endpointsValid(SRI_DEFAULT_ENDPOINTS, true)).toBe(true);
    const local = resolveSriEndpoints({ SRI_ENDPOINT_TEST_RECEPTION: "http://127.0.0.1:9/r" });
    expect(endpointsValid(local, false)).toBe(true);
    expect(endpointsValid(local, true)).toBe(false);
    const broken = resolveSriEndpoints({ SRI_ENDPOINT_TEST_AUTHORIZATION: "no es una url" });
    expect(endpointsValid(broken, false)).toBe(false);
  });

  it("ninguna URL de los servicios del SRI aparece fuera del módulo central", () => {
    const offenders = files(SRC)
      .map((path) => relative(SRC, path))
      .filter((path) => path !== join("modules", "sri-engine", "infrastructure", "endpoints.ts"))
      .filter((path) => !path.startsWith("generated"))
      .filter((path) => SRI_HOSTS.test(readFileSync(join(SRC, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});
