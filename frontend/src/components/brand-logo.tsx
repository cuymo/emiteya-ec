// Logo de EmiteYa (add-brand-logo): el dibujo recortado de `public/brand/`, sin optimizar porque ya
// es un WebP liviano. Es decorativo: va siempre junto al nombre EmiteYa, que da el nombre accesible.
// El archivo original, con su margen, queda en `public/brand/logo-emiteyaec.webp`; los iconos del
// navegador salen de él (`public/favicon.ico`, `icon.png` y `apple-icon.png`). Es un `<img>` simple:
// `next/image` escribe `style="color:transparent"` en el HTML del servidor, que la CSP bloquea
// (`style-src-attr 'none'`) en las pantallas sin sesión.
import { cn } from "@/lib/utils";

export const BRAND_MARK_SRC = "/brand/logo-emiteyaec-mark.webp";

export function BrandLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- next/image agrega un estilo en línea.
    <img
      src={BRAND_MARK_SRC}
      alt=""
      width={325}
      height={253}
      decoding="async"
      data-slot="brand-logo"
      className={cn("h-8 w-auto shrink-0 object-contain", className)}
    />
  );
}
