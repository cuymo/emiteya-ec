// Datos de Retenciones (add-withholding-receipts, design D20 y D24): las claves de caché de los
// comprobantes de retención y de sus borradores, que comparten la bandeja y las secciones del detalle.
"use client";

export const WITHHOLDINGS_KEY = ["withholding-receipts"] as const;
export const WITHHOLDING_DRAFTS_KEY = ["withholding-receipt-drafts"] as const;
