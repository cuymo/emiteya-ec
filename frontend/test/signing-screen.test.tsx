import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { SigningScreen } from "@/features/signing/signing-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const INCOMPATIBLE_MESSAGE =
  "Este archivo PKCS#12 utiliza una combinación de formato y contraseña que no podemos procesar. Intenta exportarlo nuevamente usando una contraseña con caracteres ASCII.";

const certificate = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  subject: "C=EC, O=Empresa, CN=ANA PEREZ",
  issuer: "C=EC, O=Security Data, CN=AUTORIDAD DE CERTIFICACION SUBCA-2 SECURITY DATA",
  serialNumber: "5c853345b350b408",
  fingerprint: "ab".repeat(32),
  notBefore: "2026-01-01T05:00:00.000Z",
  notAfter: "2027-11-12T05:00:00.000Z",
  detectedRuc: "1790012345001",
  companyRuc: "1790012345001",
  rucMatch: "MATCH",
  state: "VALID",
  usable: true,
  daysToExpiry: 406,
  uploadedAt: "2026-10-02T15:00:00.000Z",
  ...overrides,
});

function renderScreen(
  current: () => Record<string, unknown> | null,
  routes: Record<string, Route> = {},
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
  maxBytes = 65536,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/signing-certificate": () => ({
      status: 200,
      body: { data: { certificate: current(), expiryAlertDays: 30, maxBytes } },
    }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <SigningScreen />
    </SessionGate>,
  );
  return calls;
}

const p12 = (name = "firma.p12") =>
  new File([new Uint8Array([48, 130, 1, 2, 3])], name, { type: "application/x-pkcs12" });

async function fillDialog(password = "Clave-Prueba-2026", file = p12()) {
  const dialog = screen.getByRole("dialog");
  const user = userEvent.setup();
  await user.upload(dialog.querySelector('input[type="file"]')!, file);
  await user.type(within(dialog).getByLabelText("Contraseña de la firma"), password);
  return { dialog, user };
}

beforeEach(() => {
  navigation.pathname = "/configuracion/firma";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Firma electrónica (design D14)", () => {
  it("sin firma, el vacío ofrece cargarla", async () => {
    renderScreen(() => null);
    expect(await screen.findByText("Carga la firma electrónica para poder emitir")).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cargar firma" }));
    expect(
      within(screen.getByRole("dialog")).getByText("Cargar firma", { selector: "h2" }),
    ).toBeDefined();
  });

  it("muestra estado, vencimiento, titular, RUC, emisor, serie y fecha de carga", async () => {
    renderScreen(() => certificate());
    expect(await screen.findByText("Utilizable")).toBeDefined();
    expect(screen.getByText("Vence el 12/11/2027 (faltan 406 días).")).toBeDefined();
    expect(screen.getByText("ANA PEREZ")).toBeDefined();
    expect(screen.getByText("1790012345001")).toBeDefined();
    expect(screen.getByText("AUTORIDAD DE CERTIFICACION SUBCA-2 SECURITY DATA")).toBeDefined();
    expect(screen.getByText("5c853345b350b408")).toBeDefined();
    expect(screen.getByText("02/10/2026")).toBeDefined();
    expect(screen.getByText("Coincide con el RUC de la empresa.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Reemplazar firma" })).toBeDefined();
  });

  it("un RUC distinto se advierte como comprobación preventiva, no como error del SRI", async () => {
    renderScreen(() => certificate({ rucMatch: "MISMATCH", companyRuc: "0992877878001" }));
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain(
      "(1790012345001) es distinto del RUC de la empresa (0992877878001)",
    );
    expect(note.textContent).toContain(
      "comprobación preventiva de esta aplicación: la firma se puede usar",
    );
    expect(note.textContent).not.toContain("SRI");
  });

  it("por vencer", async () => {
    renderScreen(() => certificate({ state: "EXPIRING", daysToExpiry: 9 }));
    expect(await screen.findByText("Por vencer")).toBeDefined();
    expect(
      screen.getByText(/faltan 9 días\)\. Renueva la firma antes de esa fecha\./),
    ).toBeDefined();
  });

  it("vencida", async () => {
    renderScreen(() => certificate({ state: "EXPIRED", usable: false, daysToExpiry: -3 }));
    expect(await screen.findByText("Vencida")).toBeDefined();
    expect(
      screen.getByText("Venció el 12/11/2027: no se puede emitir hasta cargar una firma vigente."),
    ).toBeDefined();
  });

  it("no disponible", async () => {
    renderScreen(() => certificate({ state: "KEY_UNAVAILABLE", usable: false }));
    expect(await screen.findByText("No disponible")).toBeDefined();
    expect(screen.getByText(/no abre esta firma: vuelve a cargarla/)).toBeDefined();
  });

  it("un error de carga ofrece reintentar", async () => {
    let fail = true;
    renderScreen(() => null, {
      "GET /api/v1/signing-certificate": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") }
          : {
              status: 200,
              body: { data: { certificate: null, expiryAlertDays: 30, maxBytes: 65536 } },
            },
    });
    const alert = await screen.findByRole("alert", undefined, { timeout: 5_000 });
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button"));
    expect(await screen.findByText("Carga la firma electrónica para poder emitir")).toBeDefined();
  }, 10_000);

  it("un operador no tiene permiso y no se consulta la firma", async () => {
    const calls = renderScreen(() => certificate(), {}, OPERATOR_ME);
    expect(await screen.findByText("No tienes permiso para ver esta sección")).toBeDefined();
    expect(calls.some((call) => call.key === "GET /api/v1/signing-certificate")).toBe(false);
  });

  it("fija la anticipación del aviso, validada entre 1 y 90", async () => {
    const calls = renderScreen(() => certificate(), {
      "PUT /api/v1/signing-certificate/expiry-alert": () => ({
        status: 200,
        body: { data: { expiryAlertDays: 45 } },
      }),
    });
    const input = await screen.findByLabelText("Aviso de vencimiento");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "95");
    await user.click(screen.getByRole("button", { name: "Guardar aviso" }));
    expect(await screen.findByText(/entre 1 y 90/)).toBeDefined();
    await user.clear(input);
    await user.type(input, "45");
    await user.click(screen.getByRole("button", { name: "Guardar aviso" }));
    expect(
      await screen.findByText("El aviso de vencimiento aparecerá con 45 días de anticipación."),
    ).toBeDefined();
    expect(
      calls.find((call) => call.key === "PUT /api/v1/signing-certificate/expiry-alert")?.body,
    ).toEqual({ days: 45 });
  });

  it("sin cambios en el aviso lo dice y no envía nada", async () => {
    const calls = renderScreen(() => certificate());
    const save = await screen.findByRole("button", { name: "Guardar aviso" });
    // Disponible siempre, como acción secundaria junto a «Reemplazar firma».
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Reemplazar firma" })).toBeDefined();
    await userEvent.setup().click(save);
    expect(await screen.findByText(/El aviso ya está en \d+ días\./)).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("PUT"))).toBe(false);
  });
});

describe("diálogo Cargar o Reemplazar firma (design D14)", () => {
  it.each([
    [65536, "64 KiB", true],
    [131072, "128 KiB", false],
  ] as const)(
    "con CERTIFICATE_MAX_BYTES de %i muestra y aplica %s, nunca el tope del contrato",
    async (maxBytes, label, rejects) => {
      const calls = renderScreen(() => null, {}, ADMIN_ME, maxBytes);
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Cargar firma" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(`PKCS#12 (.p12 o .pfx), hasta ${label}.`)).toBeDefined();
      expect(dialog.textContent).not.toMatch(/1024|1 MiB|1 MB/);
      // Un archivo de 100 KiB: la alerta temprana usa el mismo límite que muestra.
      await user.upload(
        dialog.querySelector('input[type="file"]')!,
        new File([new Uint8Array(100 * 1024)], "grande.p12"),
      );
      if (rejects) {
        expect(within(dialog).getByText(`El archivo supera el límite de ${label}.`)).toBeDefined();
      } else {
        expect(within(dialog).getByText("PKCS#12 · 100 KiB")).toBeDefined();
        expect(within(dialog).queryByText(/supera el límite/)).toBeNull();
      }
      expect(calls.some((call) => call.key === "PUT /api/v1/signing-certificate")).toBe(false);
    },
  );

  it("primera carga: envía el archivo en base64, la contraseña exacta y ningún valor esperado", async () => {
    let current: Record<string, unknown> | null = null;
    const calls = renderScreen(() => current, {
      "PUT /api/v1/signing-certificate": () => {
        current = certificate();
        return { status: 200, body: { data: { certificate: current, unchanged: false } } };
      },
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cargar firma" }));
    expect(
      within(screen.getByRole("dialog")).getByText("PKCS#12 (.p12 o .pfx), hasta 64 KiB."),
    ).toBeDefined();
    const { dialog, user } = await fillDialog(" Clave con espacios ");
    await user.click(within(dialog).getByRole("button", { name: "Cargar firma" }));
    expect(
      await screen.findByText("Cargaste la firma de ANA PEREZ, vigente hasta el 12/11/2027."),
    ).toBeDefined();
    expect(calls.find((call) => call.key === "PUT /api/v1/signing-certificate")?.body).toEqual({
      file: Buffer.from([48, 130, 1, 2, 3]).toString("base64"),
      password: " Clave con espacios ",
      expectedCurrentId: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Utilizable")).toBeDefined();
  });

  it("sin archivo elegido pide seleccionarlo y no envía nada", async () => {
    const calls = renderScreen(() => null);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cargar firma" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Contraseña de la firma"), "Clave-Prueba-2026");
    await user.click(within(dialog).getByRole("button", { name: "Cargar firma" }));
    expect(
      await within(dialog).findByText("Selecciona el archivo de la firma electrónica."),
    ).toBeDefined();
    expect(calls.some((call) => call.key === "PUT /api/v1/signing-certificate")).toBe(false);
  });

  it("reemplazo: indica qué firma sustituye y envía su identificador", async () => {
    const calls = renderScreen(() => certificate(), {
      "PUT /api/v1/signing-certificate": () => ({
        status: 200,
        body: {
          data: {
            certificate: certificate({ id: "c2", subject: "CN=LUIS TORRES" }),
            unchanged: false,
          },
        },
      }),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reemplazar firma" }));
    const { dialog, user } = await fillDialog();
    expect(
      within(dialog).getByText("Reemplazará la firma de ANA PEREZ, que vence el 12/11/2027."),
    ).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Reemplazar firma" }));
    expect(await screen.findByText(/Reemplazaste la firma de LUIS TORRES/)).toBeDefined();
    expect(
      (
        calls.find((call) => call.key === "PUT /api/v1/signing-certificate")?.body as {
          expectedCurrentId: string;
        }
      ).expectedCurrentId,
    ).toBe("c1");
  });

  it("recuperación: la misma firma con un cambio confirma que su custodia se restableció", async () => {
    let current = certificate({ state: "KEY_UNAVAILABLE", usable: false });
    renderScreen(() => current, {
      "PUT /api/v1/signing-certificate": () => {
        current = certificate();
        return { status: 200, body: { data: { certificate: current, unchanged: false } } };
      },
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reemplazar firma" }));
    const { dialog, user } = await fillDialog();
    await user.click(within(dialog).getByRole("button", { name: "Reemplazar firma" }));
    expect(
      await screen.findByText(
        "Restableciste la custodia de la firma de ANA PEREZ: ya se puede usar para emitir.",
      ),
    ).toBeDefined();
    expect(await screen.findByText("Utilizable")).toBeDefined();
  });

  it("la misma firma sin cambios lo indica", async () => {
    renderScreen(() => certificate(), {
      "PUT /api/v1/signing-certificate": () => ({
        status: 200,
        body: { data: { certificate: certificate(), unchanged: true } },
      }),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reemplazar firma" }));
    const { dialog, user } = await fillDialog();
    await user.click(within(dialog).getByRole("button", { name: "Reemplazar firma" }));
    expect(await screen.findByText("Esa firma ya era la vigente: no cambió nada.")).toBeDefined();
  });

  it("los errores van a su campo o al cuerpo, sin repetir la contraseña", async () => {
    let response: { status: number; body: unknown } = {
      status: 400,
      body: errorBody(
        "CERTIFICATE_PASSWORD_INVALID",
        "La contraseña no corresponde al archivo de la firma.",
      ),
    };
    renderScreen(() => null, { "PUT /api/v1/signing-certificate": () => response });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cargar firma" }));
    const { dialog, user } = await fillDialog("contraseña-secreta");
    const submit = within(dialog).getByRole("button", { name: "Cargar firma" });
    await user.click(submit);
    const password = within(dialog).getByLabelText("Contraseña de la firma");
    expect(
      await within(dialog).findByText("La contraseña no corresponde al archivo de la firma."),
    ).toBeDefined();
    expect(password.getAttribute("aria-invalid")).toBe("true");

    response = {
      status: 400,
      body: errorBody(
        "CERTIFICATE_UNREADABLE",
        "El archivo no es una firma electrónica válida (PKCS#12).",
      ),
    };
    await user.click(submit);
    expect(
      await within(dialog).findByText("El archivo no es una firma electrónica válida (PKCS#12)."),
    ).toBeDefined();

    response = {
      status: 400,
      body: errorBody(
        "CERTIFICATE_RUC_NOT_FOUND",
        "No encontramos un RUC en este certificado (titular: ANA PEREZ; emisor: AC). El SRI rechaza las firmas cuyo certificado no contiene RUC: pide a tu entidad certificadora un certificado con RUC.",
      ),
    };
    await user.click(submit);
    expect(
      await within(dialog).findByText(
        /No encontramos un RUC en este certificado \(titular: ANA PEREZ/,
      ),
    ).toBeDefined();

    response = { status: 400, body: errorBody("CERTIFICATE_INCOMPATIBLE", INCOMPATIBLE_MESSAGE) };
    await user.click(submit);
    expect(await within(dialog).findByText(INCOMPATIBLE_MESSAGE)).toBeDefined();
    expect(dialog.textContent).not.toContain("contraseña-secreta");
  });

  it("un conflicto ofrece Recargar", async () => {
    let current = certificate();
    renderScreen(() => current, {
      "PUT /api/v1/signing-certificate": () => {
        current = certificate({ id: "c3", subject: "CN=OTRA PERSONA" });
        return {
          status: 409,
          body: errorBody(
            "CERTIFICATE_CHANGED",
            "La firma vigente cambió mientras la reemplazabas. Recarga para ver la firma vigente.",
          ),
        };
      },
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reemplazar firma" }));
    const { dialog, user } = await fillDialog();
    await user.click(within(dialog).getByRole("button", { name: "Reemplazar firma" }));
    expect(await within(dialog).findByText(/cambió mientras la reemplazabas/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Recargar" }));
    expect(
      await within(dialog).findByText(
        "Reemplazará la firma de OTRA PERSONA, que vence el 12/11/2027.",
      ),
    ).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: "Recargar" })).toBeNull();
  });

  it("bloquea el doble envío y borra la contraseña al cerrar", async () => {
    let current: Record<string, unknown> | null = null;
    renderScreen(() => current, {
      "PUT /api/v1/signing-certificate": () => {
        current = certificate();
        return { status: 200, body: { data: { certificate: current, unchanged: false } } };
      },
    });
    const base = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let puts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (init.method === "PUT") {
          puts++;
          await gate;
        }
        return base(input, init);
      }),
    );
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cargar firma" }));
    const { dialog, user } = await fillDialog();
    const submit = within(dialog).getByRole("button", { name: "Cargar firma" });
    await user.click(submit);
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
    await user.click(submit);
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts).toBe(1);
    await user.click(screen.getByRole("button", { name: "Reemplazar firma" }));
    expect(
      (
        within(screen.getByRole("dialog")).getByLabelText(
          "Contraseña de la firma",
        ) as HTMLInputElement
      ).value,
    ).toBe("");
  });
});
