// Tope de seguridad de la certificación (add-sri-certification-safety-cap, tareas 2.1 a 2.3, design
// D1 a D6), sin base de datos: la resolución del límite efectivo, el borde estricto, el orden de la
// recepción y la guarda del ambiente en el punto común de las llamadas al SRI. El tope NO es el límite
// oficial del SRI (Q-47 abierta). Las respuestas son sintéticas y no hay ninguna llamada de red.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  CertificationCheck,
  CertificationSession,
} from "../../src/modules/fiscal/application/certification-session.ts";
import type { StoredArtifact, StoredDocument } from "../../src/modules/fiscal/application/ports.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import {
  executeSriStep,
  type StepDependencies,
} from "../../src/modules/fiscal/application/transmission-step.ts";
import {
  CERTIFICATION_SAFETY_CAP_BYTES,
  resolveSizePolicySource,
  withinCertificationSafetyCap,
} from "../../src/modules/fiscal/domain/certification-safety-cap.ts";
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

const KEY = "0910202601179001234500110010010000000015087300712";
const CAP = CERTIFICATION_SAFETY_CAP_BYTES;
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

const documentIn = (environment: "TEST" | "PRODUCTION") =>
  ({
    id: "doc-1",
    companyId: "empresa-1",
    documentType: "01",
    environment,
    accessKey: KEY,
    state: "SIGNED",
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
  checks: CertificationCheck[];
  /** Lo registrado (logs y alertas), para comprobar que no lleva contenido. */
  logs: object[];
  attempts: number;
  transitions: number;
  run: () => Promise<void>;
};

function harness(options: {
  environment?: "TEST" | "PRODUCTION";
  policy?: { maxSignedDocumentBytes: number } | null;
  certification?: boolean;
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
  const session: CertificationSession = {
    enabled: options.certification ?? false,
    observe: (check) => void h.checks.push(check),
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
    certification: session,
    documents: { find: () => Promise.resolve(documentIn(options.environment ?? "TEST")) },
    artifacts: { read: () => Promise.resolve(artifact) },
    sizePolicy: () => Promise.resolve(options.policy ?? null),
    gateway,
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
    today: () => "2026-10-09",
    alert: (details) => void h.logs.push(details),
  });
  h.run = () => handler.run(job, { signal: new AbortController().signal, now: () => new Date(0) });
  return h;
}

describe("resolución del límite efectivo (design D3)", () => {
  it("distingue las cuatro fuentes y nunca llama política oficial al tope", () => {
    expect(resolveSizePolicySource({ officialPolicy: true, certificationSession: false })).toBe(
      "SRI_OFFICIAL_POLICY",
    );
    expect(resolveSizePolicySource({ officialPolicy: true, certificationSession: true })).toBe(
      "SRI_OFFICIAL_AND_CERTIFICATION_CAP",
    );
    expect(resolveSizePolicySource({ officialPolicy: false, certificationSession: true })).toBe(
      "CERTIFICATION_CONSERVATIVE_CAP",
    );
    expect(resolveSizePolicySource({ officialPolicy: false, certificationSession: false })).toBe(
      "MISSING",
    );
  });

  it("el tope es 40 000 bytes con comparación estricta en las tres medidas", () => {
    expect(CAP).toBe(40_000);
    expect(withinCertificationSafetyCap(sized(39_999, 39_999, 39_999).sizes)).toBe(true);
    for (const [signed, base64, soap] of [
      [40_000, 1, 1],
      [1, 40_000, 1],
      [1, 1, 40_000],
      [40_001, 40_001, 40_001],
    ] as const) {
      expect(withinCertificationSafetyCap(sized(signed, base64, soap).sizes)).toBe(false);
    }
  });
});

describe("recepción con el tope de seguridad de la certificación", () => {
  it("A. sin política oficial y con la sesión apagada: SIZE_POLICY_MISSING y ninguna llamada", async () => {
    const h = harness({ certification: false, policy: null });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["SIZE_POLICY_MISSING"]);
    expect(h.submits).toHaveLength(0);
    expect(h.prepared).toHaveLength(0);
    expect(h.attempts).toBe(0);
  });

  it("B. sin política oficial, sesión encendida, Pruebas y medidas de 39 999: llega al transporte", async () => {
    const h = harness({
      certification: true,
      policy: null,
      prepare: () => sized(39_999, 39_999, 39_999),
    });
    await h.run();
    expect(h.stops).toEqual([]);
    expect(h.submits).toHaveLength(1);
    expect(h.submits[0]!.environment).toBe("TEST");
    expect(h.submits[0]!.prepared).toBe(h.prepared[0]);
    expect(h.checks).toEqual([
      expect.objectContaining({
        allowed: true,
        reason: null,
        fiscalEnvironment: "TEST",
        capBytes: CAP,
        effectiveSizePolicySource: "CERTIFICATION_CONSERVATIVE_CAP",
        sizes: { signedXmlBytes: 39_999, base64PayloadBytes: 39_999, soapRequestBytes: 39_999 },
      }),
    ]);
  });

  it("cada envío o bloqueo de la sesión registra el ambiente y las tres medidas, sin XML, base64 ni SOAP", async () => {
    const passed = harness({ certification: true, policy: null });
    await passed.run();
    const blocked = harness({
      certification: true,
      policy: null,
      prepare: () => sized(40_000, 1, 1),
    });
    await blocked.run();
    for (const h of [passed, blocked]) {
      const entry = h.logs.find((log) => "soapRequestBytes" in log);
      expect(entry).toMatchObject({
        fiscalEnvironment: "TEST",
        capBytes: CAP,
        effectiveSizePolicySource: "CERTIFICATION_CONSERVATIVE_CAP",
      });
      expect(entry).toHaveProperty("signedXmlBytes");
      expect(entry).toHaveProperty("base64PayloadBytes");
      const text = JSON.stringify(h.logs);
      expect(text).not.toContain(KEY.slice(0, 20));
      expect(text).not.toContain(signedXml.toString("base64").slice(0, 40));
      expect(text).not.toMatch(/<factura|Envelope|validarComprobante/);
    }
  });

  it("C. exactamente 40 000: CERTIFICATION_SIZE_CAP_EXCEEDED, sin llamada, intento ni transición", async () => {
    const h = harness({
      certification: true,
      policy: null,
      prepare: () => sized(40_000, 40_000, 40_000),
    });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["CERTIFICATION_SIZE_CAP_EXCEEDED"]);
    expect(h.stops[0]!.errorClass).toBe("DETERMINISTIC");
    expect(h.stops[0]!.detail).toMatchObject({
      soapRequestBytes: 40_000,
      capBytes: CAP,
      fiscalEnvironment: "TEST",
      effectiveSizePolicySource: "CERTIFICATION_CONSERVATIVE_CAP",
    });
    expect(h.submits).toHaveLength(0);
    expect(h.attempts).toBe(0);
    expect(h.transitions).toBe(0);
  });

  it("más de 40 000: bloqueado y sin llamada", async () => {
    const h = harness({
      certification: true,
      policy: null,
      prepare: () => sized(40_001, 53_336, 53_600),
    });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["CERTIFICATION_SIZE_CAP_EXCEEDED"]);
    expect(h.submits).toHaveLength(0);
  });

  it("el XML por debajo y el base64 en el tope: bloqueado", async () => {
    const h = harness({
      certification: true,
      policy: null,
      prepare: () => sized(30_000, 40_000, 39_000),
    });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["CERTIFICATION_SIZE_CAP_EXCEEDED"]);
    expect(h.submits).toHaveLength(0);
  });

  it("D. el XML y el base64 por debajo y el SOAP en el tope: bloqueado", async () => {
    const h = harness({
      certification: true,
      policy: null,
      prepare: () => sized(29_000, 39_000, 40_000),
    });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["CERTIFICATION_SIZE_CAP_EXCEEDED"]);
    expect(h.submits).toHaveLength(0);
  });

  it("E. Producción con la sesión encendida: CERTIFICATION_ENVIRONMENT_NOT_TEST antes de todo, sin red", async () => {
    for (const policy of [null, { maxSignedDocumentBytes: 1_000_000 }]) {
      const h = harness({ certification: true, environment: "PRODUCTION", policy });
      await h.run();
      expect(h.stops.map((stop) => stop.code)).toEqual(["CERTIFICATION_ENVIRONMENT_NOT_TEST"]);
      expect(h.submits).toHaveLength(0);
      expect(h.prepared).toHaveLength(0);
      expect(h.attempts).toBe(0);
      expect(h.checks).toEqual([
        expect.objectContaining({
          allowed: false,
          reason: "CERTIFICATION_ENVIRONMENT_NOT_TEST",
          fiscalEnvironment: "PRODUCTION",
        }),
      ]);
    }
  });

  it("Producción con la sesión apagada y una política: se envía como siempre (la sesión no existe)", async () => {
    const h = harness({
      certification: false,
      environment: "PRODUCTION",
      policy: { maxSignedDocumentBytes: 300_000 },
    });
    await h.run();
    expect(h.stops).toEqual([]);
    expect(h.submits.map((submit) => submit.environment)).toEqual(["PRODUCTION"]);
    expect(h.checks).toEqual([]);
  });

  it("F. una política oficial más estricta bloquea con su propio motivo", async () => {
    const h = harness({
      certification: true,
      policy: { maxSignedDocumentBytes: signedXml.length - 1 },
    });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["TOO_LARGE"]);
    expect(h.submits).toHaveLength(0);
  });

  it("G. con una política oficial más permisiva, el tope sigue bloqueando desde 40 000", async () => {
    const h = harness({
      certification: true,
      policy: { maxSignedDocumentBytes: 10_000_000 },
      prepare: () => sized(30_000, 40_000, 40_280),
    });
    await h.run();
    expect(h.stops.map((stop) => stop.code)).toEqual(["CERTIFICATION_SIZE_CAP_EXCEEDED"]);
    expect(h.stops[0]!.detail).toMatchObject({
      effectiveSizePolicySource: "SRI_OFFICIAL_AND_CERTIFICATION_CAP",
    });
    expect(h.submits).toHaveLength(0);
  });

  it("con la sesión apagada, el tope no existe y rige solo la política oficial", async () => {
    const h = harness({
      certification: false,
      policy: { maxSignedDocumentBytes: 10_000_000 },
      prepare: () => sized(50_000, 66_668, 66_900),
    });
    await h.run();
    expect(h.stops).toEqual([]);
    expect(h.submits).toHaveLength(1);
    expect(h.checks).toEqual([]);
  });

  it("H. el cuerpo medido es exactamente el Buffer que recibe el transporte, con su ambiente", async () => {
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
      certification: true,
      policy: null,
      gateway: {
        prepareReception: (signed) => {
          const value = real.prepareReception(signed);
          prepared.push(value);
          return value;
        },
        submit: (environment, value) => real.submit(environment, value),
      },
    });
    await expect(h.run()).rejects.toThrow("sin red en la prueba");
    expect(received).toHaveLength(1);
    expect(received[0]!.envelope).toBe(prepared[0]!.envelope);
    expect(received[0]!.envelope.length).toBe(h.checks[0]!.sizes!.soapRequestBytes);
    expect(received[0]!.environment).toBe("TEST");
    expect(received[0]!.service).toBe("RECEPTION");
    expect(h.checks[0]!.sizes).toEqual(prepareReception(signedXml).sizes);
  });
});

describe("guarda del ambiente en el punto común de las llamadas al SRI (design D4)", () => {
  const stepDeps = (enabled: boolean, stops: JobError[]): StepDependencies =>
    ({
      db: {} as DbClient,
      evidence: { unclassified: () => Promise.resolve(null) },
      uow: { run: () => Promise.reject(new Error("no debe haber transición")) },
      jobs: {
        stop: (_db: DbClient, _job: Job, error: JobError) => {
          stops.push(error);
          return Promise.resolve();
        },
      },
      logger: { info: () => {}, warn: () => {} },
      followers: [],
      certification: { enabled, observe: () => {} },
    }) as unknown as StepDependencies;

  it("I. con la sesión encendida, la autorización y la consulta de un comprobante de Producción no hacen red", async () => {
    for (const operation of ["AUTHORIZATION", "VALIDITY", "RECEPTION"] as const) {
      const stops: JobError[] = [];
      let calls = 0;
      const result = await executeSriStep(
        stepDeps(true, stops),
        {
          operation,
          call: () => {
            calls += 1;
            return Promise.reject(new Error("no debe llamar"));
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
      expect(result).toBe("CERTIFICATION_BLOCKED");
      expect(calls).toBe(0);
      expect(stops).toEqual([
        expect.objectContaining({
          code: "CERTIFICATION_ENVIRONMENT_NOT_TEST",
          errorClass: "DETERMINISTIC",
          detail: { fiscalEnvironment: "PRODUCTION", operation },
        }),
      ]);
    }
  });

  it("con la sesión apagada, la guarda no existe y la llamada ocurre", async () => {
    const stops: JobError[] = [];
    let calls = 0;
    const result = await executeSriStep(
      stepDeps(false, stops),
      {
        operation: "AUTHORIZATION",
        call: () => {
          calls += 1;
          return Promise.resolve({
            breakerOpen: true as const,
            service: "AUTHORIZATION" as const,
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
    ).catch((error: unknown) => error);
    expect(calls).toBe(1);
    expect(stops).toEqual([]);
    expect(result).not.toBe("CERTIFICATION_BLOCKED");
  });
});
