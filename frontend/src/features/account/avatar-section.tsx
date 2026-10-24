// «Foto de perfil» en Mi cuenta (redesign-account-profile, tarea 6.2, design D8b): la foto propia o
// las iniciales, «Subir foto» o «Cambiar foto» y «Quitar foto». Hasta la página de perfil con
// pestañas, va en la «Mi cuenta» actual. La foto se reduce en el navegador antes de subirla; los
// rechazos del servidor van junto al control. Quitarla es reversible: sin confirmación.
"use client";

import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { errorMessage } from "@/components/feedback";
import { fileProblem, formatSize } from "@/components/file-field";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
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

export function AvatarSection() {
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

  let body;
  if (profile.isPending) body = <Skeleton className="size-20 rounded-full" />;
  else if (profile.isError)
    body = (
      <ErrorState message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
    );
  else {
    const photo = profile.data.avatar;
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar name={me.name} version={photo?.version} className="size-20 text-2xl" />
        <div className="flex min-w-0 flex-col gap-2">
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
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="foto-titulo" className="flex flex-col gap-3">
      <h2 id="foto-titulo" className="text-lg font-semibold">
        Foto de perfil
      </h2>
      {body}
      <input
        ref={input}
        id="foto-archivo"
        type="file"
        accept={AVATAR_ACCEPT.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-labelledby="foto-titulo"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {problem && (
        <p id="foto-error" role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </section>
  );
}
