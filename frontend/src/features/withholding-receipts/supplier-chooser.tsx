// Elegir el proveedor de una retención (add-withholding-receipts): lo usan «Nueva retención» sobre la
// lista y «Cambiar proveedor» en el editor.
"use client";

import type { PartyRole, PartyView, WithholdingSupplierView } from "@facturador/contracts";
import { useRef, useState } from "react";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { PartyDialog } from "@/features/parties/party-dialog";
import { WITHHOLDINGS_KEY, fetchWithholdingSuppliers } from "./withholding-receipts-api";

/** Rol con que nace un tercero creado desde la retención: constante, para no reiniciar el diálogo. */
const SUPPLIER_ROLES: readonly PartyRole[] = ["SUPPLIER"];

export type Subject = Pick<WithholdingSupplierView, "id" | "legalName" | "identification">;

/**
 * Elegir el proveedor (conjunto grande, con búsqueda) o registrar uno nuevo con el rol de proveedor.
 * El tercero nuevo vuelve elegido.
 */
export function SupplierChooser({
  open,
  onOpenChange,
  onChoose,
  onDismiss,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (subject: Subject) => void;
  /** Se cerró sin elegir ni registrar un proveedor. */
  onDismiss?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  // Elegir, registrar o volver a la lista también cierran el selector: no son abandonarlo.
  const acted = useRef(false);
  const saved = useRef(false);
  return (
    <>
      <EntityPickerDialog<WithholdingSupplierView>
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (next) acted.current = false;
          else if (!acted.current) onDismiss?.();
        }}
        title="Elegir proveedor"
        description="Proveedores activos con RUC, cédula o pasaporte."
        searchLabel="Buscar por identificación o razón social"
        searchPlaceholder="Identificación o razón social"
        queryKey={[...WITHHOLDINGS_KEY, "suppliers"]}
        fetchPage={fetchWithholdingSuppliers}
        getKey={(supplier) => supplier.id}
        getLabel={(supplier) => `${supplier.legalName}, ${supplier.identification}`}
        renderItem={(supplier) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">{supplier.legalName}</span>
            <span className="text-sm text-foreground-muted tabular-nums">
              {supplier.identification}
            </span>
          </span>
        )}
        onSelect={(subject) => {
          acted.current = true;
          onChoose(subject);
        }}
        quickOption={{
          label: "Nuevo proveedor",
          description: "Registrar un tercero con el rol de proveedor.",
          onSelect: () => {
            acted.current = true;
            saved.current = false;
            setCreating(true);
          },
        }}
        emptyTitle="No hay proveedores que coincidan"
        emptyDescription="Registra el proveedor o revisa que tenga el rol de proveedor en Clientes y proveedores."
      />
      <PartyDialog
        open={creating}
        initialRoles={SUPPLIER_ROLES}
        onClose={() => {
          setCreating(false);
          if (!saved.current) onDismiss?.();
        }}
        onShowExisting={() => {
          setCreating(false);
          acted.current = false;
          onOpenChange(true);
        }}
        onSaved={(party: PartyView) => {
          saved.current = true;
          onChoose(party);
        }}
      />
    </>
  );
}
