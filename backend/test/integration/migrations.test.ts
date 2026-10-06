import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_DIR, createMigratedSchema, runBin, type MigratedSchema } from "./database.ts";

const SCHEMA = join(BACKEND_DIR, "prisma/schema.prisma");
const CLI_CONFIG = "src/modules/identity/infrastructure/better-auth/cli.config.ts";

describe("migraciones sobre una base PostgreSQL limpia", () => {
  let db: MigratedSchema;
  const scratch = mkdtempSync(join(tmpdir(), "facturador-schema-"));

  beforeAll(async () => {
    db = await createMigratedSchema("migrations");
  });

  afterAll(async () => {
    await db.drop();
    rmSync(scratch, { recursive: true, force: true });
  });

  const constraints = async () =>
    (
      await db.database.prisma.$queryRaw<{ name: string; definition: string }[]>`
        SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = ${db.name}`
    ).map((row) => row.name);

  const indexes = async () =>
    (
      await db.database.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${db.name}`
    ).map((row) => row.indexname);

  const triggers = async () =>
    (
      await db.database.prisma.$queryRaw<{ name: string }[]>`
        SELECT t.tgname AS name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${db.name} AND NOT t.tgisinternal`
    ).map((row) => row.name);

  it("crea las restricciones propias que Prisma no expresa", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "member_role_check",
        "member_status_check",
        "audit_event_actor_type_check",
        "audit_event_actor_user_check",
        "audit_event_company_id_fkey",
        "audit_event_actor_user_id_fkey",
        "audit_event_target_user_id_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "member_organizationId_userId_key",
        "audit_event_company_id_occurred_at_idx",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining(["audit_event_append_only", "audit_event_no_truncate"]),
    );
  });

  // add-taxpayer-setup (design D13): las restricciones y triggers que Prisma no expresa.
  const TAXPAYER_CONSTRAINTS = [
    "company_config_version_version_check",
    "company_config_version_ruc_check",
    "company_config_version_provider_ruc_check",
    "company_config_version_special_taxpayer_check",
    "company_config_version_withholding_check",
    "company_config_version_environment_check",
    "company_config_version_rimpe_check",
    "company_config_version_texts_check",
    "company_config_current_version_check",
    "company_config_tax_identity_lock_check",
    "configuration_asset_kind_check",
    "configuration_asset_mime_type_check",
    "configuration_asset_size_check",
    "configuration_asset_sha256_check",
    "establishment_code_check",
    "establishment_address_check",
    "emission_point_code_check",
    "company_config_company_id_current_version_id_fkey",
    "company_config_version_company_id_logo_asset_id_fkey",
    "emission_point_company_id_establishment_id_fkey",
    "member_default_emission_point_company_id_user_id_fkey",
    "member_default_emission_point_company_id_emission_point_id_fkey",
  ];
  const TAXPAYER_TRIGGERS = [
    "company_config_version_append_only",
    "company_config_version_no_truncate",
    "configuration_asset_append_only",
    "configuration_asset_no_truncate",
    "company_config_no_delete",
    "company_config_no_truncate",
    "company_config_version_locked_ruc",
    "company_config_lock",
    "establishment_identity",
    "emission_point_identity",
  ];

  it("crea las restricciones y triggers de la configuración tributaria", async () => {
    expect(await constraints()).toEqual(expect.arrayContaining(TAXPAYER_CONSTRAINTS));
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "company_config_version_company_id_version_key",
        "configuration_asset_company_id_sha256_key",
        "establishment_company_id_code_key",
        "emission_point_establishment_id_code_key",
        "member_default_emission_point_company_id_emission_point_id_idx",
      ]),
    );
    expect(await triggers()).toEqual(expect.arrayContaining(TAXPAYER_TRIGGERS));
  });

  it("crea las restricciones y triggers de la numeración fiscal", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "fiscal_sequence_environment_check",
        "fiscal_sequence_document_type_check",
        "fiscal_sequence_next_number_check",
        "fiscal_sequence_last_reserved_check",
        "fiscal_sequence_next_above_reserved_check",
        "fiscal_sequence_reservation_sequential_check",
        "fiscal_sequence_company_id_establishment_id_emission_point_fkey",
        "fiscal_sequence_reservation_company_id_environment_establi_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "fiscal_sequence_company_id_environment_establishment_id_emi_key",
        "fiscal_sequence_reservation_company_id_environment_establis_key",
        "emission_point_company_id_establishment_id_id_key",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "fiscal_sequence_no_delete",
        "fiscal_sequence_no_truncate",
        "fiscal_sequence_reservation_append_only",
        "fiscal_sequence_reservation_no_truncate",
        "fiscal_sequence_guard",
      ]),
    );
  });

  it("crea las restricciones y triggers de la firma electrónica", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "signing_certificate_status_check",
        "signing_certificate_active_state_check",
        "signing_certificate_key_check",
        "signing_certificate_ruc_check",
        "signing_certificate_validity_check",
        "signing_certificate_fingerprint_check",
        "signing_certificate_secret_format_check",
        "signing_certificate_secret_sizes_check",
        "signing_certificate_settings_expiry_alert_days_check",
        "signing_certificate_company_id_replaced_by_id_fkey",
        "signing_certificate_secret_company_id_certificate_id_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "signing_certificate_active_company_id_key",
        "signing_certificate_company_id_id_key",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "signing_certificate_no_delete",
        "signing_certificate_no_truncate",
        "signing_certificate_guard",
        "signing_certificate_secret_no_update",
        "signing_certificate_secret_active_only",
      ]),
    );
  });

  it("crea las restricciones y triggers de los catálogos fiscales", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "fiscal_catalog_dataset_catalog_type_check",
        "fiscal_catalog_dataset_version_check",
        "fiscal_catalog_dataset_hashes_check",
        "fiscal_catalog_dataset_enablement_policy_check",
        "fiscal_catalog_key_catalog_type_check",
        "fiscal_catalog_key_entry_key_check",
        "fiscal_catalog_key_code_check",
        "fiscal_catalog_entry_basis_check",
        "fiscal_catalog_entry_status_check",
        "fiscal_catalog_entry_range_check",
        "fiscal_catalog_entry_attributes_check",
        "consumer_final_policy_values_check",
        "consumer_final_policy_basis_check",
        "consumer_final_policy_range_check",
        "schema_registry_entry_values_check",
        "special_case_support_values_check",
        "company_fiscal_catalog_setting_catalog_type_check",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "fiscal_catalog_entry_catalog_type_entry_key_effective_from_key",
        "consumer_final_policy_effective_from_key",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "fiscal_catalog_dataset_immutable",
        "fiscal_catalog_dataset_no_truncate",
        "fiscal_catalog_key_immutable",
        "fiscal_catalog_key_no_truncate",
        "fiscal_catalog_entry_no_delete",
        "fiscal_catalog_entry_no_truncate",
        "fiscal_catalog_entry_guard",
        "fiscal_catalog_entry_no_overlap",
        "consumer_final_policy_no_delete",
        "consumer_final_policy_no_truncate",
        "consumer_final_policy_guard",
        "consumer_final_policy_no_overlap",
        "schema_registry_entry_immutable",
        "schema_registry_entry_no_truncate",
        "special_case_support_immutable",
        "special_case_support_no_truncate",
      ]),
    );
  });

  it("crea las restricciones y triggers de terceros y productos", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "party_identification_check",
        "party_text_check",
        "party_status_check",
        "party_roles_check",
        "party_version_check",
        "party_system_record_check",
        "product_kind_check",
        "product_status_check",
        "product_text_check",
        "product_unit_price_check",
        "product_stock_tracked_check",
        "product_version_check",
        "product_tax_catalog_type_check",
        "product_tax_company_id_product_id_fkey",
        "product_tax_catalog_type_entry_key_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "party_company_id_identification_type_identification_key",
        "party_company_id_search_identification_idx",
        "party_company_id_status_search_name_id_idx",
        "product_company_id_main_code_key",
        "product_company_id_search_main_code_idx",
        "product_company_id_search_auxiliary_code_idx",
        "product_company_id_status_search_name_id_idx",
        "product_tax_company_id_catalog_type_entry_key_idx",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "party_system_record_guard",
        "party_no_truncate",
        "product_invariants",
        "product_tax_invariants",
        "organization_requires_consumer_final",
      ]),
    );
    // Las claves de búsqueda por prefijo usan la colación C, para LIKE 'prefijo%' (design D10).
    const collations = await db.database.prisma.$queryRaw<{ column: string; collation: string }[]>`
      SELECT a.attname AS column, co.collname AS collation
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_collation co ON co.oid = a.attcollation
      WHERE n.nspname = ${db.name} AND c.relkind = 'r'
        AND a.attname IN ('search_identification', 'search_main_code', 'search_auxiliary_code')`;
    expect(collations.map((row) => `${row.column}:${row.collation}`).sort()).toEqual([
      "search_auxiliary_code:C",
      "search_identification:C",
      "search_main_code:C",
    ]);
  });

  it("los decimales no tienen precisión ni escala fijas: su dominio lo fija un CHECK (Q-43)", async () => {
    const columns = await db.database.prisma.$queryRaw<
      { column: string; type: string; precision: number | null; scale: number | null }[]
    >`
      SELECT table_name || '.' || column_name AS column, data_type AS type,
        numeric_precision AS precision, numeric_scale AS scale
      FROM information_schema.columns
      WHERE table_schema = ${db.name} AND data_type = 'numeric'
      ORDER BY 1`;
    expect(columns).toEqual(
      [
        "consumer_final_policy.max_amount",
        // add-credit-notes, design D7 y D10: `importe`, `cantidad` y `existencia`.
        "credit_capacity.applied_total",
        "credit_capacity.original_total",
        "credit_capacity.reserved_total",
        "credit_capacity_line.applied_quantity",
        "credit_capacity_line.original_quantity",
        "credit_capacity_line.reserved_quantity",
        "credit_note_draft_line.physical_return",
        "credit_note_draft_line.quantity",
        "credit_reservation.amount",
        "credit_reservation_line.discount",
        "credit_reservation_line.physical_return",
        "credit_reservation_line.quantity",
        "credit_reservation_line.subtotal",
        "credit_reservation_line.taxable_base",
        // add-debit-notes, design D26: `importe`, positivo.
        "debit_note_draft_concept.amount",
        "electronic_document.total",
        "fiscal_catalog_entry.percentage",
        "invoice_draft_line.discount",
        "invoice_draft_line.quantity",
        "invoice_draft_payment.amount",
        "product.unit_price",
        // add-minimal-inventory, design D3: dominio `existencia`, con signo.
        "stock_balance.balance",
        "stock_movement.balance_after",
        "stock_movement.delta",
        "stock_return_capacity.applied_quantity",
        "stock_return_capacity.original_quantity",
        "stock_return_capacity.reserved_quantity",
        "stock_return_reservation.quantity",
        // add-withholding-receipts, design D13 y D28: `importe` y `porcentajeRetener`.
        "withholding_receipt_line.amount",
        "withholding_receipt_line.base",
        "withholding_receipt_line.percentage",
      ].map((column) => ({ column, type: "numeric", precision: null, scale: null })),
    );
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "product_unit_price_check",
        "fiscal_catalog_entry_percentage_check",
        "consumer_final_policy_max_amount_check",
        "invoice_draft_line_values_check",
        "invoice_draft_payment_values_check",
        "electronic_document_values_check",
        "stock_balance_values_check",
        "stock_movement_values_check",
        "credit_note_draft_line_values_check",
        "credit_capacity_values_check",
        "credit_capacity_line_values_check",
        "credit_reservation_values_check",
        "credit_reservation_line_values_check",
        "stock_return_capacity_values_check",
        "stock_return_reservation_values_check",
        "debit_note_draft_concept_values_check",
        "withholding_receipt_line_values_check",
      ]),
    );
  });

  it("crea las restricciones y triggers de la emisión de facturas", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "invoice_draft_values_check",
        "invoice_draft_company_id_emission_point_id_fkey",
        "invoice_draft_company_id_buyer_party_id_fkey",
        "invoice_draft_line_company_id_product_id_fkey",
        "invoice_draft_payment_catalog_type_entry_key_fkey",
        "electronic_document_reservation_id_fkey",
        "document_state_transition_values_check",
        "document_artifact_values_check",
        "idempotency_record_values_check",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "invoice_draft_document_id_key",
        "electronic_document_access_key_key",
        "electronic_document_reservation_id_key",
        "electronic_document_company_id_environment_establishment_id_key",
        "document_artifact_document_id_kind_key",
        "idempotency_record_pkey",
        "party_company_id_id_key",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "invoice_draft_guard",
        "invoice_draft_line_guard",
        "invoice_draft_payment_guard",
        "electronic_document_guard",
        "electronic_document_requires_artifact",
        "electronic_document_no_truncate",
        "document_state_transition_append_only",
        "document_artifact_append_only",
        "idempotency_record_append_only",
      ]),
    );
  });

  it("crea las restricciones y triggers de la transmisión al SRI", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "electronic_document_authorization_check",
        "job_values_check",
        "job_document_id_fkey",
        "sri_attempt_values_check",
        "sri_attempt_company_id_document_id_fkey",
        "sri_response_values_check",
        "sri_response_company_id_attempt_id_fkey",
        "sri_attempt_result_values_check",
        "sri_attempt_result_company_id_attempt_id_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "job_active_dedupe_key_key",
        "job_active_sri_document_id_key",
        "job_status_next_attempt_at_idx",
        "sri_attempt_document_id_attempt_number_key",
        "sri_response_pkey",
        "sri_attempt_result_pkey",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "sri_attempt_append_only",
        "sri_attempt_no_truncate",
        "sri_response_append_only",
        "sri_response_no_truncate",
        "sri_attempt_result_append_only",
        "sri_attempt_result_no_truncate",
      ]),
    );
  });

  it("crea la política de tamaño del envío al SRI con sus restricciones y triggers", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "sri_transmission_policy_values_check",
        "fiscal_catalog_dataset_catalog_type_check",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining(["sri_transmission_policy_effective_from_key"]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "sri_transmission_policy_no_delete",
        "sri_transmission_policy_no_truncate",
        "sri_transmission_policy_guard",
        "sri_transmission_policy_no_overlap",
      ]),
    );
  });

  it("crea el historial de entregas y los índices del archivo documental", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "document_artifact_values_check",
        "document_delivery_event_values_check",
        "document_delivery_event_company_id_document_id_fkey",
        "document_delivery_event_document_id_artifact_kind_fkey",
        "document_delivery_event_actor_user_id_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "document_delivery_event_pkey",
        "document_delivery_event_company_id_document_id_occurred_at_idx",
        "electronic_document_company_id_issue_date_id_idx",
        "electronic_document_company_id_buyer_identification_idx",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "document_delivery_event_append_only",
        "document_delivery_event_no_truncate",
      ]),
    );
  });

  it("crea el saldo y los movimientos del inventario con sus restricciones y triggers", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "stock_balance_values_check",
        "stock_balance_company_id_product_id_fkey",
        "stock_balance_initialized_by_fkey",
        "stock_movement_values_check",
        "stock_movement_company_id_product_id_fkey",
        "stock_movement_company_id_document_id_fkey",
        "stock_movement_actor_user_id_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "stock_balance_pkey",
        "stock_balance_company_id_balance_idx",
        "stock_movement_pkey",
        "stock_movement_company_id_product_id_position_key",
        "stock_movement_company_id_product_id_occurred_at_idx",
        "stock_movement_document_product_type_key",
        "stock_movement_idempotency_key",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "stock_movement_append_only",
        "stock_movement_no_truncate",
        "stock_movement_chain",
        "stock_movement_in_balance",
        "stock_balance_guard",
        "stock_balance_no_delete",
        "stock_balance_no_truncate",
        "stock_balance_matches_ledger",
      ]),
    );
  });

  it("crea los borradores, las capacidades y las reservas de las notas de crédito con sus restricciones y triggers", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "credit_note_draft_values_check",
        "credit_note_draft_company_id_fkey",
        "credit_note_draft_company_id_invoice_id_fkey",
        "credit_note_draft_company_id_emission_point_id_fkey",
        "credit_note_draft_company_id_document_id_fkey",
        "credit_note_draft_created_by_fkey",
        "credit_note_draft_updated_by_fkey",
        "credit_note_draft_line_values_check",
        "credit_note_draft_line_company_id_draft_id_fkey",
        "credit_capacity_values_check",
        "credit_capacity_company_id_invoice_id_fkey",
        "credit_capacity_line_values_check",
        "credit_capacity_line_company_id_invoice_id_fkey",
        "credit_capacity_line_company_id_product_id_fkey",
        "credit_reservation_values_check",
        "credit_reservation_company_id_invoice_id_fkey",
        "credit_reservation_company_id_credit_note_id_fkey",
        "credit_reservation_line_values_check",
        "credit_reservation_line_company_id_invoice_id_reservation__fkey",
        "credit_reservation_line_company_id_invoice_id_position_fkey",
        "stock_return_capacity_values_check",
        "stock_return_capacity_company_id_invoice_id_fkey",
        "stock_return_capacity_company_id_product_id_fkey",
        "stock_return_reservation_values_check",
        "stock_return_reservation_company_id_credit_note_id_fkey",
        "stock_return_reservation_company_id_invoice_id_product_id_fkey",
        "idempotency_record_values_check",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "credit_note_draft_pkey",
        "credit_note_draft_document_id_key",
        "credit_note_draft_company_id_id_key",
        "credit_note_draft_company_id_document_id_key",
        "credit_note_draft_company_id_status_updated_at_idx",
        "credit_note_draft_line_pkey",
        "credit_capacity_pkey",
        "credit_capacity_line_pkey",
        "credit_reservation_pkey",
        "credit_reservation_company_id_credit_note_id_key",
        "credit_reservation_company_id_invoice_id_id_key",
        "credit_reservation_company_id_invoice_id_status_idx",
        "credit_reservation_line_pkey",
        "stock_return_capacity_pkey",
        "stock_return_reservation_pkey",
        "stock_return_reservation_company_id_invoice_id_product_id_s_idx",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "credit_note_draft_guard",
        "credit_note_draft_line_guard",
        "credit_capacity_origin",
        "credit_capacity_guard",
        "credit_capacity_no_delete",
        "credit_capacity_no_truncate",
        "credit_capacity_line_origin",
        "credit_capacity_line_guard",
        "credit_capacity_line_no_delete",
        "credit_capacity_line_no_truncate",
        "credit_reservation_guard",
        "credit_reservation_no_delete",
        "credit_reservation_no_truncate",
        "credit_reservation_line_append_only",
        "credit_reservation_line_no_truncate",
        "stock_return_capacity_origin",
        "stock_return_capacity_guard",
        "stock_return_capacity_no_delete",
        "stock_return_capacity_no_truncate",
        "stock_return_reservation_guard",
        "stock_return_reservation_no_delete",
        "stock_return_reservation_no_truncate",
        // Triggers de restricción diferidos (design D7 y D25).
        "credit_capacity_matches_reservations",
        "credit_capacity_line_matches_reservations",
        "credit_reservation_in_capacity",
        "credit_reservation_line_in_capacity",
        "stock_return_capacity_matches_reservations",
        "stock_return_reservation_in_capacity",
        "credit_reservation_matches_note",
        "stock_return_reservation_matches_note",
        "credit_note_matches_reservations",
      ]),
    );
  });

  it("crea los borradores de nota de débito y la factura de cada nota con sus restricciones y triggers", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "debit_note_draft_values_check",
        "debit_note_draft_company_id_fkey",
        "debit_note_draft_company_id_invoice_id_fkey",
        "debit_note_draft_company_id_emission_point_id_fkey",
        "debit_note_draft_company_id_document_id_fkey",
        "debit_note_draft_created_by_fkey",
        "debit_note_draft_updated_by_fkey",
        "debit_note_draft_concept_values_check",
        "debit_note_draft_concept_company_id_draft_id_fkey",
        "debit_note_support_company_id_debit_note_id_fkey",
        "debit_note_support_company_id_invoice_id_fkey",
        "idempotency_record_values_check",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "debit_note_draft_pkey",
        "debit_note_draft_document_id_key",
        "debit_note_draft_company_id_id_key",
        "debit_note_draft_company_id_document_id_key",
        "debit_note_draft_company_id_status_updated_at_idx",
        "debit_note_draft_concept_pkey",
        "debit_note_support_pkey",
        "debit_note_support_company_id_invoice_id_idx",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "debit_note_draft_guard",
        "debit_note_draft_concept_guard",
        "debit_note_support_origin",
        "debit_note_support_immutable",
        "debit_note_support_no_truncate",
        // Trigger de restricción diferido (design D26).
        "debit_note_has_support",
      ]),
    );
  });

  it("crea los borradores, el registro y las líneas de las retenciones con sus restricciones y triggers", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "withholding_receipt_draft_values_check",
        "withholding_receipt_draft_supports_check",
        "withholding_receipt_draft_company_id_fkey",
        "withholding_receipt_draft_company_id_party_id_fkey",
        "withholding_receipt_draft_company_id_emission_point_id_fkey",
        "withholding_receipt_draft_company_id_document_id_fkey",
        "withholding_receipt_draft_created_by_fkey",
        "withholding_receipt_draft_updated_by_fkey",
        "withholding_receipt_values_check",
        "withholding_receipt_company_id_document_id_fkey",
        "withholding_receipt_company_id_party_id_fkey",
        "withholding_receipt_line_values_check",
        "withholding_receipt_line_company_id_document_id_fkey",
        "idempotency_record_values_check",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "withholding_receipt_draft_pkey",
        "withholding_receipt_draft_document_id_key",
        "withholding_receipt_draft_company_id_id_key",
        "withholding_receipt_draft_company_id_document_id_key",
        "withholding_receipt_draft_company_id_status_updated_at_idx",
        "withholding_receipt_pkey",
        "withholding_receipt_company_id_fiscal_period_idx",
        "withholding_receipt_company_id_party_id_idx",
        "withholding_receipt_line_pkey",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining([
        "withholding_receipt_draft_guard",
        "withholding_receipt_origin",
        "withholding_receipt_immutable",
        "withholding_receipt_no_truncate",
        "withholding_receipt_line_immutable",
        "withholding_receipt_line_no_truncate",
        // Trigger de restricción diferido (design D28).
        "withholding_receipt_complete",
      ]),
    );
  });

  it("no limita el número de empresas con ninguna restricción", async () => {
    // El único objeto sobre la empresa exige su consumidor final al confirmarla (trigger de
    // restricción de add-parties-and-products, design D5); no limita cuántas empresas hay.
    const organizationConstraints = await db.database.prisma.$queryRaw<{ name: string }[]>`
      SELECT c.conname AS name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${db.name} AND t.relname = 'organization' AND c.contype NOT IN ('p')
        AND NOT (c.contype = 't' AND c.conname = 'organization_requires_consumer_final')`;
    const organizationIndexes = await db.database.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${db.name} AND tablename = 'organization'`;
    expect(organizationConstraints).toEqual([]);
    expect(organizationIndexes.map((row) => row.indexname).sort()).toEqual([
      "organization_pkey",
      "organization_slug_key",
    ]);
  });

  it("las migraciones y el esquema de Prisma coinciden", () => {
    const diff = runBin(
      "prisma",
      ["migrate", "diff", "--from-config-datasource", "--to-schema", SCHEMA, "--exit-code"],
      { DATABASE_URL: db.url },
    );
    expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);
  });

  it("regenerar el esquema con el CLI de Better Auth conserva modelos y restricciones propios", () => {
    const regenerated = join(scratch, "schema.prisma");
    copyFileSync(SCHEMA, regenerated);
    const generate = runBin("auth", [
      "generate",
      "--config",
      CLI_CONFIG,
      "--output",
      regenerated,
      "-y",
    ]);
    expect(generate.status, `${generate.stdout}${generate.stderr}`).toBe(0);
    const format = runBin("prisma", ["format", "--schema", regenerated]);
    expect(format.status, `${format.stdout}${format.stderr}`).toBe(0);

    // Los modelos y relaciones de add-taxpayer-setup sobreviven a la fusión del CLI.
    expect(readFileSync(regenerated, "utf8")).toBe(readFileSync(SCHEMA, "utf8"));
    for (const model of [
      "CompanyConfig",
      "CompanyConfigVersion",
      "MemberDefaultEmissionPoint",
      "FiscalSequence",
      "FiscalSequenceReservation",
    ]) {
      expect(readFileSync(regenerated, "utf8")).toContain(`model ${model} {`);
    }
    const diff = runBin(
      "prisma",
      ["migrate", "diff", "--from-config-datasource", "--to-schema", regenerated, "--exit-code"],
      { DATABASE_URL: db.url },
    );
    expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);
  });
});
