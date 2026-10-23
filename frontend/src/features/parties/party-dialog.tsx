// Alta rápida de un tercero desde un comprobante (add-parties-and-products, design D17): en un
// FormDialog, para no abandonar el borrador. Terceros registra y corrige en su propia página; los dos
// comparten el formulario de `party-form.tsx`.
"use client";

import type { PartyRole, PartyView } from "@facturador/contracts";
import { useEffect } from "react";
import { FormDialog } from "@/components/form-dialog";
import {
  PartyContactFields,
  PartyIdentificationFields,
  PartyNameField,
  PartyRolesField,
  usePartyForm,
} from "./party-form";

export function PartyDialog({
  open,
  onClose,
  onShowExisting,
  initialRoles,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Lleva al tercero que ya tiene esa identificación. */
  onShowExisting: (identification: string) => void;
  /** Roles marcados en el alta, como el de proveedor desde una retención. */
  initialRoles?: readonly PartyRole[];
  /** El tercero registrado, para el comprobante que abrió el diálogo. */
  onSaved?: (party: PartyView) => void;
}) {
  const state = usePartyForm({
    party: null,
    initialRoles,
    enabled: open,
    onSaved: (saved) => {
      onSaved?.(saved);
      onClose();
    },
  });
  const { reset } = state;
  // Cada apertura empieza de cero.
  useEffect(() => {
    if (open) reset();
    // `reset` cambia en cada render; basta con reaccionar a la apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Nuevo tercero"
      submitLabel="Registrar tercero"
      pending={state.save.isPending}
      error={state.error}
      onSubmit={state.onSubmit}
    >
      {/* Los roles primero, como en la página de Terceros (decisión del propietario, 2026-10-22). */}
      <PartyRolesField state={state} />
      <PartyIdentificationFields
        state={state}
        onShowExisting={(identification) => {
          onShowExisting(identification);
          onClose();
        }}
      />
      <PartyNameField state={state} />
      <PartyContactFields state={state} />
    </FormDialog>
  );
}
