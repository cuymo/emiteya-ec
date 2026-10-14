// Contenido de la paleta de comandos, cargado bajo demanda (adopt-premium-design-foundation-and-shell,
// design D13 y D26). Destinos y acciones de creación del modelo de rutas, filtrados por el rol y
// buscables por su nombre o sus sinónimos; sin ninguna consulta al servidor mientras se escribe.
// Declara su alcance: busca pantallas y acciones, no comprobantes, terceros ni productos. Elegir uno
// navega y cierra la paleta.
"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/components/session";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { paletteFilter } from "@/lib/navigation/palette-filter";
import {
  MI_CUENTA,
  permissionsOf,
  visibleCreateActions,
  visibleGroups,
} from "@/lib/navigation/routes";

export default function CommandPaletteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { me } = useSession();
  const router = useRouter();
  const can = permissionsOf(me.role);
  const destinations = [
    ...visibleGroups(can).flatMap((group) =>
      group.destinations.map((destination) => ({ destination, group: group.label })),
    ),
    { destination: MI_CUENTA, group: "Cuenta" },
  ];
  const actions = visibleCreateActions(can);
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paleta de comandos"
      description="Busca una pantalla o una acción de creación. No busca comprobantes, terceros ni productos."
    >
      {/* `label` da nombre al campo (cmdk lo enlaza con aria-labelledby) y a la lista, que si no se
          anuncian sin nombre y en inglés. */}
      <Command filter={paletteFilter} loop label="Buscar pantalla o acción">
        <CommandInput
          placeholder="Buscar pantalla o acción…"
          aria-label="Buscar pantalla o acción"
        />
        <CommandList label="Pantallas y acciones">
          <CommandEmpty>
            <p>No encontramos una pantalla o acción con ese término.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Para buscar comprobantes, terceros o productos, usa la búsqueda de su pantalla.
            </p>
          </CommandEmpty>
          <CommandGroup heading="Ir a">
            {destinations.map(({ destination, group }) => {
              const Icon = destination.icon;
              return (
                <CommandItem
                  key={destination.href}
                  value={destination.label}
                  keywords={[group, ...(destination.keywords ?? [])]}
                  onSelect={() => go(destination.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{destination.label}</span>
                  {group !== destination.label && (
                    <span className="ml-auto text-xs text-muted-foreground">{group}</span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
          {actions.length > 0 && (
            <CommandGroup heading="Crear">
              {actions.map(({ id, label, href, icon: Icon }) => (
                <CommandItem key={id} value={label} onSelect={() => go(href)}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
