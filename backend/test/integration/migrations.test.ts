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

  it("no limita el número de empresas con ninguna restricción", async () => {
    const organizationConstraints = await db.database.prisma.$queryRaw<{ name: string }[]>`
      SELECT c.conname AS name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${db.name} AND t.relname = 'organization' AND c.contype NOT IN ('p')`;
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
