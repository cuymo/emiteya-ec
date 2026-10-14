// Aviso de vencimiento de la firma en el shell (add-signing-certificate, design D8 y D14): para
// administradores y operadores, solo cuando la firma está por vencer, vencida o no disponible. Es
// una condición persistente, así que va como franja. Sin firma, la preparación para emitir lo dice.
"use client";

import Link from "next/link";
import { NoticeStrip } from "@/components/notice-strip";
import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { formatDate, useCertificateValidity } from "./signing-api";
import { daysPhrase } from "./signing-screen";

export function CertificateNotice() {
  const { me } = useSession();
  const validity = useCertificateValidity(canSee(me.role, "certificateValidity.read"));
  const admin = canSee(me.role, "certificate.manage");
  if (!validity.data || !validity.data.notAfter) return null;
  const { state, notAfter, daysToExpiry } = validity.data;
  const next = admin ? (
    <Link
      href="/configuracion/firma"
      className="font-medium underline underline-offset-2 max-md:inline-flex max-md:min-h-11 max-md:items-center"
    >
      Ir a Firma electrónica
    </Link>
  ) : (
    "Pide a un administrador que la renueve."
  );
  if (state === "EXPIRING") {
    return (
      <NoticeStrip tone="warning">
        La firma electrónica vence el {formatDate(notAfter)} ({daysPhrase(daysToExpiry ?? 0)}).{" "}
        {next}
      </NoticeStrip>
    );
  }
  if (state === "EXPIRED") {
    return (
      <NoticeStrip tone="danger">
        La firma electrónica venció el {formatDate(notAfter)}: no se puede emitir. {next}
      </NoticeStrip>
    );
  }
  if (state === "KEY_UNAVAILABLE") {
    return (
      <NoticeStrip tone="danger">
        La firma electrónica no está disponible: hay que volver a cargarla.{" "}
        {admin ? next : "Pide a un administrador que la vuelva a cargar."}
      </NoticeStrip>
    );
  }
  return null;
}
