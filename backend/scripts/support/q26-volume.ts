// Volumen de Q-26 sembrado por SQL para los benchmarks (add-reports-export, design D18; también
// add-data-portability, design D22): 100 000 comprobantes de los seis tipos en Producción a lo largo
// de un año (más 2 000 facturas de Pruebas), con los snapshots reales de la factura y sus importes
// por fila, los destinatarios de las guías y las tres líneas de cada retención; 10 000 terceros,
// 10 000 productos y un kárdex de 300 000 movimientos. La siembra apaga los triggers de su sesión
// (`session_replication_role = replica`) para no construir los registros auxiliares de cada tipo que
// los benchmarks no leen (capacidades, reservas, registros de la guía y declaraciones); escribe las
// tablas que sí leen. Después, `VACUUM (ANALYZE)` y un `CHECKPOINT`.
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client.ts";
import { searchKey } from "../../src/platform/search/search-key.ts";
import { invoiceSnapshot } from "../../test/integration/credit-notes-harness.ts";

/** Comprobantes de Producción por tipo: 100 000 en total. */
export const DOCUMENTS = {
  "01": 70_000,
  "03": 6_000,
  "04": 8_000,
  "05": 4_000,
  "06": 6_000,
  "07": 6_000,
};
export const TEST_INVOICES = 2_000;
export const PARTIES = 10_000;
export const PRODUCTS = 10_000;
export const MOVEMENTS_PER_PRODUCT = 30;
export const DAYS = 365;
/** Último día del año sembrado y su primer día. */
export const LAST_DAY = "2026-10-08";
export const FIRST_DAY = "2025-10-09";
const BATCH = 10_000;

/** La empresa sembrada, el usuario que figura como autor y sus dos puntos de emisión. */
export type Q26Company = Readonly<{
  company: string;
  user: string;
  points: readonly { establishment: string; point: string }[];
}>;

export async function seedQ26Volume(
  prisma: PrismaClient,
  schema: string,
  { company, user, points }: Q26Company,
) {
  const t = (table: string) => `"${schema}"."${table}"`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${t("party")} (id, company_id, identification_type, identification, legal_name, address, email, phone, roles, status, version, search_name, search_identification, created_at, created_by, updated_at, updated_by)
     SELECT 'bench-party-' || g, $1, '04', '17' || lpad(g::text, 8, '0') || '001', n.name,
            'Av. de los Shyris ' || g || ', Quito', 'cliente' || g || '@ejemplo.ec', '099' || lpad(g::text, 7, '0'),
            CASE g % 3 WHEN 0 THEN ARRAY['CUSTOMER'] WHEN 1 THEN ARRAY['SUPPLIER'] ELSE ARRAY['CUSTOMER', 'CARRIER'] END,
            CASE WHEN g % 10 = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END, 1, lower(n.name),
            '17' || lpad(g::text, 8, '0') || '001', now(), $2, now(), $2
     FROM generate_series(1, ${PARTIES}) g
     CROSS JOIN LATERAL (SELECT 'TERCERO DEL BENCHMARK ' || lpad(g::text, 5, '0') || ' CÍA. LTDA.' AS name) n`,
    company,
    user,
  );
  for (let start = 1; start <= PRODUCTS; start += BATCH) {
    const products: Prisma.ProductCreateManyInput[] = [];
    const taxes: Prisma.ProductTaxCreateManyInput[] = [];
    for (let i = start; i < Math.min(PRODUCTS + 1, start + BATCH); i += 1) {
      const id = `bench-prod-${i}`;
      const name = `Producto del benchmark ${i}`;
      const mainCode = `P${String(i).padStart(6, "0")}`;
      products.push({
        id,
        companyId: company,
        kind: "GOOD",
        mainCode,
        name,
        unitPrice: "10.00",
        stockTracked: true,
        status: "ACTIVE",
        searchName: searchKey(name),
        searchMainCode: searchKey(mainCode),
        createdBy: user,
        updatedBy: user,
      });
      taxes.push({ productId: id, companyId: company, catalogType: "iva-rate", entryKey: "4" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.product.createMany({ data: products });
      await tx.productTax.createMany({ data: taxes });
    });
  }

  // El snapshot real de una factura de tres líneas: el tamaño y la forma que leen las proyecciones.
  const template = invoiceSnapshot(
    [1, 2, 3].map((n) => ({ productId: `bench-prod-${n}`, quantity: "2", unitPrice: "12.50" })),
  );
  const replica = (tx: Prisma.TransactionClient) =>
    tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
  type DocumentType = keyof typeof DOCUMENTS;
  const insertDocuments = async (
    documentType: DocumentType,
    environment: "PRODUCTION" | "TEST",
    count: number,
  ) => {
    const prefix = `bench-doc-${documentType}-${environment[0]}`;
    for (let from = 1; from <= count; from += BATCH) {
      const to = Math.min(count, from + BATCH - 1);
      await prisma.$transaction(
        async (tx) => {
          await replica(tx);
          await tx.$executeRawUnsafe(
            `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
             SELECT '${prefix}-res-' || g, $1, '${environment}', CASE WHEN g % 2 = 0 THEN $2 ELSE $4 END,
                    CASE WHEN g % 2 = 0 THEN $3 ELSE $5 END, '${documentType}', g, now(), $6, 'bench-seed'
             FROM generate_series(${from}, ${to}) g`,
            company,
            points[0]!.establishment,
            points[0]!.point,
            points[1]!.establishment,
            points[1]!.point,
            user,
          );
          // Importes por fila: base, IVA del 15 %, ICE en una de cada diez y su total.
          const amounts = `(((g % 500) + 1) * 1.25)::numeric(14,2)`;
          await tx.$executeRawUnsafe(
            `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, attempt_count, authorization_number, authorization_date, authorization_environment)
             SELECT '${prefix}-' || g, $1, '${documentType}', '${environment}', r.establishment_id, r.emission_point_id,
                    CASE WHEN g % 2 = 0 THEN '001' ELSE '002' END || '-001-' || lpad(g::text, 9, '0'), g, r.id,
                    k.access_key, '12345678',
                    date '${LAST_DAY}' - (g % ${DAYS}),
                    k.state,
                    CASE '${documentType}'
                      WHEN '06' THEN '{}'::jsonb
                      WHEN '07' THEN jsonb_build_object('supports', jsonb_build_array(
                        jsonb_build_object('position', 1, 'withholdings', jsonb_build_array(
                          jsonb_build_object('position', 1, 'taxLabel', 'RENTA'),
                          jsonb_build_object('position', 2, 'taxLabel', 'IVA'))),
                        jsonb_build_object('position', 2, 'withholdings', jsonb_build_array(
                          jsonb_build_object('position', 1, 'taxLabel', 'RENTA')))))
                      WHEN '05' THEN $2::jsonb || jsonb_build_object(
                        'taxes', jsonb_build_array(jsonb_build_object('taxCode', '2', 'rateCode', '4', 'percentage', '15',
                          'base', a.base::text, 'amount', a.vat::text)),
                        'totals', jsonb_build_object('withoutTaxes', a.base::text, 'total', (a.base + a.vat)::text))
                      ELSE $2::jsonb || jsonb_build_object('totals', jsonb_build_object(
                        'withoutTaxes', a.base::text, 'discount', '0.00',
                        'taxes', jsonb_build_array(jsonb_build_object('taxCode', '2', 'rateCode', '4', 'percentage', '15',
                          'base', a.base::text, 'amount', a.vat::text))
                          || CASE WHEN g % 10 = 0 AND '${documentType}' = '01' THEN jsonb_build_array(jsonb_build_object(
                            'taxCode', '3', 'rateCode', '3011', 'percentage', '0', 'base', a.base::text, 'amount', '2.00'))
                            ELSE '[]'::jsonb END,
                        'total', (a.base + a.vat + CASE WHEN g % 10 = 0 AND '${documentType}' = '01' THEN 2 ELSE 0 END)::text))
                    END,
                    '1.1.0',
                    CASE WHEN '${documentType}' = '06' THEN NULL ELSE p.identification END,
                    CASE WHEN '${documentType}' = '06' THEN NULL ELSE p.legal_name END,
                    CASE '${documentType}'
                      WHEN '06' THEN NULL
                      WHEN '07' THEN 13.88
                      WHEN '05' THEN a.base + a.vat
                      ELSE a.base + a.vat + CASE WHEN g % 10 = 0 AND '${documentType}' = '01' THEN 2 ELSE 0 END
                    END,
                    (date '${LAST_DAY}' - (g % ${DAYS})) + (g % 86400) * interval '1 second', $3, now(), 1,
                    CASE WHEN k.state = 'AUTHORIZED' THEN k.access_key END,
                    CASE WHEN k.state = 'AUTHORIZED' THEN now() END,
                    CASE WHEN k.state = 'AUTHORIZED' THEN '${environment}' END
             FROM generate_series(${from}, ${to}) g
             JOIN ${t("fiscal_sequence_reservation")} r ON r.id = '${prefix}-res-' || g
             JOIN ${t("party")} p ON p.id = 'bench-party-' || (1 + g % ${PARTIES})
             CROSS JOIN LATERAL (SELECT ${amounts} AS base, round(${amounts} * 0.15, 2) AS vat) a
             CROSS JOIN LATERAL (SELECT
               '${documentType}${environment === "PRODUCTION" ? "2" : "1"}' || lpad(g::text, 46, '0') AS access_key,
               CASE WHEN g % 20 = 0 THEN 'NOT_AUTHORIZED' WHEN g % 25 = 0 THEN 'RETURNED' ELSE 'AUTHORIZED' END AS state) k`,
            company,
            JSON.stringify(template),
            user,
          );
          if (documentType === "06") {
            await tx.$executeRawUnsafe(
              `INSERT INTO ${t("electronic_document_recipient")} (company_id, document_id, position, identification, name)
               SELECT $1, '${prefix}-' || g, k, '09' || lpad((g * 3 + k)::text, 8, '0'), 'Destinatario ' || k || ' de la guía ' || g
               FROM generate_series(${from}, ${to}) g
               CROSS JOIN LATERAL generate_series(1, CASE WHEN g % 4 = 0 THEN 3 ELSE 1 END) k`,
              company,
            );
          }
          if (documentType === "07") {
            await tx.$executeRawUnsafe(
              `INSERT INTO ${t("withholding_receipt")} (company_id, document_id, party_id, related_party, fiscal_period, created_at)
               SELECT $1, '${prefix}-' || g, 'bench-party-' || (1 + g % ${PARTIES}), 'NO',
                      to_char(date '${LAST_DAY}' - (g % ${DAYS}) - 15, 'MM/YYYY'), now()
               FROM generate_series(${from}, ${to}) g`,
              company,
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO ${t("withholding_receipt_line")} (company_id, document_id, support_position, position, support_document_type, support_code, support_number, support_issue_date, tax, withholding_code, entry_key, base, percentage, amount)
               SELECT $1, '${prefix}-' || g, l.support, l.position, '01', '01', '001001' || lpad(g::text, 9, '0'),
                      date '${LAST_DAY}' - (g % ${DAYS}) - 20, l.tax, l.code, l.tax || '-' || l.code, l.base, l.percentage, l.amount
               FROM generate_series(${from}, ${to}) g
               CROSS JOIN (VALUES (1, 1, '1', '303', 100.00, 10, 10.00), (1, 2, '2', '725', 10.00, 30, 3.00),
                                  (2, 1, '1', '312', 50.00, 1.75, 0.88)) l(support, position, tax, code, base, percentage, amount)`,
              company,
            );
          }
        },
        { timeout: 600_000, maxWait: 10_000 },
      );
    }
  };
  for (const documentType of Object.keys(DOCUMENTS) as DocumentType[]) {
    await insertDocuments(documentType, "PRODUCTION", DOCUMENTS[documentType]);
  }
  await insertDocuments("01", "TEST", TEST_INVOICES);

  // Kárdex: por producto, un saldo inicial y movimientos de entrada, salida por factura y ajuste.
  await prisma.$transaction(
    async (tx) => {
      await replica(tx);
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("stock_movement")} (id, company_id, product_id, position, movement_type, delta, balance_after, document_id, document_number, origin, actor_user_id, reason, idempotency_operation, idempotency_key, request_hash, occurred_at)
         SELECT 'bench-mov-' || p || '-' || k, $1, 'bench-prod-' || p, k, m.type, m.delta,
                sum(m.delta) OVER (PARTITION BY p ORDER BY k), m.document_id, m.document_number,
                CASE WHEN m.type = 'SALIDA_FACTURA' THEN 'SYSTEM' ELSE 'USER' END,
                CASE WHEN m.type = 'SALIDA_FACTURA' THEN NULL ELSE $2 END,
                CASE WHEN m.type = 'AJUSTE' THEN 'Conteo físico' END,
                CASE m.type WHEN 'ENTRADA_MANUAL' THEN 'inventory.entry' WHEN 'AJUSTE' THEN 'inventory.adjust' END,
                CASE WHEN m.type IN ('ENTRADA_MANUAL', 'AJUSTE') THEN 'bench-' || p || '-' || k END,
                CASE WHEN m.type IN ('ENTRADA_MANUAL', 'AJUSTE') THEN repeat('a', 64) END,
                timestamptz '${FIRST_DAY} 08:00:00-05' + ((k * ${DAYS} / ${MOVEMENTS_PER_PRODUCT}) * interval '1 day') + (p % 600) * interval '1 minute'
         FROM generate_series(1, ${PRODUCTS}) p
         CROSS JOIN generate_series(1, ${MOVEMENTS_PER_PRODUCT}) k
         CROSS JOIN LATERAL (SELECT
           CASE WHEN k = 1 THEN 'INICIAL' WHEN k % 3 = 0 THEN 'SALIDA_FACTURA' WHEN k % 3 = 1 THEN 'ENTRADA_MANUAL' ELSE 'AJUSTE' END AS type,
           CASE WHEN k = 1 THEN 100 WHEN k % 3 = 0 THEN -2 WHEN k % 3 = 1 THEN 5 ELSE -1 END::numeric AS delta,
           CASE WHEN k > 1 AND k % 3 = 0 THEN 'bench-doc-01-P-' || ((p * ${MOVEMENTS_PER_PRODUCT} + k) % ${DOCUMENTS["01"]} + 1) END AS document_id,
           CASE WHEN k > 1 AND k % 3 = 0 THEN '001-001-' || lpad(((p * ${MOVEMENTS_PER_PRODUCT} + k) % ${DOCUMENTS["01"]} + 1)::text, 9, '0') END AS document_number) m`,
        company,
        user,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("stock_balance")} (company_id, product_id, balance, last_position, initialized_at, initialized_by, updated_at)
         SELECT $1, product_id, balance_after, position, now(), $2, now()
         FROM ${t("stock_movement")} WHERE company_id = $1 AND position = ${MOVEMENTS_PER_PRODUCT}`,
        company,
        user,
      );
    },
    { timeout: 600_000, maxWait: 10_000 },
  );

  for (const table of [
    "party",
    "product",
    "product_tax",
    "fiscal_sequence_reservation",
    "electronic_document",
    "electronic_document_recipient",
    "withholding_receipt",
    "withholding_receipt_line",
    "stock_movement",
    "stock_balance",
  ]) {
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) ${t(table)}`);
  }
  await prisma.$executeRawUnsafe("CHECKPOINT");
}
