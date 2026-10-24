// Avatar propio (redesign-account-profile, design D8 y D8b): la foto del usuario, o sus iniciales
// mientras carga, si falla o si no tiene. Decorativo: el nombre visible a su lado da el accesible.
"use client";

import { Avatar, AvatarFallback, AvatarImage, initials } from "@/components/ui/avatar";
import { avatarSrc } from "./profile-api";

export function UserAvatar({
  name,
  version,
  size = "default",
  className,
}: {
  name: string;
  /** La versión del avatar del perfil, o null sin foto. */
  version: string | null | undefined;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className} data-has-photo={version ? "true" : "false"}>
      {version ? <AvatarImage src={avatarSrc(version)} /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
