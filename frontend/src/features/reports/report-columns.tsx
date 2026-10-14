// Columnas y tarjetas de cada reporte en la pantalla (add-reports-export, design D16): las mismas
// filas que la API y el XLSX, presentadas para leer. Los importes nunca pasan por `number`; la guía
// no tiene importes ("—", nunca 0.00) y con varios destinatarios muestra su cantidad.
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  DOCUMENT_TYPE_LABELS,
  PARTY_ROLE_LABELS,
  RECORD_STATUS_LABELS,
  REPORT_ENVIRONMENT_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  type InventoryBalanceRow,
  type InventoryMovementRow,
  type InvoiceRow,
  type IssuedDocumentRow,
  type PartyRow,
  type ReportId,
  type WithholdingRow,
} from "@facturador/contracts";
import type { ReactNode } from "react";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";
import { BalanceCell } from "@/features/inventory/inventory-screen";
import { formatDateTime, formatIssueDate } from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/invoices/invoices-screen";
import { formatPeriod } from "@/features/withholding-receipts/withholding-format";

type Row = Record<string, unknown>;

/** Un importe a la derecha; sin importe, "—" con su lectura para lectores de pantalla. */
export function Amount({ value }: { value: string | null }) {
  return value === null ? (
    <span className="block text-right text-foreground-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Sin importe</span>
    </span>
  ) : (
    <span className="block text-right whitespace-nowrap tabular-nums">{formatUsd(value)}</span>
  );
}

const right = (label: string) => () => <span className="block text-right">{label}</span>;

function Person({ name, identification }: { name: string; identification: string | null }) {
  return (
    <span className="flex flex-col">
      <span className="break-words">{name}</span>
      {identification ? (
        <span className="text-xs text-foreground-muted tabular-nums">{identification}</span>
      ) : null}
    </span>
  );
}

const counterpartOf = (row: IssuedDocumentRow) =>
  row.counterpart ?? { name: `${row.recipientCount} destinatarios`, identification: null };

const environmentLabel = (environment: keyof typeof REPORT_ENVIRONMENT_LABELS) =>
  REPORT_ENVIRONMENT_LABELS[environment];

const balanceOf = (value: string) => ({ balance: value, negative: value.startsWith("-") });

type Presentation<R> = Readonly<{
  rowId: (row: R) => string;
  columns: ColumnDef<R, unknown>[];
  card: (row: R) => ReactNode;
}>;

const issuedDocuments: Presentation<IssuedDocumentRow> = {
  rowId: (row) => row.id,
  columns: [
    {
      id: "number",
      header: "Número",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium whitespace-nowrap tabular-nums">{row.original.number}</span>
          <span className="text-xs text-foreground-muted">
            {DOCUMENT_TYPE_LABELS[row.original.documentType]}
          </span>
        </span>
      ),
    },
    {
      id: "date",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatIssueDate(row.original.issueDate)}</span>
      ),
    },
    {
      id: "counterpart",
      header: "Tercero",
      cell: ({ row }) => <Person {...counterpartOf(row.original)} />,
    },
    {
      id: "subtotal",
      header: right("Subtotal"),
      cell: ({ row }) => <Amount value={row.original.subtotal} />,
    },
    {
      id: "taxes",
      header: right("Impuestos"),
      cell: ({ row }) => <Amount value={row.original.taxes} />,
    },
    {
      id: "total",
      header: right("Total"),
      cell: ({ row }) => <Amount value={row.original.total} />,
    },
    { id: "state", header: "Estado", cell: ({ row }) => <StateCell state={row.original.state} /> },
    {
      id: "environment",
      header: "Ambiente",
      cell: ({ row }) => environmentLabel(row.original.environment),
    },
  ],
  card: (row) => (
    <div className="flex flex-col gap-2">
      <span className="flex flex-col">
        <span className="font-medium whitespace-nowrap tabular-nums">{row.number}</span>
        <span className="text-xs text-foreground-muted">
          {DOCUMENT_TYPE_LABELS[row.documentType]} · {formatIssueDate(row.issueDate)} ·{" "}
          {environmentLabel(row.environment)}
        </span>
      </span>
      <Person {...counterpartOf(row)} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
        <dt className="text-foreground-muted">Subtotal</dt>
        <dd>
          <Amount value={row.subtotal} />
        </dd>
        <dt className="text-foreground-muted">Impuestos</dt>
        <dd>
          <Amount value={row.taxes} />
        </dd>
        <dt className="text-foreground-muted">Total</dt>
        <dd>
          <Amount value={row.total} />
        </dd>
      </dl>
      <StateCell state={row.state} />
    </div>
  ),
};

const invoices: Presentation<InvoiceRow> = {
  rowId: (row) => row.id,
  columns: [
    {
      id: "number",
      header: "Número",
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap tabular-nums">{row.original.number}</span>
      ),
    },
    {
      id: "date",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatIssueDate(row.original.issueDate)}</span>
      ),
    },
    { id: "customer", header: "Cliente", cell: ({ row }) => <Person {...row.original.customer} /> },
    {
      id: "subtotal",
      header: right("Subtotal"),
      cell: ({ row }) => <Amount value={row.original.subtotal} />,
    },
    { id: "vat", header: right("IVA"), cell: ({ row }) => <Amount value={row.original.vat} /> },
    {
      id: "otherTaxes",
      header: right("Otros impuestos"),
      cell: ({ row }) => <Amount value={row.original.otherTaxes} />,
    },
    {
      id: "total",
      header: right("Total"),
      cell: ({ row }) => <Amount value={row.original.total} />,
    },
    { id: "state", header: "Estado", cell: ({ row }) => <StateCell state={row.original.state} /> },
    {
      id: "environment",
      header: "Ambiente",
      cell: ({ row }) => environmentLabel(row.original.environment),
    },
  ],
  card: (row) => (
    <div className="flex flex-col gap-2">
      <span className="flex flex-col">
        <span className="font-medium whitespace-nowrap tabular-nums">{row.number}</span>
        <span className="text-xs text-foreground-muted">
          {formatIssueDate(row.issueDate)} · {environmentLabel(row.environment)}
        </span>
      </span>
      <Person {...row.customer} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
        <dt className="text-foreground-muted">Subtotal</dt>
        <dd>
          <Amount value={row.subtotal} />
        </dd>
        <dt className="text-foreground-muted">IVA</dt>
        <dd>
          <Amount value={row.vat} />
        </dd>
        <dt className="text-foreground-muted">Otros impuestos</dt>
        <dd>
          <Amount value={row.otherTaxes} />
        </dd>
        <dt className="text-foreground-muted">Total</dt>
        <dd>
          <Amount value={row.total} />
        </dd>
      </dl>
      <StateCell state={row.state} />
    </div>
  ),
};

const withholdings: Presentation<WithholdingRow> = {
  rowId: (row) => `${row.documentId}:${row.supportPosition}:${row.position}`,
  columns: [
    {
      id: "number",
      header: "Número",
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap tabular-nums">{row.original.number}</span>
      ),
    },
    {
      id: "date",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatIssueDate(row.original.issueDate)}</span>
      ),
    },
    {
      id: "supplier",
      header: "Sujeto retenido",
      cell: ({ row }) => <Person {...row.original.supplier} />,
    },
    {
      id: "period",
      header: "Período fiscal",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatPeriod(row.original.fiscalPeriod)}</span>
      ),
    },
    {
      id: "tax",
      header: "Impuesto",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span>{row.original.taxLabel}</span>
          <span className="text-xs text-foreground-muted tabular-nums">{row.original.code}</span>
        </span>
      ),
    },
    { id: "base", header: right("Base"), cell: ({ row }) => <Amount value={row.original.base} /> },
    {
      id: "percentage",
      header: right("Porcentaje"),
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {formatPercentage(row.original.percentage)}
        </span>
      ),
    },
    {
      id: "amount",
      header: right("Valor retenido"),
      cell: ({ row }) => <Amount value={row.original.amount} />,
    },
    { id: "state", header: "Estado", cell: ({ row }) => <StateCell state={row.original.state} /> },
    {
      id: "environment",
      header: "Ambiente",
      cell: ({ row }) => environmentLabel(row.original.environment),
    },
  ],
  card: (row) => (
    <div className="flex flex-col gap-2">
      <span className="flex flex-col">
        <span className="font-medium whitespace-nowrap tabular-nums">{row.number}</span>
        <span className="text-xs text-foreground-muted">
          {formatIssueDate(row.issueDate)} · Período {formatPeriod(row.fiscalPeriod)} ·{" "}
          {environmentLabel(row.environment)}
        </span>
      </span>
      <Person {...row.supplier} />
      <span className="text-sm">
        {row.taxLabel} {row.code} · {formatPercentage(row.percentage)}
      </span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
        <dt className="text-foreground-muted">Base</dt>
        <dd>
          <Amount value={row.base} />
        </dd>
        <dt className="text-foreground-muted">Valor retenido</dt>
        <dd>
          <Amount value={row.amount} />
        </dd>
      </dl>
      <StateCell state={row.state} />
    </div>
  ),
};

const balances: Presentation<InventoryBalanceRow> = {
  rowId: (row) => row.productId,
  columns: [
    {
      id: "code",
      header: "Código",
      cell: ({ row }) => <span className="tabular-nums">{row.original.code}</span>,
    },
    {
      id: "name",
      header: "Producto",
      cell: ({ row }) => <span className="break-words">{row.original.name}</span>,
    },
    {
      id: "balance",
      header: right("Saldo"),
      cell: ({ row }) => (
        <span className="block text-right">
          <BalanceCell item={balanceOf(row.original.balance)} wrap={false} />
        </span>
      ),
    },
  ],
  card: (row) => (
    <div className="flex flex-col gap-2">
      <span className="break-words font-medium">{row.name}</span>
      {row.code ? (
        <span className="text-xs text-foreground-muted tabular-nums">{row.code}</span>
      ) : null}
      <span className="text-sm">
        Saldo: <BalanceCell item={balanceOf(row.balance)} />
      </span>
    </div>
  ),
};

const movements: Presentation<InventoryMovementRow> = {
  rowId: (row) => row.id,
  columns: [
    {
      id: "occurredAt",
      header: "Fecha y hora",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatDateTime(row.original.occurredAt)}</span>
      ),
    },
    {
      id: "product",
      header: "Producto",
      cell: ({ row }) => (
        <Person name={row.original.name} identification={row.original.code || null} />
      ),
    },
    {
      id: "type",
      header: "Tipo",
      cell: ({ row }) => STOCK_MOVEMENT_TYPE_LABELS[row.original.movementType],
    },
    {
      id: "quantity",
      header: right("Cantidad"),
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {formatDecimal(row.original.quantity)}
        </span>
      ),
    },
    {
      id: "balanceAfter",
      header: right("Saldo resultante"),
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {formatDecimal(row.original.balanceAfter)}
        </span>
      ),
    },
    {
      id: "document",
      header: "Comprobante",
      cell: ({ row }) => <span className="tabular-nums">{row.original.documentNumber ?? ""}</span>,
    },
  ],
  card: (row) => (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap justify-between gap-2">
        <span className="font-medium">{STOCK_MOVEMENT_TYPE_LABELS[row.movementType]}</span>
        <span className="text-sm text-foreground-muted tabular-nums">
          {formatDateTime(row.occurredAt)}
        </span>
      </span>
      <Person name={row.name} identification={row.code || null} />
      <span className="text-sm tabular-nums">
        Cantidad {formatDecimal(row.quantity)} · Saldo {formatDecimal(row.balanceAfter)}
      </span>
      {row.documentNumber ? (
        <span className="text-sm text-foreground-muted tabular-nums">{row.documentNumber}</span>
      ) : null}
    </div>
  ),
};

const rolesOf = (row: PartyRow) => row.roles.map((role) => PARTY_ROLE_LABELS[role]).join(", ");

const parties: Presentation<PartyRow> = {
  rowId: (row) => row.id,
  columns: [
    {
      id: "identification",
      header: "Identificación",
      cell: ({ row }) => <span className="tabular-nums">{row.original.identification}</span>,
    },
    {
      id: "legalName",
      header: "Razón social",
      cell: ({ row }) => <span className="break-words">{row.original.legalName}</span>,
    },
    {
      id: "email",
      header: "Correo",
      cell: ({ row }) => <span className="break-all">{row.original.email ?? ""}</span>,
    },
    {
      id: "phone",
      header: "Teléfono",
      cell: ({ row }) => <span className="tabular-nums">{row.original.phone ?? ""}</span>,
    },
    { id: "roles", header: "Roles", cell: ({ row }) => rolesOf(row.original) },
    {
      id: "status",
      header: "Estado",
      cell: ({ row }) => RECORD_STATUS_LABELS[row.original.status],
    },
  ],
  card: (row) => (
    <div className="flex flex-col gap-2">
      <Person name={row.legalName} identification={row.identification} />
      {row.email || row.phone ? (
        <span className="break-all text-sm text-foreground-muted">
          {[row.email, row.phone].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <span className="text-sm">
        {rolesOf(row) || "Sin roles"} · {RECORD_STATUS_LABELS[row.status]}
      </span>
    </div>
  ),
};

export const REPORT_PRESENTATIONS = {
  "issued-documents": issuedDocuments,
  invoices,
  withholdings,
  "inventory-balances": balances,
  "inventory-movements": movements,
  parties,
} as unknown as Record<ReportId, Presentation<Row>>;
