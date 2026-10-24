// Logo de EmiteYa (add-brand-logo): el dibujo recortado de `public/brand/`, sin optimizar porque ya
// es un WebP liviano. Es decorativo: va siempre junto al nombre EmiteYa, que da el nombre accesible.
// El archivo original, con su margen, queda en `public/brand/logo-emiteyaec.webp`; los iconos del
// navegador salen de él (`src/app/favicon.ico`, `icon.png` y `apple-icon.png`).
import Image from "next/image";
import { cn } from "@/lib/utils";

export const BRAND_MARK_SRC = "/brand/logo-emiteyaec-mark.webp";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image
      src={BRAND_MARK_SRC}
      alt=""
      width={325}
      height={253}
      unoptimized
      priority
      data-slot="brand-logo"
      className={cn("h-8 w-auto shrink-0 object-contain", className)}
    />
  );
}
