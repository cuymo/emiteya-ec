// Cabecera del perfil en Mi cuenta (redesign-account-profile, design D8, con el ajuste del propietario
// del 2026-10-24): el avatar al inicio con «Subir foto» o «Cambiar foto» y «Quitar foto», el nombre,
// el correo e insignias debajo con el rol, el estado, la empresa y la antigüedad. La foto se reduce
// en el navegador antes de subirla; los rechazos del servidor van junto al control. Quitarla es
// reversible: sin confirmación.
"use client";

import type { OwnProfile } from "@facturador/contracts";
import {
  Building2,
  CalendarDays,
  CircleCheck,
  ImageUp,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { errorMessage } from "@/components/feedback";
import { fileProblem, formatSize } from "@/components/file-field";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompanyStatus } from "@/features/company/company-api";
import { ROLE_LABELS } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  AVATAR_ACCEPT,
  AVATAR_ACCEPT_LABEL,
  shrinkAvatar,
  useOwnProfile,
  useRemoveAvatar,
  useReplaceAvatar,
} from "./profile-api";
import { UserAvatar } from "./user-avatar";

const MONTH_YEAR = new Intl.DateTimeFormat("es-EC", {
  month: "long",
  year: "numeric",
  timeZone: "America/Guayaquil",
});

/** «Cuenta desde octubre de 2026». */
export const memberSinceLabel = (iso: string) => `Cuenta desde ${MONTH_YEAR.format(new Date(iso))}`;

/** Insignias de la cuenta, debajo del nombre: rol, estado, empresa y antigüedad. */
function AccountBadges({ profile }: { profile: OwnProfile }) {
  const company = useCompanyStatus().data?.displayName;
  return (
    <ul aria-label="Datos de la cuenta" className="flex flex-wrap gap-2">
      <li>
        <Badge variant="info">
          <ShieldCheck aria-hidden="true" />
          {ROLE_LABELS[profile.role]}
        </Badge>
      </li>
      <li>
        <Badge variant={profile.membershipStatus === "ACTIVE" ? "success" : "warning"}>
          <CircleCheck aria-hidden="true" />
          {profile.membershipStatus === "ACTIVE" ? "Activa" : "Desactivada"}
        </Badge>
      </li>
      {company && (
        <li>
          <Badge variant="neutral">
            <Building2 aria-hidden="true" />
            {company}
          </Badge>
        </li>
      )}
      <li>
        <Badge variant="neutral">
          <CalendarDays aria-hidden="true" />
          {memberSinceLabel(profile.memberSince)}
        </Badge>
      </li>
    </ul>
  );
}

export function ProfileHeader() {
  const { me } = useSession();
  const profile = useOwnProfile();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const replace = useReplaceAvatar({
    onError: (cause) => {
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 413)) {
        setProblem(cause.message);
        return true;
      }
      return false;
    },
  });
  const remove = useRemoveAvatar();
  const [preparing, setPreparing] = useState(false);
  const pending = preparing || replace.isPending || remove.isPending;

  async function choose(file: File | undefined) {
    const data = profile.data;
    if (!file || !data) return;
    // El tipo se revisa antes de reducir; el tamaño, después, porque la reducción lo baja.
    const typeProblem = fileProblem(file, {
      accept: AVATAR_ACCEPT,
      acceptLabel: AVATAR_ACCEPT_LABEL,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    if (typeProblem) {
      setProblem(typeProblem);
      return;
    }
    setPreparing(true);
    const image = await shrinkAvatar(file);
    setPreparing(false);
    if (image.size > data.avatarMaxBytes) {
      setProblem(`La foto supera el límite de ${formatSize(data.avatarMaxBytes)}.`);
      return;
    }
    setProblem(null);
    replace.mutate(image);
  }

  if (profile.isPending) {
    return (
      <div data-slot="profile-header" className="flex items-center gap-5">
        <Skeleton className="size-24 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <h1 id="cuenta-titulo" className="text-2xl font-bold">
            {me.name}
          </h1>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-6 w-72" />
        </div>
      </div>
    );
  }
  if (profile.isError) {
    return (
      <div data-slot="profile-header" className="flex flex-col gap-3">
        <h1 id="cuenta-titulo" className="text-2xl font-bold">
          {me.name}
        </h1>
        <ErrorState message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
      </div>
    );
  }
  const photo = profile.data.avatar;
  return (
    <div data-slot="profile-header" className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <UserAvatar
        name={profile.data.name}
        version={photo?.version}
        className="size-24 shrink-0 [&_[data-slot=avatar-fallback]]:text-3xl"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 id="cuenta-titulo" className="text-2xl font-bold break-words">
            {profile.data.name}
          </h1>
          <p className="text-sm break-words text-foreground-muted">{profile.data.email}</p>
        </div>
        <AccountBadges profile={profile.data} />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              aria-describedby={problem ? "foto-error" : "foto-ayuda"}
              onClick={() => input.current?.click()}
            >
              {preparing || replace.isPending ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <ImageUp aria-hidden="true" />
              )}
              {photo ? "Cambiar foto" : "Subir foto"}
            </Button>
            {photo && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setProblem(null);
                  remove.mutate();
                }}
              >
                <Trash2 aria-hidden="true" />
                Quitar foto
              </Button>
            )}
          </div>
          <p id="foto-ayuda" className="text-xs text-foreground-muted">
            {AVATAR_ACCEPT_LABEL}, hasta {formatSize(profile.data.avatarMaxBytes)}. Solo la ves tú,
            en tu cuenta y en tu menú.
          </p>
          {problem && (
            <p id="foto-error" role="alert" className="text-xs text-danger">
              {problem}
            </p>
          )}
        </div>
        <input
          ref={input}
          id="foto-archivo"
          type="file"
          accept={AVATAR_ACCEPT.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Foto de perfil"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
