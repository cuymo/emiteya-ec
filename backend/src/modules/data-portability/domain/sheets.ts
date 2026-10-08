// Hojas de los libros del paquete (add-data-portability, design D4 y D8). Cada hoja tiene sus
// columnas con el tipo de celda del escritor XLSX compartido (texto, importe, decimal, fecha y
// momento) y convierte cada fila de su fuente. Las claves entre hojas y archivos son naturales: la
// clave de acceso del comprobante, el correo del usuario, el código del producto y la
// identificación del tercero; ningún identificador interno.
import {
  ARTIFACT_KIND_LABELS,
  DELIVERY_EVENT_LABELS,
  DOCUMENT_TYPE_LABELS,
  INVOICE_STATE_LABELS,
  PARTY_ROLE_LABELS,
  PRODUCT_KIND_LABELS,
  REPORT_ENVIRONMENT_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
} from "@facturador/contracts";
import type { XlsxColumn, XlsxValue } from "../../../platform/xlsx/xlsx-writer.ts";
import type {
  AttemptRow,
  AuditEventRow,
  CatalogSettingRow,
  CertificateRow,
  ConfigVersionRow,
  DeliveryRow,
  DocumentRow,
  EmissionPointRow,
  EstablishmentRow,
  PartyRow,
  ProductRow,
  ProductTaxRow,
  RecipientRow,
  SequenceRow,
  StockBalanceRow,
  StockMovementRow,
  TransitionRow,
  UserRow,
  WithholdingLineRow,
} from "../application/ports.ts";
import { ARTIFACT_FILES, documentFolder, responseFile } from "./format.ts";

/** Filas de datos de una hoja de Excel: 1 048 576 con la de encabezados (design D8). */
export const MAX_DATA_ROWS = 1_048_575;

/** Lo que una fila necesita resolver con las demás hojas: nunca identificadores internos. */
export type Lookups = Readonly<{
  userEmail(userId: string | null): string | null;
  establishmentCode(id: string): string | null;
  pointCode(id: string): string | null;
  product(id: string): Readonly<{ code: string | null; name: string }> | null;
  logoSha256(assetId: string | null): string | null;
}>;

export type SheetDefinition<R> = Readonly<{
  name: string;
  columns: readonly XlsxColumn[];
  row(row: R, lookups: Lookups): readonly XlsxValue[];
}>;

const text = (header: string, width = 18): XlsxColumn => ({ header, kind: "text", width });
const money = (header: string): XlsxColumn => ({ header, kind: "money", width: 16 });
const decimal = (header: string, width = 14): XlsxColumn => ({ header, kind: "decimal", width });
const date = (header: string): XlsxColumn => ({ header, kind: "date", width: 12 });
const moment = (header: string): XlsxColumn => ({ header, kind: "dateTime", width: 20 });

const yesNo = (value: boolean) => (value ? "Sí" : "No");
const count = (value: number | null) => (value === null ? null : String(value));
const environment = (value: string) =>
  REPORT_ENVIRONMENT_LABELS[value as keyof typeof REPORT_ENVIRONMENT_LABELS] ?? value;
const documentType = (value: string) =>
  DOCUMENT_TYPE_LABELS[value as keyof typeof DOCUMENT_TYPE_LABELS] ?? value;
const state = (value: string | null) =>
  value === null
    ? null
    : (INVOICE_STATE_LABELS[value as keyof typeof INVOICE_STATE_LABELS] ?? value);
const json = (value: unknown) =>
  value === null || value === undefined ? null : JSON.stringify(value);
const ACTIVE = { true: "Activo", false: "Inactivo" } as const;
const RECORD_STATUS: Readonly<Record<string, string>> = { ACTIVE: "Activo", INACTIVE: "Inactivo" };
const MEMBER_STATUS: Readonly<Record<string, string>> = {
  ACTIVE: "Activo",
  DEACTIVATED: "Desactivado",
};
const ROLES: Readonly<Record<string, string>> = { ADMIN: "Administrador", OPERATOR: "Operador" };
const ACTORS: Readonly<Record<string, string>> = {
  USER: "Usuario",
  SYSTEM: "Sistema",
  TECHNICAL_ADMIN: "Administrador técnico",
};
const OPERATIONS: Readonly<Record<string, string>> = {
  RECEPTION: "Recepción",
  AUTHORIZATION: "Autorización",
  VALIDITY: "Validez",
};
const SYSTEM_RECORDS: Readonly<Record<string, string>> = { CONSUMER_FINAL: "Consumidor final" };
const CERTIFICATE_STATUS: Readonly<Record<string, string>> = {
  ACTIVE: "Activa",
  REPLACED: "Reemplazada",
};
const actor = (type: string, userId: string | null, lookups: Lookups) =>
  type === "USER" ? lookups.userEmail(userId) : (ACTORS[type] ?? type);

export const CONFIG_VERSIONS: SheetDefinition<ConfigVersionRow> = {
  name: "Configuración",
  columns: [
    decimal("Versión", 9),
    text("Vigente", 8),
    moment("Desde"),
    text("RUC", 15),
    text("Razón social", 40),
    text("Nombre comercial", 30),
    text("Dirección matriz", 40),
    text("Teléfono"),
    text("Correo", 30),
    text("Obligado a llevar contabilidad", 12),
    text("Contribuyente especial"),
    text("Agente de retención"),
    text("Gran contribuyente", 12),
    text("RIMPE"),
    text("RUC del proveedor del sistema", 15),
    text("Ambiente", 12),
    text("Logo (SHA-256)", 66),
  ],
  row: (v, lookups) => [
    String(v.version),
    yesNo(v.current),
    v.createdAt,
    v.ruc,
    v.legalName,
    v.tradeName,
    v.headOfficeAddress,
    v.phone,
    v.email,
    yesNo(v.accountingRequired),
    v.specialTaxpayerNumber,
    v.withholdingAgentResolution,
    yesNo(v.largeTaxpayer),
    v.rimpeCategory,
    v.providerRuc,
    environment(v.environment),
    lookups.logoSha256(v.logoAssetId),
  ],
};

export const ESTABLISHMENTS: SheetDefinition<EstablishmentRow> = {
  name: "Establecimientos",
  columns: [text("Código", 8), text("Dirección", 40), text("Estado", 10), moment("Creado")],
  row: (e) => [e.code, e.address, ACTIVE[`${e.active}`], e.createdAt],
};

export const EMISSION_POINTS: SheetDefinition<EmissionPointRow> = {
  name: "Puntos de emisión",
  columns: [text("Establecimiento", 8), text("Punto", 8), text("Estado", 10), moment("Creado")],
  row: (p, lookups) => [
    lookups.establishmentCode(p.establishmentId),
    p.code,
    ACTIVE[`${p.active}`],
    p.createdAt,
  ],
};

export const SEQUENCES: SheetDefinition<SequenceRow> = {
  name: "Secuenciales",
  columns: [
    text("Ambiente", 12),
    text("Establecimiento", 8),
    text("Punto", 8),
    text("Tipo de comprobante", 26),
    decimal("Siguiente número"),
    decimal("Último reservado"),
    moment("Actualizado"),
  ],
  row: (s, lookups) => [
    environment(s.environment),
    lookups.establishmentCode(s.establishmentId),
    lookups.pointCode(s.emissionPointId),
    documentType(s.documentType),
    String(s.nextNumber),
    count(s.lastReserved),
    s.updatedAt,
  ],
};

export const CATALOG_SETTINGS: SheetDefinition<CatalogSettingRow> = {
  name: "Catálogos habilitados",
  columns: [
    text("Catálogo", 24),
    text("Entrada", 14),
    text("Código", 10),
    text("Habilitada", 10),
    moment("Actualizada"),
    text("Por", 30),
  ],
  row: (c, lookups) => [
    c.catalogType,
    c.entryKey,
    c.code,
    yesNo(c.enabled),
    c.updatedAt,
    lookups.userEmail(c.updatedBy),
  ],
};

export const CERTIFICATES: SheetDefinition<CertificateRow> = {
  name: "Firmas",
  columns: [
    text("Estado", 12),
    text("Titular", 40),
    text("Emisor", 40),
    text("Número de serie", 24),
    text("Huella SHA-256", 66),
    moment("Vigente desde"),
    moment("Vigente hasta"),
    text("RUC detectado", 15),
    text("Algoritmo", 10),
    decimal("Bits", 8),
    text("Cargada por", 30),
    moment("Cargada"),
    moment("Reemplazada"),
  ],
  row: (c, lookups) => [
    CERTIFICATE_STATUS[c.status] ?? c.status,
    c.subject,
    c.issuer,
    c.serialNumber,
    c.fingerprintSha256,
    c.notBefore,
    c.notAfter,
    c.detectedRuc,
    c.keyAlgorithm,
    String(c.keyBits),
    lookups.userEmail(c.uploadedBy),
    c.createdAt,
    c.replacedAt,
  ],
};

/** Usuarios con su punto predeterminado, resuelto como `establecimiento-punto`. */
export type UserWithDefault = UserRow & Readonly<{ defaultPoint: string | null }>;
export const USERS: SheetDefinition<UserWithDefault> = {
  name: "Usuarios",
  columns: [
    text("Nombre", 30),
    text("Correo", 30),
    text("Rol", 14),
    text("Estado", 12),
    moment("Miembro desde"),
    text("Punto predeterminado", 12),
  ],
  row: (u) => [
    u.name,
    u.email,
    ROLES[u.role] ?? u.role,
    MEMBER_STATUS[u.status] ?? u.status,
    u.memberSince,
    u.defaultPoint,
  ],
};

export const PARTIES: SheetDefinition<PartyRow> = {
  name: "Terceros",
  columns: [
    text("Tipo de identificación", 12),
    text("Identificación", 16),
    text("Razón social", 40),
    text("Dirección", 40),
    text("Correo", 30),
    text("Teléfono", 16),
    text("Roles", 26),
    text("Estado", 10),
    text("Registro del sistema", 18),
    moment("Creado"),
    moment("Actualizado"),
  ],
  row: (p) => [
    p.identificationType,
    p.identification,
    p.legalName,
    p.address,
    p.email,
    p.phone,
    p.roles
      .map((role) => PARTY_ROLE_LABELS[role as keyof typeof PARTY_ROLE_LABELS] ?? role)
      .join(", "),
    RECORD_STATUS[p.status] ?? p.status,
    p.systemRecord === null ? null : (SYSTEM_RECORDS[p.systemRecord] ?? p.systemRecord),
    p.createdAt,
    p.updatedAt,
  ],
};

export const PRODUCTS: SheetDefinition<ProductRow> = {
  name: "Productos",
  columns: [
    text("Código principal", 16),
    text("Código auxiliar", 16),
    text("Nombre", 40),
    text("Descripción", 40),
    text("Tipo", 10),
    decimal("Precio unitario", 16),
    text("Control de stock", 10),
    text("Estado", 10),
    moment("Creado"),
    moment("Actualizado"),
  ],
  row: (p) => [
    p.mainCode,
    p.auxiliaryCode,
    p.name,
    p.description,
    PRODUCT_KIND_LABELS[p.kind as keyof typeof PRODUCT_KIND_LABELS] ?? p.kind,
    p.unitPrice,
    yesNo(p.stockTracked),
    RECORD_STATUS[p.status] ?? p.status,
    p.createdAt,
    p.updatedAt,
  ],
};

export const PRODUCT_TAXES: SheetDefinition<ProductTaxRow> = {
  name: "Impuestos",
  columns: [
    text("Código principal", 16),
    text("Producto", 40),
    text("Catálogo", 24),
    text("Entrada", 14),
  ],
  row: (t, lookups) => {
    const product = lookups.product(t.productId);
    return [product?.code ?? null, product?.name ?? null, t.catalogType, t.entryKey];
  },
};

export const RIDE_STATUS = { AVAILABLE: "Disponible", PENDING: "Pendiente", STOPPED: "Detenido" };

export const DOCUMENTS: SheetDefinition<DocumentRow> = {
  name: "Comprobantes",
  columns: [
    text("Ambiente", 12),
    text("Tipo", 24),
    text("Número", 18),
    text("Clave de acceso", 50),
    date("Fecha de emisión"),
    text("Estado", 24),
    text("Código de estado", 16),
    text("Identificación del tercero", 16),
    text("Tercero", 40),
    money("Subtotal"),
    money("Impuestos"),
    money("Total"),
    text("Número de autorización", 50),
    moment("Fecha de autorización"),
    text("Carpeta", 60),
    text("XML firmado (SHA-256)", 66),
    text("XML autorizado (SHA-256)", 66),
    text("RIDE (SHA-256)", 66),
    text("RIDE", 12),
  ],
  row: (d) => {
    const sha = (kind: string) => d.artifacts.find((x) => x.kind === kind)?.sha256 ?? null;
    const ride = sha("RIDE_PDF");
    return [
      environment(d.environment),
      documentType(d.documentType),
      d.documentNumber,
      d.accessKey,
      d.issueDate,
      state(d.state),
      d.state,
      d.counterpartIdentification,
      d.recipientCount !== null && d.recipientCount !== 1
        ? `${d.recipientCount} destinatarios`
        : d.counterpartName,
      d.subtotal,
      d.taxes,
      d.total,
      d.authorizationNumber,
      d.authorizationDate,
      documentFolder(d),
      sha("SIGNED_XML"),
      sha("AUTHORIZED_XML"),
      ride,
      d.state !== "AUTHORIZED"
        ? null
        : ride
          ? RIDE_STATUS.AVAILABLE
          : d.rideJobStatus === "STOPPED"
            ? RIDE_STATUS.STOPPED
            : RIDE_STATUS.PENDING,
    ];
  },
};

export const TRANSITIONS: SheetDefinition<TransitionRow> = {
  name: "Transiciones",
  columns: [
    text("Clave de acceso", 50),
    text("Desde", 16),
    text("Hasta", 16),
    text("Causa", 24),
    text("Actor", 30),
    moment("Momento"),
  ],
  row: (t, lookups) => [
    t.accessKey,
    t.fromState,
    t.toState,
    t.cause,
    actor(t.actorType, t.actorUserId, lookups),
    t.occurredAt,
  ],
};

export const ATTEMPTS: SheetDefinition<AttemptRow> = {
  name: "Intentos SRI",
  columns: [
    text("Clave de acceso", 50),
    decimal("Intento", 8),
    text("Operación", 14),
    text("Ambiente", 12),
    moment("Inicio"),
    moment("Fin"),
    text("Transporte", 16),
    decimal("HTTP", 6),
    text("Resultado", 18),
    text("Mensajes", 60),
    text("Archivo de la respuesta", 28),
    text("Respuesta (SHA-256)", 66),
    decimal("Respuesta (bytes)"),
    text("Tipo de contenido", 18),
    text("Truncada", 9),
    text("Sobre enviado (SHA-256)", 66),
    decimal("Sobre enviado (bytes)"),
    text("Iniciado por", 30),
  ],
  row: (a, lookups) => [
    a.accessKey,
    String(a.attemptNumber),
    OPERATIONS[a.operation] ?? a.operation,
    environment(a.environment),
    a.startedAt,
    a.completedAt,
    a.transportOutcome,
    count(a.httpStatus),
    a.outcome,
    json(a.messages),
    a.response
      ? responseFile({
          attemptNumber: a.attemptNumber,
          operation: a.operation,
          contentType: a.response.contentType,
        })
      : null,
    a.response?.sha256 ?? null,
    a.response ? String(a.response.sizeBytes) : null,
    a.response?.contentType ?? null,
    a.response ? yesNo(a.response.truncated) : null,
    a.envelopeSha256,
    String(a.envelopeSize),
    lookups.userEmail(a.initiatedBy),
  ],
};

export const WITHHOLDING_LINES: SheetDefinition<WithholdingLineRow> = {
  name: "Retenciones",
  columns: [
    text("Clave de acceso", 50),
    decimal("Sustento", 9),
    decimal("Línea", 7),
    text("Tipo de sustento", 10),
    text("Número de sustento", 18),
    date("Fecha de sustento"),
    text("Impuesto", 9),
    text("Código de retención", 12),
    money("Base"),
    decimal("Porcentaje", 11),
    money("Valor retenido"),
  ],
  row: (l) => [
    l.accessKey,
    String(l.supportPosition),
    String(l.position),
    l.supportDocumentType,
    l.supportNumber,
    l.supportIssueDate,
    l.tax,
    l.withholdingCode,
    l.base,
    l.percentage,
    l.amount,
  ],
};

export const RECIPIENTS: SheetDefinition<RecipientRow> = {
  name: "Destinatarios",
  columns: [
    text("Clave de acceso", 50),
    decimal("Posición", 9),
    text("Identificación", 16),
    text("Nombre", 40),
  ],
  row: (r) => [r.accessKey, String(r.position), r.identification, r.name],
};

export const DELIVERIES: SheetDefinition<DeliveryRow> = {
  name: "Entregas",
  columns: [
    text("Clave de acceso", 50),
    text("Evento", 22),
    text("Documento", 16),
    text("SHA-256", 66),
    text("Usuario", 30),
    moment("Momento"),
  ],
  row: (d, lookups) => [
    d.accessKey,
    DELIVERY_EVENT_LABELS[d.event as keyof typeof DELIVERY_EVENT_LABELS] ?? d.event,
    ARTIFACT_KIND_LABELS[d.artifactKind as keyof typeof ARTIFACT_KIND_LABELS] ?? d.artifactKind,
    d.artifactSha256,
    lookups.userEmail(d.actorUserId),
    d.occurredAt,
  ],
};

export const STOCK_BALANCES: SheetDefinition<StockBalanceRow> = {
  name: "Existencias",
  columns: [
    text("Código", 16),
    text("Producto", 40),
    decimal("Saldo", 22),
    moment("Inicializado"),
    moment("Actualizado"),
  ],
  row: (b, lookups) => {
    const product = lookups.product(b.productId);
    return [product?.code ?? null, product?.name ?? null, b.balance, b.initializedAt, b.updatedAt];
  },
};

export const STOCK_MOVEMENTS: SheetDefinition<StockMovementRow> = {
  name: "Movimientos",
  columns: [
    moment("Momento"),
    text("Código", 16),
    text("Producto", 40),
    decimal("Posición", 9),
    text("Tipo", 26),
    decimal("Cantidad", 18),
    decimal("Saldo resultante", 22),
    text("Comprobante", 18),
    text("Origen", 10),
    text("Usuario", 30),
    text("Motivo", 30),
  ],
  row: (m, lookups) => {
    const product = lookups.product(m.productId);
    return [
      m.occurredAt,
      product?.code ?? null,
      product?.name ?? null,
      String(m.position),
      STOCK_MOVEMENT_TYPE_LABELS[m.movementType as keyof typeof STOCK_MOVEMENT_TYPE_LABELS] ??
        m.movementType,
      m.delta,
      m.balanceAfter,
      m.documentNumber,
      m.origin,
      lookups.userEmail(m.actorUserId),
      m.reason,
    ];
  },
};

export const AUDIT_EVENTS: SheetDefinition<AuditEventRow> = {
  name: "Eventos",
  columns: [
    moment("Momento"),
    text("Tipo de actor", 20),
    text("Actor", 30),
    text("Acción", 34),
    text("Usuario afectado", 30),
    text("Cambios", 60),
  ],
  row: (e, lookups) => [
    e.occurredAt,
    ACTORS[e.actorType] ?? e.actorType,
    e.actorType === "USER" ? lookups.userEmail(e.actorUserId) : null,
    e.action,
    lookups.userEmail(e.targetUserId),
    json(e.changes),
  ],
};

/** El archivo de un artefacto dentro de su carpeta. */
export const artifactFile = (kind: keyof typeof ARTIFACT_FILES) => ARTIFACT_FILES[kind];

/**
 * Las hojas de un conjunto de `rows` filas: una, o varias si supera el máximo, con el mismo nombre
 * y un sufijo `(2)`, `(3)`… (design D8). Un conjunto vacío tiene su hoja con solo el encabezado.
 */
export function sheetNames(name: string, rows: number, max = MAX_DATA_ROWS): string[] {
  const sheets = Math.max(1, Math.ceil(rows / max));
  return Array.from({ length: sheets }, (_, index) =>
    index === 0 ? name : `${name} (${index + 1})`,
  );
}
