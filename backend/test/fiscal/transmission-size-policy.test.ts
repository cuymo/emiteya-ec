// Política conservadora de tamaño de EmiteYa (adopt-conservative-sri-transmission-size-policy-v1,
// tareas 1.1 y 2.2, design D1 a D5), sin base de datos. Cubre:
// - el borde estricto de las tres medidas;
// - la misma decisión en Pruebas y en Producción;
// - el bloqueo antes de la red;
// - que el cuerpo medido es el que recibe el transporte;
// - el diagnóstico sin contenido.
// La política NO es el límite oficial del SRI. Las respuestas son sintéticas y no hay ninguna llamada de
// red.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TransmissionSizeCheck } from "../../src/modules/fiscal/application/transmission-size-diagnostics.ts";
import type { StoredArtifact, StoredDocument } from "../../src/modules/fiscal/application/ports.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import {
  executeSriStep,
  type StepDependencies,
} from "../../src/modules/fiscal/application/transmission-step.ts";
import {
  TRANSMISSION_SIZE_POLICY,
  withinTransmissionSizePolicy,
} from "../../src/modules/fiscal/domain/transmission-size-policy.ts";
import type {
  PreparedReception,
  SriExchangeRequest,
  SriGateway,
} from "../../src/modules/sri-engine/application/transport.ts";
import { createCircuitBreaker } from "../../src/modules/sri-engine/infrastructure/circuit-breaker.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import { prepareReception } from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import { createSriGateway } from "../../src/modules/sri-engine/infrastructure/sri-gateway.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import type { Job, JobError, JobStore } from "../../src/platform/jobs/jobs.ts";

type Environment = "TEST" | "PRODUCTION";
const KEY = "0910202601179001234500110010010000000015087300712";
const LIMIT = TRANSMISSION_SIZE_POLICY.limitBytes;
const signedXml = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante"><infoTributaria><claveAcceso>${KEY}</claveAcceso></infoTributaria></factura>`,
);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const job = {
  id: "job-1",
  companyId: "empresa-1",
  type: "sri.transmit",
  documentId: "doc-1",
  attemptCount: 1,
  origin: "AUTOMATIC",
  requestedBy: null,
} as unknown as Job;

const documentIn = (environment: Environment, state = "SIGNED") =>
  ({
    id: "doc-1",
    companyId: "empresa-1",
    documentType: "01",
    environment,
    accessKey: KEY,
    state,
    schemaVersion: "1.1.0",
    snapshot: { key: { accessKey: KEY } },
  }) as unknown as StoredDocument;

const artifact = {
  content: signedXml,
  sizeBytes: signedXml.length,
  sha256: sha256(signedXml),
  metadata: { documentType: "01", schemaVersion: "1.1.0" },
} as unknown as StoredArtifact;

/** Medidas a elección: la aritmética real del base64 y del sobre se prueba aparte. */
const sized = (signed: number, base64: number, soap: number): PreparedReception => ({
  envelope: Buffer.from("cuerpo-medido"),
  sizes: { signedXmlBytes: signed, base64PayloadBytes: base64, soapRequestBytes: soap },
});

type Harness = {
  stops: JobError[];
  submits: { environment: string; prepared: PreparedReception }[];
  prepared: PreparedReception[];
  checks: TransmissionSizeCheck[];
  /** Lo registrado (logs y alertas), para comprobar que no lleva contenido. */
  logs: object[];
  attempts: number;
  transitions: number;
  run: () => Promise<void>;
};

function harness(options: {
  environment?: Environment;
  state?: string;
  prepare?: (signed: Buffer) => PreparedReception;
  gateway?: Pick<SriGateway, "prepareReception" | "submit">;
}): Harness {
  const h: Harness = {
    stops: [],
    submits: [],
    prepared: [],
    checks: [],
    logs: [],
    attempts: 0,
    transitions: 0,
    run: async () => {},
  };
  const jobs = {
    stop: (_db: DbClient, _job: Job, error: JobError) => {
      h.stops.push(error);
      return Promise.resolve();
    },
    complete: () => Promise.resolve(),
    reschedule: () => Promise.resolve(),
  } as unknown as JobStore;
  // Un gateway espía con el breaker abierto: llegar a él es «llegar al transporte», sin red.
  const gateway: Pick<SriGateway, "prepareReception" | "submit"> = options.gateway ?? {
    prepareReception: (signed) => {
      const prepared = (options.prepare ?? prepareReception)(signed);
      h.prepared.push(prepared);
      return prepared;
    },
    submit: (environment, prepared) => {
      h.submits.push({ environment, prepared });
      return Promise.resolve({
        breakerOpen: true as const,
        service: "RECEPTION" as const,
        retryAt: new Date(0),
      });
    },
  };
  const handler = createTransmitHandler({
    db: {} as DbClient,
    evidence: {
      unclassified: () => Promise.resolve(null),
      countForJob: () => Promise.resolve(0),
      record: () => {
        h.attempts += 1;
        return Promise.reject(new Error("no debe registrarse un intento"));
      },
    } as unknown as StepDependencies["evidence"],
    uow: {
      run: () => {
        h.transitions += 1;
        return Promise.reject(new Error("no debe haber transición"));
      },
    },
    jobs,
    logger: {
      info: (details) => void h.logs.push(details),
      warn: (details) => void h.logs.push(details),
    },
    followers: [],
    documents: {
      find: () => Promise.resolve(documentIn(options.environment ?? "TEST", options.state)),
    },
    artifacts: { read: () => Promise.resolve(artifact) },
    gateway,
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
    alert: (details) => void h.logs.push(details),
    sizeDiagnostics: { observe: (check) => void h.checks.push(check) },
  });
  h.run = () => handler.run(job, { signal: new AbortController().signal, now: () => new Date(0) });
  return h;
}

describe("la política conservadora de tamaño (design D1)", () => {
  it("es PRODUCT_CONSERVATIVE_POLICY_V1, de 40 000 bytes y fija", () => {
    expect(TRANSMISSION_SIZE_POLICY).toEqual({
      id: "PRODUCT_CONSERVATIVE_POLICY_V1",
      limitBytes: 40_000,
    });
    expect(Object.isFrozen(TRANSMISSION_SIZE_POLICY)).toBe(true);
  });

  it("39 999 pasa; 40 000 y 40 001 se bloquean, en cualquiera de las tres medidas", () => {
    expect(withinTransmissionSizePolicy(sized(39_999, 39_999, 39_999).sizes)).toBe(true);
    for (const [signed, base64, soap] of [
      [40_000, 1, 1],
      [1, 40_000, 1],
      [1, 1, 40_000],
      [40_000, 40_000, 40_000],
      [40_001, 1, 1],
      [1, 40_001, 1],
      [1, 1, 40_001],
    ] as const) {
      expect(withinTransmissionSizePolicy(sized(signed, base64, soap).sizes)).toBe(false);
    }
  });
});

describe("recepción con la política, en Pruebas y en Producción (design D2)", () => {
  it("39 999 en las tres medidas llega al transporte, con su ambiente y el cuerpo medido", async () => {
    for (const environment of ["TEST", "PRODUCTION"] as const) {
      const h = harness({ environment, prepare: () => sized(39_999, 39_999, 39_999) });
      await h.run();
      expect(h.stops).toEqual([]);
      expect(h.submits).toHaveLength(1);
      expect(h.submits[0]!.environment).toBe(environment);
      expect(h.submits[0]!.prepared).toBe(h.prepared[0]);
      expect(h.checks).toEqual([
        {
          signedXmlBytes: 39_999,
          base64PayloadBytes: 39_999,
          soapRequestBytes: 39_999,
          allowed: true,
          blockReason: null,
        },
      ]);
    }
  });

  it("exactamente 40 000 se detiene con TRANSMISSION_SIZE_POLICY_EXCEEDED, sin red, intento ni transición", async () => {
    for (const environment of ["TEST", "PRODUCTION"] as const) {
      const h = harness({ environment, prepare: () => sized(40_000, 40_000, 40_000) });
      await h.run();
      expect(h.stops).toEqual([
        {
          code: "TRANSMISSION_SIZE_POLICY_EXCEEDED",
          errorClass: "DETERMINISTIC",
          detail: {
            fiscalEnvironment: environment,
            signedXmlBytes: 40_000,
            base64PayloadBytes: 40_000,
            soapRequestBytes: 40_000,
            limitBytes: LIMIT,
            policyId: "PRODUCT_CONSERVATIVE_POLICY_V1",
          },
        },
      ]);
      expect(h.submits).toHaveLength(0);
      expect(h.attempts).toBe(0);
      expect(h.transitions).toBe(0);
      expect(h.checks).toEqual([
        expect.objectContaining({
          allowed: false,
          blockReason: "TRANSMISSION_SIZE_POLICY_EXCEEDED",
        }),
      ]);
    }
  });

  it("40 001 se detiene sin red", async () => {
    const h = harness({ prepare: () => sized(40_001, 53_336, 53_600) });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["TRANSMISSION_SIZE_POLICY_EXCEEDED"]);
    expect(h.submits).toHaveLength(0);
  });

  it("el XML firmado, el base64 o el SOAP, cada uno solo en el límite, detienen el envío", async () => {
    for (const [signed, base64, soap] of [
      [40_000, 1, 1],
      [30_000, 40_000, 39_000],
      [29_000, 39_000, 40_000],
    ] as const) {
      const h = harness({ prepare: () => sized(signed, base64, soap) });
      await h.run();
      expect(h.stops.map((stop) => stop.code)).toEqual(["TRANSMISSION_SIZE_POLICY_EXCEEDED"]);
      expect(h.submits).toHaveLength(0);
      expect(h.attempts).toBe(0);
    }
  });

  it("Pruebas y Producción con las mismas medidas deciden lo mismo", async () => {
    for (const [signed, base64, soap] of [
      [39_999, 39_999, 39_999],
      [39_999, 39_999, 40_000],
    ] as const) {
      const decisions = [];
      for (const environment of ["TEST", "PRODUCTION"] as const) {
        const h = harness({ environment, prepare: () => sized(signed, base64, soap) });
        await h.run();
        decisions.push({ stops: h.stops.map((stop) => stop.code), sent: h.submits.length });
      }
      expect(decisions[0]).toEqual(decisions[1]);
    }
  });

  it("un reenvío desde SEND_UNKNOWN también pasa por la política", async () => {
    const h = harness({ state: "SEND_UNKNOWN", prepare: () => sized(1, 1, 40_000) });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["TRANSMISSION_SIZE_POLICY_EXCEEDED"]);
    expect(h.submits).toHaveLength(0);
  });

  it("cada comprobación registra el ambiente y las tres medidas, sin XML, base64 ni SOAP", async () => {
    const passed = harness({});
    await passed.run();
    const blocked = harness({ prepare: () => sized(40_000, 1, 1) });
    await blocked.run();
    for (const h of [passed, blocked]) {
      const entry = h.logs.find((log) => "soapRequestBytes" in log);
      expect(entry).toMatchObject({
        fiscalEnvironment: "TEST",
        limitBytes: LIMIT,
        policyId: "PRODUCT_CONSERVATIVE_POLICY_V1",
      });
      expect(entry).toHaveProperty("signedXmlBytes");
      expect(entry).toHaveProperty("base64PayloadBytes");
      const text = JSON.stringify([h.logs, h.checks, h.stops]);
      expect(text).not.toContain(KEY.slice(0, 20));
      expect(text).not.toContain(signedXml.toString("base64").slice(0, 40));
      expect(text).not.toMatch(/<factura|Envelope|validarComprobante/);
    }
  });

  it("el cuerpo medido es exactamente el Buffer que recibe el transporte", async () => {
    for (const environment of ["TEST", "PRODUCTION"] as const) {
      const received: SriExchangeRequest[] = [];
      const real = createSriGateway({
        transport: {
          exchange: (request) => {
            received.push(request);
            return Promise.reject(new Error("sin red en la prueba"));
          },
        },
        breaker: createCircuitBreaker({ failures: 3, cooldownMs: 1_000 }),
      });
      const prepared: PreparedReception[] = [];
      const h = harness({
        environment,
        gateway: {
          prepareReception: (signed) => {
            const value = real.prepareReception(signed);
            prepared.push(value);
            return value;
          },
          submit: (target, value) => real.submit(target, value),
        },
      });
      await expect(h.run()).rejects.toThrow("sin red en la prueba");
      expect(received).toHaveLength(1);
      expect(received[0]!.envelope).toBe(prepared[0]!.envelope);
      expect(received[0]!.envelope.length).toBe(h.checks[0]!.soapRequestBytes);
      expect(received[0]!.environment).toBe(environment);
      expect(received[0]!.service).toBe("RECEPTION");
      expect(h.checks[0]).toMatchObject(prepareReception(signedXml).sizes);
    }
  });
});

describe("sin bloqueo por ambiente en el punto común de las llamadas (design D3)", () => {
  it("la autorización y la consulta de un comprobante de Producción llegan al transporte", async () => {
    for (const operation of ["AUTHORIZATION", "VALIDITY", "RECEPTION"] as const) {
      const stops: JobError[] = [];
      let calls = 0;
      const result = await executeSriStep(
        {
          db: {} as DbClient,
          evidence: { unclassified: () => Promise.resolve(null) },
          uow: { run: () => Promise.reject(new Error("no debe haber transición")) },
          jobs: {
            stop: (_db: DbClient, _job: Job, error: JobError) => {
              stops.push(error);
              return Promise.resolve();
            },
            reschedule: () => Promise.resolve(),
          },
          logger: { info: () => {}, warn: () => {} },
          followers: [],
        } as unknown as StepDependencies,
        {
          operation,
          call: () => {
            calls += 1;
            return Promise.resolve({
              breakerOpen: true as const,
              service: operation === "RECEPTION" ? "RECEPTION" : "AUTHORIZATION",
              retryAt: new Date(0),
            });
          },
          classify: () => {
            throw new Error("no debe clasificar");
          },
          decide: () => {
            throw new Error("no debe decidir");
          },
        },
        {
          job,
          document: documentIn("PRODUCTION"),
          signal: new AbortController().signal,
          now: () => new Date(0),
        },
      );
      expect(result).toBe("BREAKER_OPEN");
      expect(calls).toBe(1);
      expect(stops).toEqual([]);
    }
  });
});
