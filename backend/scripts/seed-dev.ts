// Siembra de desarrollo: llena el despliegue local de revisión con datos ficticios para ver cómo se
// muestran las pantallas. No es una herramienta fiscal ni de producción.
//
//   corepack pnpm --filter @facturador/backend seed:dev            # siembra
//   corepack pnpm --filter @facturador/backend seed:dev -- --reset # borra lo sembrado por SQL
//
// Variables (con sus valores por defecto):
//   SEED_ORIGIN               https://emiteya.localhost
//   SEED_CREDENTIALS          ~/.config/emiteya-revision-local/emiteya.env (INITIAL_USER_EMAIL y
//                             INITIAL_USER_PASSWORD; se leen y nunca se imprimen)
//   SEED_POSTGRES_CONTAINER   emiteya-postgres-1
//   SEED_BACKEND_CONTAINER    emiteya-backend-1
//
// Dos fases:
// 1. Por la API del despliegue, como lo haría el administrador: datos de la empresa, establecimientos
//    y puntos, terceros, productos con su inventario, usuarios y borradores de los comprobantes.
// 2. Por SQL, dentro del contenedor de PostgreSQL: comprobantes emitidos de los seis tipos en
//    Pruebas, con sus snapshots tipados con los tipos del dominio, sus tablas auxiliares y claves de
//    acceso válidas. Emitir de verdad exige una firma electrónica y el SRI; aquí se insertan como lo
//    hacen los benchmarks (`scripts/support/q26-volume.ts`), en modo réplica.
//
// Salvaguardas, todas antes de escribir nada:
// - el origen es local (`localhost` o `*.localhost`);
// - el backend tiene `SRI_TRANSMISSION_ENABLED=0`;
// - la empresa está en Pruebas y todavía no tiene datos sembrados;
// - ningún comprobante queda en camino al SRI: los firmados llevan un `sri.transmit` detenido, que el
//   barrido no reactiva, y ninguno queda en `RESERVED`.
// Los comprobantes son inmutables por trigger: `--reset` los borra en modo réplica junto con sus tablas
// auxiliares y sus trabajos. Los maestros creados por la API se quedan; recrear el volumen de la base
// del despliegue deja todo vacío.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CREDIT_NOTE_DECLARATION_STATEMENTS,
  DEBIT_NOTE_DECLARATION_STATEMENTS,
  PURCHASE_SETTLEMENT_CURRENCY,
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PURCHASE_SETTLEMENT_STATEMENTS,
} from "@facturador/contracts";
import { CREDIT_NOTE_CALCULATION_VERSION } from "../src/modules/credit-notes/domain/amounts.ts";
import type { CreditNoteSnapshot } from "../src/modules/credit-notes/domain/snapshot.ts";
import { DEBIT_NOTE_CALCULATION_VERSION } from "../src/modules/debit-notes/domain/amounts.ts";
import type { DebitNoteSnapshot } from "../src/modules/debit-notes/domain/snapshot.ts";
import { invoiceTotals, lineAmounts } from "../src/modules/invoices/domain/amounts.ts";
import type { InvoiceSnapshot } from "../src/modules/invoices/domain/snapshot.ts";
import { PURCHASE_SETTLEMENT_CALCULATION_VERSION } from "../src/modules/purchase-settlements/domain/amounts.ts";
import type { PurchaseSettlementSnapshot } from "../src/modules/purchase-settlements/domain/snapshot.ts";
import type { ShippingGuideSnapshot } from "../src/modules/shipping-guides/domain/snapshot.ts";
import { createAccessKeys } from "../src/modules/sri-engine/infrastructure/access-keys.ts";
import { WITHHOLDING_CALCULATION_VERSION } from "../src/modules/withholding-receipts/domain/amounts.ts";
import type { WithholdingSnapshot } from "../src/modules/withholding-receipts/domain/snapshot.ts";

const ORIGIN = process.env.SEED_ORIGIN ?? "https://emiteya.localhost";
const CREDENTIALS =
  process.env.SEED_CREDENTIALS ?? join(homedir(), ".config/emiteya-revision-local/emiteya.env");
const POSTGRES = process.env.SEED_POSTGRES_CONTAINER ?? "emiteya-postgres-1";
const BACKEND = process.env.SEED_BACKEND_CONTAINER ?? "emiteya-backend-1";
/** Prefijo de todo lo que siembra la fase SQL: `--reset` borra exactamente eso. */
const PREFIX = "dev-";

const log = (message: string) => console.log(`· ${message}`);
const fail = (message: string): never => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

// ─── Datos deterministas ────────────────────────────────────────────────────────────────────────

/** Generador pseudoaleatorio con semilla: la misma siembra cada vez. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}
const rand = prng(20261015);

/** Cédula ecuatoriana con su dígito verificador (módulo 10). */
function cedula(n: number): string {
  const province = String(1 + (n % 24)).padStart(2, "0");
  const body = `${province}${n % 6}${String(100000 + ((n * 7919) % 900000)).padStart(6, "0")}`;
  const sum = [...body].reduce((acc, digit, index) => {
    let value = Number(digit) * (index % 2 === 0 ? 2 : 1);
    if (value > 9) value -= 9;
    return acc + value;
  }, 0);
  return body + String((10 - (sum % 10)) % 10);
}

/** RUC de sociedad privada (tercer dígito 9) con su dígito verificador (módulo 11), sin repetir. */
const usedRucs = new Set<string>();
function rucSociety(n: number): string {
  const weights = [4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (let shift = 0; shift < 500; shift += 1) {
    const province = String(1 + ((n + shift) % 24)).padStart(2, "0");
    const body = `${province}9${String(100000 + (((n + shift) * 104729) % 900000)).padStart(6, "0")}`;
    const sum = [...body].reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0);
    const check = 11 - (sum % 11);
    const ruc = `${body}${check === 11 ? 0 : check}001`;
    if (check === 10 || usedRucs.has(ruc)) continue;
    usedRucs.add(ruc);
    return ruc;
  }
  return fail("no se pudo generar un RUC de sociedad");
}

const COMPANIES = [
  "EL PERNO CIA. LTDA.",
  "COMERCIAL ANDINA S.A.",
  "DISTRIBUIDORA DEL PACÍFICO S.A.",
  "IMPORTADORA QUITO CIA. LTDA.",
  "CONSTRUCTORA VALLE ALTO S.A.",
  "SERVICIOS TÉCNICOS DEL SUR CIA. LTDA.",
  "AGROINDUSTRIAS EL ORO S.A.",
  "TRANSPORTES RÁPIDOS DEL ECUADOR S.A.",
  "MATERIALES AMAZONAS CIA. LTDA.",
  "INMOBILIARIA LOS CHILLOS S.A.",
  "HOTELERA MITAD DEL MUNDO S.A.",
  "METALMECÁNICA CUENCA CIA. LTDA.",
  "LOGÍSTICA COSTA AZUL S.A.",
  "PANIFICADORA LA PRADERA CIA. LTDA.",
  "TECNOLOGÍA ANDINA TECAN S.A.",
  "ACABADOS Y PISOS DEL NORTE S.A.",
  "CERÁMICAS CHIMBORAZO CIA. LTDA.",
  "ELECTRO HOGAR LATACUNGA S.A.",
  "MADERAS DEL ORIENTE CIA. LTDA.",
  "PINTURAS PICHINCHA S.A.",
];
const FIRST = [
  "María",
  "José",
  "Luis",
  "Ana",
  "Carlos",
  "Gabriela",
  "Diego",
  "Paola",
  "Andrés",
  "Verónica",
  "Fernando",
  "Daniela",
  "Jorge",
  "Lucía",
  "Santiago",
  "Carolina",
  "Pablo",
  "Mónica",
];
const LAST = [
  "Paredes",
  "Morales",
  "Andrade",
  "Cevallos",
  "Guerrero",
  "Salazar",
  "Vásquez",
  "Mora",
  "Zambrano",
  "Chávez",
  "Ortiz",
  "Benítez",
  "Castillo",
  "Espinoza",
  "Herrera",
  "Jaramillo",
];
const STREETS = [
  "Av. Amazonas",
  "Av. 10 de Agosto",
  "Av. de los Shyris",
  "Av. 9 de Octubre",
  "Calle Sucre",
  "Av. Remigio Crespo",
  "Av. Juan Tanca Marengo",
  "Calle Bolívar",
  "Av. Eloy Alfaro",
];
const CITIES = ["Quito", "Guayaquil", "Cuenca", "Ambato", "Manta", "Loja", "Ibarra", "Machala"];

const PRODUCTS: readonly Readonly<{
  code: string;
  name: string;
  kind: "GOOD" | "SERVICE";
  price: string;
  iva: string;
}>[] = [
  { code: "CEM-50", name: "Cemento Holcim tipo GU 50 kg", kind: "GOOD", price: "8.75", iva: "4" },
  {
    code: "VAR-12",
    name: "Varilla corrugada 12 mm x 12 m",
    kind: "GOOD",
    price: "11.40",
    iva: "4",
  },
  { code: "VAR-10", name: "Varilla corrugada 10 mm x 12 m", kind: "GOOD", price: "8.10", iva: "4" },
  {
    code: "PIN-LTX-G",
    name: "Pintura látex blanco hueso galón",
    kind: "GOOD",
    price: "18.90",
    iva: "4",
  },
  {
    code: "PIN-ESM-G",
    name: "Esmalte sintético negro galón",
    kind: "GOOD",
    price: "22.50",
    iva: "4",
  },
  {
    code: "PVC-12",
    name: "Tubo PVC presión 1/2 pulgada x 6 m",
    kind: "GOOD",
    price: "6.35",
    iva: "4",
  },
  {
    code: "PVC-34",
    name: "Tubo PVC presión 3/4 pulgada x 6 m",
    kind: "GOOD",
    price: "8.95",
    iva: "4",
  },
  {
    code: "CAB-12",
    name: "Cable eléctrico THHN 12 AWG rollo 100 m",
    kind: "GOOD",
    price: "64.00",
    iva: "4",
  },
  { code: "BLQ-15", name: "Bloque de hormigón 15 cm", kind: "GOOD", price: "0.48", iva: "4" },
  { code: "ARE-M3", name: "Arena fina por metro cúbico", kind: "GOOD", price: "18.00", iva: "0" },
  {
    code: "PIE-M3",
    name: "Ripio triturado por metro cúbico",
    kind: "GOOD",
    price: "21.00",
    iva: "0",
  },
  {
    code: "TEJ-ZN",
    name: "Plancha de zinc ondulada 3.66 m",
    kind: "GOOD",
    price: "13.80",
    iva: "4",
  },
  { code: "CLV-2", name: "Clavos de 2 pulgadas caja 1 kg", kind: "GOOD", price: "2.40", iva: "4" },
  {
    code: "TOR-14",
    name: "Tornillo autorroscante 1/4 caja 100",
    kind: "GOOD",
    price: "4.60",
    iva: "4",
  },
  { code: "MAR-16", name: "Martillo de uña 16 onzas", kind: "GOOD", price: "9.90", iva: "4" },
  {
    code: "TAL-18V",
    name: "Taladro percutor inalámbrico 18 V",
    kind: "GOOD",
    price: "119.00",
    iva: "4",
  },
  {
    code: "CER-60",
    name: "Cerámica de piso 60 x 60 cm caja",
    kind: "GOOD",
    price: "26.40",
    iva: "4",
  },
  { code: "PEG-25", name: "Pegante cerámico 25 kg", kind: "GOOD", price: "7.80", iva: "4" },
  { code: "LLV-PAS", name: "Llave de paso 1/2 pulgada", kind: "GOOD", price: "5.25", iva: "4" },
  { code: "INO-ECO", name: "Inodoro ecológico blanco", kind: "GOOD", price: "89.00", iva: "4" },
  { code: "FOC-LED", name: "Foco LED 12 W luz blanca", kind: "GOOD", price: "1.95", iva: "4" },
  {
    code: "SEMI-MZ",
    name: "Semilla de maíz certificada 25 kg",
    kind: "GOOD",
    price: "45.00",
    iva: "0",
  },
  { code: "FER-UR", name: "Fertilizante urea 50 kg", kind: "GOOD", price: "38.50", iva: "0" },
  { code: "MAL-SOM", name: "Malla sombra 80 % rollo 50 m", kind: "GOOD", price: "72.00", iva: "5" },
  { code: "GUA-NIT", name: "Guantes de nitrilo caja 100", kind: "GOOD", price: "9.40", iva: "4" },
  { code: "CAS-SEG", name: "Casco de seguridad industrial", kind: "GOOD", price: "7.20", iva: "4" },
  {
    code: "SRV-TRN",
    name: "Transporte de materiales dentro de Quito",
    kind: "SERVICE",
    price: "25.00",
    iva: "4",
  },
  {
    code: "SRV-INS",
    name: "Instalación eléctrica por punto",
    kind: "SERVICE",
    price: "18.00",
    iva: "4",
  },
  {
    code: "SRV-PLO",
    name: "Servicio de plomería por hora",
    kind: "SERVICE",
    price: "15.00",
    iva: "4",
  },
  { code: "SRV-ASE", name: "Asesoría técnica en obra", kind: "SERVICE", price: "40.00", iva: "4" },
  {
    code: "SRV-ALQ",
    name: "Alquiler de andamio por semana",
    kind: "SERVICE",
    price: "35.00",
    iva: "4",
  },
  {
    code: "SRV-CAP",
    name: "Capacitación en seguridad industrial",
    kind: "SERVICE",
    price: "120.00",
    iva: "7",
  },
  {
    code: "SRV-DIS",
    name: "Diseño de planos arquitectónicos",
    kind: "SERVICE",
    price: "450.00",
    iva: "4",
  },
  {
    code: "SRV-MNT",
    name: "Mantenimiento preventivo de bomba",
    kind: "SERVICE",
    price: "65.00",
    iva: "4",
  },
];

// ─── Infraestructura ────────────────────────────────────────────────────────────────────────────

function readCredentials(): { email: string; password: string } {
  const env = readFileSync(CREDENTIALS, "utf8");
  const pick = (key: string) => {
    const line = env.split("\n").find((entry) => entry.startsWith(`${key}=`));
    if (!line) return fail(`falta ${key} en el archivo de credenciales`);
    return line.slice(key.length + 1).replace(/^["']|["']$/g, "");
  };
  return { email: pick("INITIAL_USER_EMAIL"), password: pick("INITIAL_USER_PASSWORD") };
}

/** SQL dentro del contenedor de PostgreSQL; devuelve la salida sin alinear. */
function psql(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      POSTGRES,
      "sh",
      "-c",
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -At',
    ],
    { input: sql, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  ).trim();
}
const json = <T>(sql: string): T => JSON.parse(psql(sql) || "null") as T;
const quote = (value: string | null | undefined) =>
  value === null || value === undefined ? "NULL" : `'${value.replaceAll("'", "''")}'`;

let cookie = "";
async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ORIGIN}/api/v1${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie,
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    let reason = text.slice(0, 300);
    try {
      const error = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error;
      reason = `${error?.code ?? "?"}: ${error?.message ?? ""}`;
    } catch {
      // cuerpo no JSON: se muestra recortado
    }
    throw new Error(`${method} ${path} → ${response.status} ${reason}`);
  }
  return (text ? (JSON.parse(text) as { data: T }).data : undefined) as T;
}

async function signIn() {
  const { email, password } = readCredentials();
  const response = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) fail(`no se pudo iniciar sesión (${response.status})`);
  cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}

// ─── Salvaguardas ───────────────────────────────────────────────────────────────────────────────

function guards() {
  const host = new URL(ORIGIN).hostname;
  if (host !== "localhost" && !host.endsWith(".localhost")) {
    fail(`el origen ${ORIGIN} no es local: la siembra solo es para el despliegue de revisión`);
  }
  const flag = execFileSync("docker", ["exec", BACKEND, "printenv", "SRI_TRANSMISSION_ENABLED"], {
    encoding: "utf8",
  }).trim();
  if (flag !== "0") fail("el backend no tiene SRI_TRANSMISSION_ENABLED=0; no se siembra nada");
  log("SRI_TRANSMISSION_ENABLED=0 en el backend");
  // Los certificados con TLS propio de `*.localhost` no los firma una autoridad conocida.
  if (new URL(ORIGIN).protocol === "https:") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// ─── Reset ──────────────────────────────────────────────────────────────────────────────────────

function reset() {
  const like = `'${PREFIX}%'`;
  psql(`BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM job WHERE document_id LIKE ${like};
DELETE FROM electronic_document_recipient WHERE document_id LIKE ${like};
DELETE FROM shipping_guide_recipient WHERE document_id LIKE ${like};
DELETE FROM shipping_guide WHERE document_id LIKE ${like};
DELETE FROM withholding_receipt_line WHERE document_id LIKE ${like};
DELETE FROM withholding_receipt WHERE document_id LIKE ${like};
DELETE FROM purchase_settlement_declaration WHERE document_id LIKE ${like};
DELETE FROM purchase_settlement WHERE document_id LIKE ${like};
DELETE FROM debit_note_support WHERE debit_note_id LIKE ${like};
DELETE FROM credit_reservation WHERE id LIKE ${like};
DELETE FROM electronic_document WHERE id LIKE ${like};
DELETE FROM fiscal_sequence_reservation WHERE id LIKE ${like};
COMMIT;`);
  log("borrados los comprobantes sembrados, sus tablas auxiliares y sus trabajos");
}

// ─── Fase 1: la API ─────────────────────────────────────────────────────────────────────────────

type Point = {
  establishmentId: string;
  establishmentCode: string;
  address: string;
  id: string;
  code: string;
};
type Party = {
  id: string;
  identificationType: string;
  identification: string;
  legalName: string;
  address: string | null;
  roles: string[];
};
type Product = {
  id: string;
  mainCode: string;
  name: string;
  unitPrice: string;
  iva: string;
  kind: string;
};

async function seedThroughApi() {
  const status = await api<{ environment?: string; displayName?: string | null }>(
    "GET",
    "/company/status",
  );
  if (status.environment === "PRODUCTION")
    fail("la empresa está en Producción; no se siembra nada");
  const seeded = Number(
    psql(`SELECT count(*) FROM electronic_document WHERE id LIKE '${PREFIX}%'`),
  );
  if (seeded > 0) fail("ya hay comprobantes sembrados: usa --reset antes de volver a sembrar");

  // Reanudable: cada paso reutiliza lo que ya existe y crea solo lo que falta.
  const current = await api<{ version?: number } | null>("GET", "/taxpayer").catch(() => null);
  if (!current?.version)
    await api("PUT", "/taxpayer", {
      ruc: "1792345678001",
      legalName: "FERRETERÍA ANDINA CÍA. LTDA.",
      tradeName: "Ferretería Andina",
      headOfficeAddress: "Av. Amazonas N24-03 y Colón, Quito",
      phone: "022345678",
      email: "facturacion@ferreteria-andina.ec",
      accountingRequired: true,
      specialTaxpayerNumber: null,
      withholdingAgentResolution: null,
      largeTaxpayer: false,
      rimpeCategory: null,
      providerRuc: null,
      expectedVersion: null,
    });
  log("datos de la empresa: Ferretería Andina (RUC ficticio)");

  const establishments = [
    { code: "001", address: "Av. Amazonas N24-03 y Colón, Quito", points: ["001", "002"] },
    { code: "002", address: "Av. 9 de Octubre 1215, Guayaquil", points: ["001"] },
  ];
  type Listed = {
    id: string;
    code: string;
    address: string;
    emissionPoints: { id: string; code: string }[];
  }[];
  const before = await api<Listed>("GET", "/establishments");
  for (const establishment of establishments) {
    const found = before.find((item) => item.code === establishment.code);
    const id =
      found?.id ??
      (
        await api<{ id: string }>("POST", "/establishments", {
          code: establishment.code,
          address: establishment.address,
        })
      ).id;
    for (const code of establishment.points) {
      if (found?.emissionPoints.some((point) => point.code === code)) continue;
      await api("POST", `/establishments/${id}/emission-points`, { code });
    }
  }
  const listed = await api<
    { id: string; code: string; address: string; emissionPoints: { id: string; code: string }[] }[]
  >("GET", "/establishments");
  const points: Point[] = listed.flatMap((establishment) =>
    establishment.emissionPoints.map((point) => ({
      establishmentId: establishment.id,
      establishmentCode: establishment.code,
      address: establishment.address,
      id: point.id,
      code: point.code,
    })),
  );
  await api("PUT", "/me/default-emission-point", { emissionPointId: points[0]!.id });
  log(`${listed.length} establecimientos y ${points.length} puntos de emisión`);

  const parties: Party[] = [];
  const addParty = async (input: Omit<Party, "id">) => {
    const existingId = psql(
      `SELECT id FROM party WHERE identification = ${quote(input.identification)}`,
    );
    if (existingId) {
      parties.push({ ...input, id: existingId });
      return;
    }
    const created = await api<{ id: string }>("POST", "/parties", {
      identificationType: input.identificationType,
      identification: input.identification,
      legalName: input.legalName,
      address: input.address,
      email: `contacto${parties.length + 1}@ejemplo.ec`,
      phone: `09${String(80000000 + parties.length * 1379).slice(0, 8)}`,
      roles: input.roles,
    });
    parties.push({ ...input, id: created.id });
  };
  for (const [index, name] of COMPANIES.entries()) {
    await addParty({
      identificationType: "04",
      identification: rucSociety(index + 11),
      legalName: name,
      address: `${rand.pick(STREETS)} ${rand.int(100, 2999)}, ${rand.pick(CITIES)}`,
      roles:
        index % 5 === 0 ? ["SUPPLIER"] : index % 7 === 0 ? ["CUSTOMER", "CARRIER"] : ["CUSTOMER"],
    });
  }
  for (let index = 0; index < 40; index += 1) {
    const person = `${FIRST[index % FIRST.length]} ${LAST[(index * 5) % LAST.length]} ${LAST[(index * 3 + 1) % LAST.length]}`;
    const id = cedula(index + 101);
    await addParty({
      identificationType: index % 4 === 0 ? "04" : "05",
      identification: index % 4 === 0 ? `${id}001` : id,
      legalName: person.toUpperCase(),
      address: `${rand.pick(STREETS)} ${rand.int(100, 2999)}, ${rand.pick(CITIES)}`,
      roles: index % 6 === 0 ? ["SUPPLIER"] : index % 9 === 0 ? ["CARRIER"] : ["CUSTOMER"],
    });
  }
  log(`${parties.length} terceros`);

  const products: Product[] = [];
  for (const product of PRODUCTS) {
    const existingId = psql(`SELECT id FROM product WHERE main_code = ${quote(product.code)}`);
    if (existingId) {
      products.push({
        id: existingId,
        mainCode: product.code,
        name: product.name,
        unitPrice: product.price,
        iva: product.iva,
        kind: product.kind,
      });
      continue;
    }
    const created = await api<{ id: string }>("POST", "/products", {
      kind: product.kind,
      mainCode: product.code,
      name: product.name,
      unitPrice: product.price,
      stockTracked: product.kind === "GOOD",
      taxes: { iva: product.iva },
    });
    products.push({
      id: created.id,
      mainCode: product.code,
      name: product.name,
      unitPrice: product.price,
      iva: product.iva,
      kind: product.kind,
    });
  }
  log(`${products.length} productos`);

  let movements = 0;
  for (const [index, product] of products.filter((item) => item.kind === "GOOD").entries()) {
    // Reanudable: solo los productos que todavía no tienen movimientos.
    if (
      Number(psql(`SELECT count(*) FROM stock_movement WHERE product_id = ${quote(product.id)}`)) >
      0
    )
      continue;
    if (index % 9 === 8) continue; // algunos quedan sin inicializar
    await api("POST", `/inventory/items/${product.id}/initialization`, {
      quantity: String(rand.int(20, 400)),
      note: "Conteo inicial",
    });
    movements += 1;
    for (let entry = 0; entry < rand.int(1, 4); entry += 1) {
      await api("POST", `/inventory/items/${product.id}/entries`, {
        quantity: String(rand.int(10, 120)),
        note: rand.pick(["Compra a proveedor", "Reposición de bodega", "Devolución de obra"]),
      });
      movements += 1;
    }
    if (index % 3 === 0) {
      await api("POST", `/inventory/items/${product.id}/adjustments`, {
        delta: `-${rand.int(1, 8)}`,
        reason: rand.pick(["Conteo físico", "Producto dañado", "Merma"]),
      });
      movements += 1;
    }
  }
  log(`${movements} movimientos de inventario`);

  const people = [
    "Carolina Benítez",
    "Jorge Salazar",
    "Lucía Herrera",
    "Pablo Ortiz",
    "Mónica Castillo",
  ];
  for (const [index, name] of people.entries()) {
    const email = `${name
      .toLowerCase()
      .replace(" ", ".")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")}@ferreteria-andina.ec`;
    if (psql(`SELECT id FROM "user" WHERE email = ${quote(email)}`)) continue;
    await api("POST", "/users", {
      name,
      email,
      password: `${randomUUID()}-Aa1`,
      role: index === 0 ? "ADMIN" : "OPERATOR",
    });
  }
  log(`${people.length} usuarios (contraseñas aleatorias, no se muestran)`);

  return { points, parties, products };
}

async function seedDrafts(points: Point[], parties: Party[], products: Product[]) {
  if (Number(psql("SELECT count(*) FROM invoice_draft")) > 0) {
    log("ya hay borradores: se omiten");
    return;
  }
  const customers = parties.filter((party) => party.roles.includes("CUSTOMER"));
  const suppliers = parties.filter((party) => party.roles.includes("SUPPLIER"));
  let created = 0;
  const attempt = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      created += 1;
    } catch (error) {
      log(`borrador omitido (${label}): ${(error as Error).message}`);
    }
  };
  for (let index = 0; index < 14; index += 1) {
    const lines = Array.from({ length: rand.int(1, 4) }, () => ({
      productId: rand.pick(products).id,
      quantity: String(rand.int(1, 12)),
      discount: rand.next() < 0.3 ? "1.00" : "0",
    }));
    await attempt("factura", () =>
      api("POST", "/invoices/drafts", {
        emissionPointId: rand.pick(points).id,
        buyerPartyId: index % 5 === 4 ? null : rand.pick(customers).id,
        lines: index % 7 === 6 ? [] : lines,
        payments: [{ paymentMethod: rand.pick(["01", "19", "20"]) }],
      }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    const supplier = rand.pick(suppliers);
    await attempt("liquidación", () =>
      api("POST", "/purchase-settlements/drafts", {
        emissionPointId: points[0]!.id,
        supplierPartyId: supplier.id,
        supplierAddress: supplier.address,
        lines: [
          {
            description: rand.pick([
              "Compra de maíz en grano",
              "Leña para horno",
              "Servicio de jornal agrícola",
            ]),
            unit: "unidad",
            quantity: String(rand.int(5, 60)),
            unitPrice: `${rand.int(1, 20)}.50`,
            ivaRate: "0",
          },
        ],
        payments: [{ paymentMethod: "01" }],
      }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    await attempt("retención", () =>
      api("POST", "/withholding-receipts/drafts", {
        partyId: rand.pick(suppliers).id,
        relatedParty: "NO",
        fiscalPeriod: "10/2026",
        emissionPointId: points[0]!.id,
      }),
    );
  }
  for (let index = 0; index < 3; index += 1) {
    await attempt("guía", () =>
      api("POST", "/shipping-guides/drafts", {
        emissionPointId: points[0]!.id,
        originEstablishmentId: points[0]!.establishmentId,
        transporter: { source: "SELF" },
        plate: `PBA-${rand.int(1000, 9999)}`,
        transportStart: "2026-10-20",
        transportEnd: "2026-10-21",
      }),
    );
  }
  log(`${created} borradores (facturas, liquidaciones, retenciones y guías)`);
}

// ─── Fase 2: comprobantes emitidos por SQL ──────────────────────────────────────────────────────

type Issuer = InvoiceSnapshot["issuer"];
type Key = InvoiceSnapshot["key"];
type Row = {
  id: string;
  type: "01" | "03" | "04" | "05" | "06" | "07";
  point: Point;
  sequential: number;
  issueDate: string;
  state: string;
  snapshot: object;
  buyerIdentification: string | null;
  buyerName: string | null;
  total: string | null;
  accessKey: string;
  numericCode: string;
  documentNumber: string;
};

const cents = (value: string) => Math.round(Number(value) * 100);
const money = (value: number) => (value / 100).toFixed(2);
const today = new Date("2026-10-15T12:00:00-05:00");
const isoDate = (daysAgo: number) =>
  new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

function seedDocumentsSql(context: {
  company: string;
  user: string;
  userName: string;
  configVersion: { id: string; version: number };
  issuer: Omit<Issuer, "establishment" | "emissionPoint">;
  points: Point[];
  parties: Party[];
  products: Product[];
  labels: Record<string, Record<string, string>>;
}) {
  const { company, user, points, parties, products, labels } = context;
  const keys = createAccessKeys();
  const sequences = new Map<string, number>();
  const rows: Row[] = [];
  const customers = parties.filter((party) => party.roles.includes("CUSTOMER"));
  const suppliers = parties.filter((party) => party.roles.includes("SUPPLIER"));
  const ivaLabel = (key: string) => labels["iva-rate"]?.[key] ?? key;
  const payLabel = (key: string) => labels["payment-method"]?.[key] ?? key;
  const percentage = (key: string) => ({ "4": "15", "5": "5", "0": "0", "7": "0" })[key] ?? "15";
  const issuerAt = (point: Point): Issuer => ({
    ...context.issuer,
    establishment: {
      id: point.establishmentId,
      code: point.establishmentCode,
      address: point.address,
    },
    emissionPoint: { id: point.id, code: point.code },
  });
  const common = (issueDate: string) => ({
    builderVersion: "1",
    catalogDatasets: {},
    taxpayerConfig: { versionId: context.configVersion.id, version: context.configVersion.version },
    issueDate,
    environment: "TEST" as const,
    environmentCode: "1" as const,
  });
  const schema = <T extends string>(documentType: T, file: string) => ({
    documentType,
    version: "1.1.0",
    path: `sri-xsd/${file}`,
    sha256: "0".repeat(64),
    imports: [],
  });
  const keyFor = (
    type: Row["type"],
    point: Point,
    issueDate: string,
  ): Key & { sequentialNumber: number } => {
    const series = `${type}:${point.id}`;
    const sequential = (sequences.get(series) ?? 0) + 1;
    sequences.set(series, sequential);
    const numericCode = keys.numericCode();
    const sequentialText = String(sequential).padStart(9, "0");
    const accessKey = keys.compose({
      issueDate,
      documentType: type,
      ruc: context.issuer.ruc,
      environment: "1",
      establishment: point.establishmentCode,
      emissionPoint: point.code,
      sequential: sequentialText,
      numericCode,
    });
    return {
      documentNumber: `${point.establishmentCode}-${point.code}-${sequentialText}`,
      sequential: sequentialText,
      numericCode,
      emissionType: "1",
      accessKey,
      sequentialNumber: sequential,
    };
  };
  const push = (
    row: Omit<Row, "accessKey" | "numericCode" | "documentNumber" | "sequential"> & {
      key: ReturnType<typeof keyFor>;
    },
  ) => {
    rows.push({
      ...row,
      sequential: row.key.sequentialNumber,
      accessKey: row.key.accessKey,
      numericCode: row.key.numericCode,
      documentNumber: row.key.documentNumber,
    });
  };
  const authorizedAt = (issueDate: string) => `${issueDate}T15:${String(rand.int(10, 59))}:00.000Z`;

  // Facturas: la mayoría autorizadas y algunas en cada estado intermedio o final.
  const invoiceStates = [
    ...Array(30).fill("AUTHORIZED"),
    "RETURNED",
    "NOT_AUTHORIZED",
    "SIGNED",
    "RECEIVED",
    "SEND_UNKNOWN",
    "MANUAL_REVIEW",
  ];
  const invoices: { row: Row; snapshot: InvoiceSnapshot }[] = [];
  for (let index = 0; index < 180; index += 1) {
    const point =
      index % 6 === 5
        ? (points[2] ?? points[0]!)
        : index % 4 === 3
          ? (points[1] ?? points[0]!)
          : points[0]!;
    const issueDate = isoDate(Math.floor((180 - index) * 0.8));
    const consumerFinal = index % 11 === 0;
    const buyer = rand.pick(customers);
    // La última factura lleva muchas líneas, para ver la búsqueda y las páginas de su detalle.
    const lineCount = index === 179 ? 36 : rand.int(1, 5);
    const chosen = Array.from({ length: lineCount }, () => rand.pick(products));
    const computed = chosen.map((product) => {
      const rate = { taxCode: "2", rateCode: product.iva, percentage: percentage(product.iva) };
      const quantity = String(product.kind === "SERVICE" ? rand.int(1, 3) : rand.int(1, 40));
      const discount =
        rand.next() < 0.2 && Number(product.unitPrice) * Number(quantity) > 10 ? "1.00" : "0";
      return {
        product,
        rate,
        quantity,
        amounts: lineAmounts({ quantity, unitPrice: product.unitPrice, discount, taxes: [rate] }),
      };
    });
    const totals = invoiceTotals(computed.map((entry) => entry.amounts));
    const key = keyFor("01", point, issueDate);
    const payment = consumerFinal ? "01" : rand.pick(["01", "19", "20", "16"]);
    const snapshot: InvoiceSnapshot = {
      snapshotVersion: 2,
      schema: schema("01", "factura_V1.1.0.xsd"),
      ...common(issueDate),
      issuer: issuerAt(point),
      buyer: consumerFinal
        ? {
            partyId: "consumidor-final",
            identificationType: "07",
            identification: "9999999999999",
            legalName: "CONSUMIDOR FINAL",
            address: null,
            consumerFinal: true,
            consumerFinalPolicy: { versionId: "politica", maxAmount: "50.00", allowed: true },
          }
        : {
            partyId: buyer.id,
            identificationType: buyer.identificationType,
            identification: buyer.identification,
            legalName: buyer.legalName,
            address: buyer.address,
            consumerFinal: false,
            consumerFinalPolicy: null,
          },
      lines: computed.map(({ product, rate, quantity, amounts }, position) => ({
        position: position + 1,
        productId: product.id,
        mainCode: product.mainCode,
        auxiliaryCode: null,
        description: product.name,
        quantity,
        unitPrice: product.unitPrice,
        discount: amounts.discount,
        subtotal: amounts.subtotal,
        taxableBase: amounts.taxableBase,
        taxes: amounts.taxes.map((tax) => ({
          taxCode: tax.taxCode,
          rateCode: tax.rateCode,
          catalogType: "iva-rate",
          entryKey: rate.rateCode,
          versionId: `${rate.rateCode}@1`,
          officialLabel: ivaLabel(rate.rateCode),
          percentage: tax.percentage,
          base: tax.base,
          amount: tax.amount,
        })),
        inventoryAffectsStock: false,
      })),
      totals: {
        withoutTaxes: totals.withoutTaxes,
        discount: totals.discount,
        taxes: totals.taxes.map(({ taxCode, rateCode, percentage: rate, base, amount }) => ({
          taxCode,
          rateCode,
          percentage: rate,
          base,
          amount,
        })),
        total: totals.total,
      },
      payments: [
        {
          position: 1,
          entryKey: payment,
          code: payment,
          versionId: `${payment}@1`,
          officialLabel: payLabel(payment),
          amount: totals.total,
        },
      ],
      specialCases: { operation: [], issuerRules: [] },
      key: {
        documentNumber: key.documentNumber,
        sequential: key.sequential,
        numericCode: key.numericCode,
        emissionType: "1",
        accessKey: key.accessKey,
      },
    };
    const state = index === 179 ? "AUTHORIZED" : rand.pick(invoiceStates);
    push({
      id: `${PREFIX}inv-${index + 1}`,
      type: "01",
      point,
      issueDate,
      state,
      snapshot,
      buyerIdentification: snapshot.buyer.identification,
      buyerName: snapshot.buyer.legalName,
      total: totals.total,
      key,
    });
    invoices.push({ row: rows.at(-1)!, snapshot });
  }
  const authorizedInvoices = invoices.filter(
    (entry) => entry.row.state === "AUTHORIZED" && !entry.snapshot.buyer.consumerFinal,
  );
  const invoiceRef = (entry: (typeof invoices)[number]) => ({
    id: entry.row.id,
    documentType: "01" as const,
    documentNumber: entry.row.documentNumber,
    issueDate: entry.row.issueDate,
    accessKey: entry.row.accessKey,
    authorizationNumber: entry.row.accessKey,
    authorizationDate: authorizedAt(entry.row.issueDate),
    environment: "TEST" as const,
    snapshotVersion: 2,
  });
  const laterState = () =>
    rand.pick([...Array(12).fill("AUTHORIZED"), "RETURNED", "NOT_AUTHORIZED", "SIGNED"]);
  const reservations: string[] = [];
  const supports: string[] = [];

  // Notas de crédito: anulaciones totales y devoluciones de una línea.
  for (let index = 0; index < 24; index += 1) {
    const invoice = authorizedInvoices[(index * 5) % authorizedInvoices.length]!;
    const cause = index % 3 === 0 ? "TOTAL_ANNULMENT" : "RETURN";
    const point = invoice.row.point;
    const issueDate = isoDate(Math.max(0, Math.floor(rand.int(0, 40))));
    const sourceLines =
      cause === "TOTAL_ANNULMENT" ? invoice.snapshot.lines : invoice.snapshot.lines.slice(0, 1);
    const lines = sourceLines.map((line, position) => ({
      position: position + 1,
      invoicePosition: line.position,
      productId: line.productId,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes,
      physicalReturn: cause === "RETURN" ? line.quantity : "0",
      inventoryAffectsStock: false,
    }));
    const base = lines.reduce((sum, line) => sum + cents(line.taxableBase), 0);
    const taxes = lines.flatMap((line) => line.taxes);
    const tax = taxes.reduce((sum, item) => sum + cents(item.amount), 0);
    const byRate = new Map<string, { base: number; amount: number; percentage: string }>();
    for (const item of taxes) {
      const current = byRate.get(item.rateCode) ?? {
        base: 0,
        amount: 0,
        percentage: item.percentage,
      };
      current.base += cents(item.base);
      current.amount += cents(item.amount);
      byRate.set(item.rateCode, current);
    }
    const key = keyFor("04", point, issueDate);
    const snapshot: CreditNoteSnapshot = {
      snapshotVersion: 1,
      schema: schema("04", "notaCredito_V1.1.0.xsd"),
      ...common(issueDate),
      calculationVersion: CREDIT_NOTE_CALCULATION_VERSION,
      issuer: issuerAt(point),
      buyer: {
        identificationType: invoice.snapshot.buyer.identificationType,
        identification: invoice.snapshot.buyer.identification,
        legalName: invoice.snapshot.buyer.legalName,
        address: invoice.snapshot.buyer.address,
      },
      cause,
      reason:
        cause === "RETURN"
          ? "Devolución de mercadería en mal estado"
          : "Anulación de la factura por error en el pedido",
      invoice: invoiceRef(invoice),
      lines,
      totals: {
        withoutTaxes: money(base),
        discount: "0.00",
        taxes: [...byRate.entries()].map(([rateCode, value]) => ({
          taxCode: "2",
          rateCode,
          percentage: value.percentage,
          base: money(value.base),
          amount: money(value.amount),
        })),
        total: money(base + tax),
      },
      declarations: {
        version: 1,
        statements: [...CREDIT_NOTE_DECLARATION_STATEMENTS],
        declaredBy: user,
        declaredAt: `${issueDate}T14:00:00.000Z`,
        basis: "USER_DECLARED",
      },
      key: {
        documentNumber: key.documentNumber,
        sequential: key.sequential,
        numericCode: key.numericCode,
        emissionType: "1",
        accessKey: key.accessKey,
      },
    };
    const id = `${PREFIX}cn-${index + 1}`;
    const state = laterState();
    push({
      id,
      type: "04",
      point,
      issueDate,
      state,
      snapshot,
      buyerIdentification: snapshot.buyer.identification,
      buyerName: snapshot.buyer.legalName,
      total: snapshot.totals.total,
      key,
    });
    const reservationStatus =
      state === "AUTHORIZED" ? "APPLIED" : state === "SIGNED" ? "RESERVED" : "RELEASED";
    reservations.push(
      `(${quote(`${PREFIX}crres-${index + 1}`)}, ${quote(company)}, ${quote(invoice.row.id)}, ${quote(id)}, ${quote(cause)}, ${snapshot.totals.total}, ${quote(reservationStatus)}, now(), ${reservationStatus === "RESERVED" ? "NULL" : "now()"})`,
    );
  }

  // Notas de débito: intereses por mora y costos posteriores.
  for (let index = 0; index < 14; index += 1) {
    const invoice = authorizedInvoices[(index * 7 + 3) % authorizedInvoices.length]!;
    const point = invoice.row.point;
    const issueDate = isoDate(rand.int(0, 35));
    const amount = rand.int(500, 9000);
    const vat = Math.round(amount * 0.15);
    const cause = index % 2 === 0 ? "LATE_PAYMENT_INTEREST" : "POST_INVOICE_COST_EXPENSE";
    const key = keyFor("05", point, issueDate);
    const snapshot: DebitNoteSnapshot = {
      snapshotVersion: 1,
      schema: schema("05", "notaDebito_V1.0.0.xsd"),
      ...common(issueDate),
      calculationVersion: DEBIT_NOTE_CALCULATION_VERSION,
      issuer: issuerAt(point),
      buyer: {
        identificationType: invoice.snapshot.buyer.identificationType,
        identification: invoice.snapshot.buyer.identification,
        legalName: invoice.snapshot.buyer.legalName,
        address: invoice.snapshot.buyer.address,
      },
      invoice: {
        ...invoiceRef(invoice),
        taxTreatments: [
          {
            key: "2:4",
            taxCode: "2",
            rateCode: "4",
            percentage: "15",
            catalogType: "iva-rate",
            entryKey: "4",
            versionId: "4@1",
            officialLabel: ivaLabel("4"),
          },
        ],
      },
      concepts: [
        {
          position: 1,
          cause,
          description:
            cause === "LATE_PAYMENT_INTEREST"
              ? "Intereses por pago tardío de la factura"
              : "Flete adicional no incluido en la factura",
          amount: money(amount),
          taxTreatment: "2:4",
        },
      ],
      taxes: [
        { taxCode: "2", rateCode: "4", percentage: "15", base: money(amount), amount: money(vat) },
      ],
      totals: { withoutTaxes: money(amount), total: money(amount + vat) },
      payments: [
        {
          position: 1,
          entryKey: "20",
          code: "20",
          catalogType: "payment-method",
          versionId: "20@1",
          datasetVersion: 1,
          officialLabel: payLabel("20"),
          amount: money(amount + vat),
        },
      ],
      declarations: {
        version: 1,
        statements: [...DEBIT_NOTE_DECLARATION_STATEMENTS],
        declaredBy: user,
        declaredAt: `${issueDate}T14:00:00.000Z`,
        basis: "USER_DECLARED",
      },
      key: {
        documentNumber: key.documentNumber,
        sequential: key.sequential,
        numericCode: key.numericCode,
        emissionType: "1",
        accessKey: key.accessKey,
      },
    };
    const id = `${PREFIX}dn-${index + 1}`;
    push({
      id,
      type: "05",
      point,
      issueDate,
      state: laterState(),
      snapshot,
      buyerIdentification: snapshot.buyer.identification,
      buyerName: snapshot.buyer.legalName,
      total: snapshot.totals.total,
      key,
    });
    supports.push(`(${quote(company)}, ${quote(id)}, ${quote(invoice.row.id)}, now())`);
  }

  // Retenciones: renta e IVA sobre facturas de proveedores.
  const withholdingRows: string[] = [];
  const withholdingLines: string[] = [];
  const ref = (catalogType: string, entryKey: string) => ({
    catalogType,
    entryKey,
    versionId: `${entryKey}@1`,
    datasetVersion: 1,
  });
  for (let index = 0; index < 22; index += 1) {
    const supplier = suppliers[index % suppliers.length]!;
    const point = points[0]!;
    const issueDate = isoDate(rand.int(0, 120));
    const base = rand.int(10000, 250000);
    const vat = Math.round(base * 0.15);
    const rent = Math.round(base * 0.0175);
    const vatWithheld = Math.round(vat * 0.3);
    const supportNumber = `001001${String(100000000 + index * 37).slice(0, 9)}`;
    const supportDate = isoDate(rand.int(5, 130));
    const period = `${issueDate.slice(5, 7)}/${issueDate.slice(0, 4)}`;
    const key = keyFor("07", point, issueDate);
    const snapshot: WithholdingSnapshot = {
      snapshotVersion: 1,
      schema: schema("07", "ComprobanteRetencion_V2.0.0.xsd"),
      ...common(issueDate),
      calculationVersion: WITHHOLDING_CALCULATION_VERSION,
      issuer: issuerAt(point),
      subject: {
        partyId: supplier.id,
        identificationType: supplier.identificationType,
        identification: supplier.identification,
        legalName: supplier.legalName,
      },
      relatedParty: {
        value: "NO",
        basis: "USER_DECLARED",
        declaredBy: user,
        declaredByName: context.userName,
        declaredAt: `${issueDate}T14:00:00.000Z`,
      },
      fiscalPeriod: period,
      supports: [
        {
          position: 1,
          documentType: {
            code: "01",
            label: "Factura",
            ref: ref("withholding-support-document-type", "01"),
          },
          supportCode: {
            code: "01",
            label: "Crédito tributario para declaración de IVA",
            ref: ref("withholding-support-code", "01"),
          },
          number: supportNumber,
          issueDate: supportDate,
          authorizationNumber: "1".repeat(49),
          totalWithoutTaxes: money(base),
          importTotal: money(base + vat),
          taxes: [
            {
              position: 1,
              taxCode: "2",
              taxLabel: "IVA",
              taxRef: ref("tax-type", "2"),
              rateCode: "4",
              rateLabel: ivaLabel("4"),
              rateRef: ref("iva-rate", "4"),
              tariff: "15",
              tariffBasis: "CATALOG",
              base: money(base),
              amount: money(vat),
            },
          ],
          payments: [
            {
              position: 1,
              code: "20",
              label: payLabel("20"),
              ref: ref("payment-method", "20"),
              total: money(base + vat),
            },
          ],
          withholdings: [
            {
              position: 1,
              tax: "1",
              taxLabel: "RENTA",
              taxRef: ref("withholding-tax", "1"),
              code: "312",
              label: "Transferencia de bienes muebles de naturaleza corporal",
              ref: ref("rent-withholding", "312"),
              base: money(base),
              percentage: "1.75",
              amount: money(rent),
            },
            {
              position: 2,
              tax: "2",
              taxLabel: "IVA",
              taxRef: ref("withholding-tax", "2"),
              code: "1",
              label: "Retención del 30 % del IVA",
              ref: ref("vat-withholding", "1"),
              base: money(vat),
              percentage: "30",
              amount: money(vatWithheld),
            },
          ],
        },
      ],
      totals: { withheld: money(rent + vatWithheld) },
      key: {
        documentNumber: key.documentNumber,
        sequential: key.sequential,
        numericCode: key.numericCode,
        emissionType: "1",
        accessKey: key.accessKey,
      },
    };
    const id = `${PREFIX}wh-${index + 1}`;
    push({
      id,
      type: "07",
      point,
      issueDate,
      state: laterState(),
      snapshot,
      buyerIdentification: supplier.identification,
      buyerName: supplier.legalName,
      total: money(rent + vatWithheld),
      key,
    });
    withholdingRows.push(
      `(${quote(company)}, ${quote(id)}, ${quote(supplier.id)}, 'NO', ${quote(period)}, now())`,
    );
    withholdingLines.push(
      `(${quote(company)}, ${quote(id)}, 1, 1, '01', '01', ${quote(supportNumber)}, ${quote(supportDate)}, '1', '312', '1-312', ${money(base)}, 1.75, ${money(rent)})`,
      `(${quote(company)}, ${quote(id)}, 1, 2, '01', '01', ${quote(supportNumber)}, ${quote(supportDate)}, '2', '1', '2-1', ${money(vat)}, 30, ${money(vatWithheld)})`,
    );
  }

  // Guías de remisión con una o dos entregas sustentadas en facturas autorizadas.
  const guideRows: string[] = [];
  const guideRecipients: string[] = [];
  const documentRecipients: string[] = [];
  for (let index = 0; index < 16; index += 1) {
    const point = points[0]!;
    const issueDate = isoDate(rand.int(0, 90));
    const deliveries = Array.from({ length: index % 3 === 0 ? 2 : 1 }, (_, position) => {
      const invoice = authorizedInvoices[(index * 3 + position) % authorizedInvoices.length]!;
      return { invoice, position: position + 1 };
    });
    const recipients: ShippingGuideSnapshot["recipients"] = deliveries.map(
      ({ invoice, position }) => ({
        position,
        kind: "PARTY",
        partyId: invoice.snapshot.buyer.partyId,
        destination: null,
        identificationType: invoice.snapshot.buyer.identificationType,
        identification: invoice.snapshot.buyer.identification,
        legalName: invoice.snapshot.buyer.legalName,
        address: invoice.snapshot.buyer.address ?? "Quito",
        motive: "Venta",
        route: "Quito - destino",
        destinationEstablishmentCode: null,
        support: {
          kind: "INTERNAL_INVOICE",
          invoice: {
            id: invoice.row.id,
            documentType: "01",
            documentNumber: invoice.row.documentNumber,
            issueDate: invoice.row.issueDate,
            accessKey: invoice.row.accessKey,
            authorization: {
              number: invoice.row.accessKey,
              date: authorizedAt(invoice.row.issueDate),
              environment: "TEST",
            },
          },
        },
        details: invoice.snapshot.lines.slice(0, 2).map((line, detail) => ({
          position: detail + 1,
          productId: line.productId,
          productName: line.description,
          mainCode: line.mainCode,
          auxiliaryCode: null,
          description: line.description,
          quantity: line.quantity,
        })),
      }),
    );
    const detailCount = recipients.reduce((sum, recipient) => sum + recipient.details.length, 0);
    const plate = `PBA-${rand.int(1000, 9999)}`;
    const key = keyFor("06", point, issueDate);
    const snapshot: ShippingGuideSnapshot = {
      snapshotVersion: 1,
      schema: schema("06", "guiaRemision_V1.1.0.xsd"),
      ...common(issueDate),
      issuer: (({ largeTaxpayer: _largeTaxpayer, ...issuer }) => issuer)(issuerAt(point)),
      departure: {
        source: "ESTABLISHMENT",
        establishment: {
          id: point.establishmentId,
          code: point.establishmentCode,
          address: point.address,
        },
        address: point.address,
      },
      transporter: {
        source: "SELF",
        partyId: null,
        identificationType: "04",
        identification: context.issuer.ruc,
        legalName: context.issuer.legalName,
      },
      plate,
      transportStart: issueDate,
      transportEnd: issueDate,
      recipients,
      counts: { recipients: recipients.length, details: detailCount },
      key: {
        documentNumber: key.documentNumber,
        sequential: key.sequential,
        numericCode: key.numericCode,
        emissionType: "1",
        accessKey: key.accessKey,
      },
    };
    const id = `${PREFIX}gr-${index + 1}`;
    push({
      id,
      type: "06",
      point,
      issueDate,
      state: laterState(),
      snapshot,
      buyerIdentification: null,
      buyerName: null,
      total: null,
      key,
    });
    guideRows.push(
      `(${quote(company)}, ${quote(id)}, ${quote(point.establishmentId)}, 'SELF', NULL, '04', ${quote(context.issuer.ruc)}, ${quote(context.issuer.legalName)}, ${quote(plate)}, ${quote(issueDate)}, ${quote(issueDate)}, ${recipients.length}, ${detailCount}, now())`,
    );
    for (const recipient of recipients) {
      const support = recipient.support as Extract<
        typeof recipient.support,
        { kind: "INTERNAL_INVOICE" }
      >;
      guideRecipients.push(
        `(${quote(company)}, ${quote(id)}, ${recipient.position}, 'PARTY', ${quote(recipient.partyId)}, NULL, 'INTERNAL_INVOICE', ${quote(support.invoice.id)}, NULL, NULL, NULL, NULL, ${recipient.details.length})`,
      );
      const name = deliveries.find((delivery) => delivery.position === recipient.position)!.invoice
        .snapshot.buyer.legalName;
      documentRecipients.push(
        `(${quote(company)}, ${quote(id)}, ${recipient.position}, ${quote(recipient.identification)}, ${quote(name)})`,
      );
    }
  }

  // Liquidaciones de compra a proveedores sin RUC activo.
  const settlementRows: string[] = [];
  const declarationRows: string[] = [];
  for (let index = 0; index < 14; index += 1) {
    const supplier = suppliers[(index + 2) % suppliers.length]!;
    const point = points[0]!;
    const issueDate = isoDate(rand.int(0, 120));
    const quantity = rand.int(5, 80);
    const unitPrice = rand.int(150, 2500);
    const base = quantity * unitPrice;
    const description = rand.pick([
      "Maíz en grano por quintal",
      "Leña seca por carga",
      "Jornal agrícola",
      "Papa chola por saco",
    ]);
    const key = keyFor("03", point, issueDate);
    const declaredAt = `${issueDate}T14:00:00.000Z`;
    const snapshot: PurchaseSettlementSnapshot = {
      snapshotVersion: 1,
      schema: schema("03", "liquidacionCompra_V1.1.0.xsd"),
      ...common(issueDate),
      calculationVersion: PURCHASE_SETTLEMENT_CALCULATION_VERSION,
      issuer: issuerAt(point),
      supplier: {
        partyId: supplier.id,
        identificationType: supplier.identificationType,
        identification: supplier.identification,
        legalName: supplier.legalName,
        address: supplier.address ?? "Quito",
      },
      eligibility: {
        case: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case,
        policy: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id,
        rule: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule,
        policyVersion: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version,
        declarations: PURCHASE_SETTLEMENT_STATEMENTS.map((statementId) => ({
          statementId,
          policyVersion: 1,
          basis: "USER_DECLARED",
          declaredBy: user,
          declaredByName: context.userName,
          declaredAt,
        })),
      },
      lines: [
        {
          position: 1,
          productId: null,
          mainCode: null,
          auxiliaryCode: null,
          description,
          unit: "unidad",
          quantity: String(quantity),
          unitPrice: money(unitPrice),
          discount: "0.00",
          taxableBase: money(base),
          tax: {
            taxCode: "2",
            rateCode: "0",
            rateKind: "PERCENTAGE",
            percentage: "0",
            label: ivaLabel("0"),
            ref: ref("iva-rate", "0"),
            base: money(base),
            amount: "0.00",
          },
        },
      ],
      totals: {
        withoutTaxes: money(base),
        discount: "0.00",
        taxes: [
          { taxCode: "2", rateCode: "0", percentage: "0", base: money(base), amount: "0.00" },
        ],
        total: money(base),
      },
      payments: [
        {
          position: 1,
          code: "01",
          officialLabel: payLabel("01"),
          ref: ref("payment-method", "01"),
          total: money(base),
          term: "0",
          timeUnit: "dias",
        },
      ],
      currency: PURCHASE_SETTLEMENT_CURRENCY,
      counts: { lines: 1, payments: 1 },
      key: {
        documentNumber: key.documentNumber,
        sequential: key.sequential,
        numericCode: key.numericCode,
        emissionType: "1",
        accessKey: key.accessKey,
      },
    };
    const id = `${PREFIX}lc-${index + 1}`;
    push({
      id,
      type: "03",
      point,
      issueDate,
      state: laterState(),
      snapshot,
      buyerIdentification: supplier.identification,
      buyerName: supplier.legalName,
      total: money(base),
      key,
    });
    settlementRows.push(
      `(${quote(company)}, ${quote(id)}, ${quote(supplier.id)}, 'ART_13_C', 'PURCHASE_SETTLEMENT_ELIGIBILITY_V1', 1, 1, 1, now())`,
    );
    for (const statementId of PURCHASE_SETTLEMENT_STATEMENTS) {
      declarationRows.push(
        `(${quote(company)}, ${quote(id)}, ${quote(statementId)}, 1, 'USER_DECLARED', ${quote(user)}, ${quote(declaredAt)})`,
      );
    }
  }

  // SQL: reservas, comprobantes, tablas auxiliares y un `sri.transmit` detenido por cada firmado.
  const values = (items: string[]) => items.join(",\n");
  const reservationValues = rows.map(
    (row) =>
      `(${quote(`${row.id}-res`)}, ${quote(company)}, 'TEST', ${quote(row.point.establishmentId)}, ${quote(row.point.id)}, ${quote(row.type)}, ${row.sequential}, now(), ${quote(user)}, 'dev-seed')`,
  );
  const documentValues = rows.map((row) => {
    const authorized = row.state === "AUTHORIZED";
    const createdAt = `${row.issueDate}T14:${String(rand.int(10, 59))}:00.000Z`;
    return `(${quote(row.id)}, ${quote(company)}, ${quote(row.type)}, 'TEST', ${quote(row.point.establishmentId)}, ${quote(row.point.id)}, ${quote(row.documentNumber)}, ${row.sequential}, ${quote(`${row.id}-res`)}, ${quote(row.accessKey)}, ${quote(row.numericCode)}, ${quote(row.issueDate)}, ${quote(row.state)}, ${quote(JSON.stringify(row.snapshot))}::jsonb, '1.1.0', ${quote(row.buyerIdentification)}, ${quote(row.buyerName)}, ${row.total ?? "NULL"}, ${quote(createdAt)}, ${quote(user)}, ${quote(createdAt)}, 1, ${authorized ? quote(row.accessKey) : "NULL"}, ${authorized ? quote(authorizedAt(row.issueDate)) : "NULL"}, ${authorized ? "'TEST'" : "NULL"})`;
  });
  const stoppedJobs = rows
    .filter((row) => row.state === "SIGNED")
    .map(
      (row) =>
        `(${quote(`${row.id}-job`)}, ${quote(company)}, 'sri.transmit', ${quote(`sri.transmit:${row.id}`)}, NULL, ${quote(row.id)}, NULL, '{}'::jsonb, 'STOPPED', now(), now(), 0, 1, NULL, NULL, NULL, 'DEV_SEED', 'DETERMINISTIC', now(), 'AUTOMATIC', NULL, 'Sembrado de desarrollo: nunca se envía al SRI.', now(), now(), now())`,
    );
  const sql = `BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO fiscal_sequence_reservation (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id) VALUES
${values(reservationValues)};
INSERT INTO electronic_document (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, attempt_count, authorization_number, authorization_date, authorization_environment) VALUES
${values(documentValues)};
INSERT INTO credit_reservation (id, company_id, invoice_id, credit_note_id, cause, amount, status, reserved_at, concluded_at) VALUES
${values(reservations)};
INSERT INTO debit_note_support (company_id, debit_note_id, invoice_id, created_at) VALUES
${values(supports)};
INSERT INTO withholding_receipt (company_id, document_id, party_id, related_party, fiscal_period, created_at) VALUES
${values(withholdingRows)};
INSERT INTO withholding_receipt_line (company_id, document_id, support_position, position, support_document_type, support_code, support_number, support_issue_date, tax, withholding_code, entry_key, base, percentage, amount) VALUES
${values(withholdingLines)};
INSERT INTO shipping_guide (company_id, document_id, origin_establishment_id, transporter_source, carrier_party_id, carrier_identification_type, carrier_identification, carrier_name, plate, transport_start, transport_end, recipient_count, detail_count, created_at) VALUES
${values(guideRows)};
INSERT INTO shipping_guide_recipient (company_id, document_id, position, recipient_kind, party_id, destination_establishment_id, support_kind, invoice_id, exception_case, exception_policy_version, declared_by, declared_at, detail_count) VALUES
${values(guideRecipients)};
INSERT INTO electronic_document_recipient (company_id, document_id, position, identification, name) VALUES
${values(documentRecipients)};
INSERT INTO purchase_settlement (company_id, document_id, supplier_party_id, eligibility_case, eligibility_policy, policy_version, line_count, payment_count, created_at) VALUES
${values(settlementRows)};
INSERT INTO purchase_settlement_declaration (company_id, document_id, statement_id, policy_version, basis, declared_by, declared_at) VALUES
${values(declarationRows)};
${stoppedJobs.length ? `INSERT INTO job (id, company_id, type, dedupe_key, active_dedupe_key, document_id, active_sri_document_id, payload, status, scheduled_at, next_attempt_at, attempt_count, max_attempts, deadline_at, lease_owner, lease_expires_at, last_error_code, last_error_class, last_error_at, origin, requested_by, reason, created_at, updated_at, completed_at) VALUES\n${values(stoppedJobs)};` : ""}
${[...sequences.entries()]
  .map(([series, last]) => {
    const [type, pointId] = series.split(":");
    const point = points.find((item) => item.id === pointId)!;
    return `INSERT INTO fiscal_sequence (id, company_id, environment, establishment_id, emission_point_id, document_type, next_number, last_reserved, created_at, updated_at)
VALUES (${quote(`${PREFIX}seq-${type}-${pointId}`)}, ${quote(company)}, 'TEST', ${quote(point.establishmentId)}, ${quote(pointId)}, ${quote(type)}, ${last + 1}, ${last}, now(), now())
ON CONFLICT (company_id, environment, establishment_id, emission_point_id, document_type) DO UPDATE SET next_number = GREATEST(fiscal_sequence.next_number, EXCLUDED.next_number), last_reserved = GREATEST(fiscal_sequence.last_reserved, EXCLUDED.last_reserved);`;
  })
  .join("\n")}
COMMIT;`;
  psql(sql);
  const count = (type: Row["type"]) => rows.filter((row) => row.type === type).length;
  log(
    `${rows.length} comprobantes en Pruebas: ${count("01")} facturas, ${count("04")} notas de crédito, ${count("05")} notas de débito, ${count("07")} retenciones, ${count("06")} guías y ${count("03")} liquidaciones`,
  );
  log(`${stoppedJobs.length} firmados con su envío detenido: ninguno queda en camino al SRI`);
}

// ─── Principal ──────────────────────────────────────────────────────────────────────────────────

async function main() {
  guards();
  if (process.argv.includes("--reset")) {
    reset();
    return;
  }
  await signIn();
  const { points, parties, products } = await seedThroughApi();
  await seedDrafts(points, parties, products);

  const company = psql('SELECT id FROM organization ORDER BY "createdAt" LIMIT 1');
  const userRow = json<{ id: string; name: string }>(
    `SELECT json_build_object('id', u.id, 'name', u.name) FROM "user" u JOIN member m ON m."userId" = u.id WHERE m."organizationId" = ${quote(company)} ORDER BY u."createdAt" LIMIT 1`,
  );
  const configVersion = json<{ id: string; version: number }>(
    `SELECT json_build_object('id', id, 'version', version) FROM company_config_version WHERE company_id = ${quote(company)} ORDER BY version DESC LIMIT 1`,
  );
  const { profile: taxpayer } = await api<{
    profile: {
      ruc: string;
      legalName: string;
      tradeName: string | null;
      headOfficeAddress: string;
      accountingRequired: boolean;
      specialTaxpayerNumber: string | null;
      withholdingAgentResolution: string | null;
      rimpeCategory: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;
      largeTaxpayer?: boolean;
    };
  }>("GET", "/taxpayer");
  const labels: Record<string, Record<string, string>> = {};
  for (const entry of json<{ type: string; key: string; label: string }[]>(
    `SELECT json_agg(json_build_object('type', catalog_type, 'key', entry_key, 'label', official_label)) FROM fiscal_catalog_entry WHERE catalog_type IN ('iva-rate', 'payment-method')`,
  ) ?? []) {
    (labels[entry.type] ??= {})[entry.key] = entry.label;
  }
  seedDocumentsSql({
    company,
    user: userRow.id,
    userName: userRow.name,
    configVersion,
    issuer: {
      ruc: taxpayer.ruc,
      legalName: taxpayer.legalName,
      tradeName: taxpayer.tradeName,
      headOfficeAddress: taxpayer.headOfficeAddress,
      accountingRequired: taxpayer.accountingRequired,
      specialTaxpayerNumber: taxpayer.specialTaxpayerNumber,
      withholdingAgentResolution: taxpayer.withholdingAgentResolution,
      rimpeCategory: taxpayer.rimpeCategory,
      largeTaxpayer: taxpayer.largeTaxpayer ?? false,
    },
    points,
    parties,
    products,
    labels,
  });
  log("listo: abre el despliegue y recarga");
}

await main();
