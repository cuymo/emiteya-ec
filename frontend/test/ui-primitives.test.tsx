// Primitivos derivados de la plantilla «Studio Admin» (adopt-premium-design-foundation-and-shell,
// design D5 y D6): roles, nombres accesibles en español, teclado, devolución del foco y la escala de
// tamaños del botón, incluida la geometría de los tamaños `legacy-*` transitorios.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AsyncButton } from "@/components/async-button";
import { Avatar, AvatarFallback, initials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { resetViewport, setViewportWidth } from "./viewport";

afterEach(() => {
  resetViewport();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});

const tokens = (classes: string) => new Set(classes.split(/\s+/));

describe("Button", () => {
  it("es de tipo button por defecto y expone su variante y su tamaño", () => {
    render(<Button size="default">Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("primary");
    expect(button.getAttribute("data-size")).toBe("default");
  });

  it("aplica la escala aprobada: 36, 32 y 24 px, con 44 px en móvil", () => {
    const of = (size: Parameters<typeof buttonVariants>[0]) => tokens(buttonVariants(size));
    for (const [size, height] of [
      ["default", "h-9"],
      ["sm", "h-8"],
      ["xs", "h-6"],
    ] as const) {
      const classes = of({ size });
      expect(classes.has(height)).toBe(true);
    }
    expect(of({ size: "default" }).has("max-md:h-11")).toBe(true);
    expect(of({ size: "sm" }).has("max-md:h-11")).toBe(true);
    expect(of({ size: "icon" }).has("size-9")).toBe(true);
    expect(of({ size: "icon-sm" }).has("size-8")).toBe(true);
    expect(of({ size: "icon" }).has("max-md:size-11")).toBe(true);
    // 24 px visibles, con un área táctil de 44 px en móvil (24 + 2 × 10).
    expect(of({ size: "xs" }).has("max-md:after:-inset-2.5")).toBe(true);
  });

  it("los tamaños legacy-* conservan la geometría del botón anterior", () => {
    // Clases del botón anterior tras el paso a base 4: md, sm, icon e icon-sm, con iconos de 20 px.
    type LegacySize = "legacy-md" | "legacy-sm" | "legacy-icon" | "legacy-icon-sm";
    const previous: Record<LegacySize, string[]> = {
      "legacy-md": ["h-10", "gap-2", "px-4", "max-md:h-11", "[&_svg]:size-5"],
      "legacy-sm": ["h-8", "gap-1", "px-3", "max-md:h-11", "[&_svg]:size-5"],
      "legacy-icon": ["size-11", "[&_svg]:size-5"],
      "legacy-icon-sm": ["size-10", "[&_svg]:size-5"],
    };
    for (const size of Object.keys(previous) as LegacySize[]) {
      const classes = tokens(buttonVariants({ size }));
      for (const token of previous[size])
        expect(classes.has(token), `${size}: ${token}`).toBe(true);
    }
  });

  // productize-invoice-editor-and-composition-foundation, design D9.
  it("deshabilitado neutro por variante, sin opacidad sobre su color", () => {
    const of = (variant: Parameters<typeof buttonVariants>[0]) => tokens(buttonVariants(variant));
    for (const variant of ["primary", "secondary", "destructive"] as const) {
      const classes = of({ variant });
      for (const token of [
        "disabled:not-aria-busy:bg-muted",
        "disabled:not-aria-busy:text-muted-foreground",
        "disabled:not-aria-busy:shadow-none",
        "aria-disabled:not-aria-busy:bg-muted",
      ])
        expect(classes.has(token), `${variant}: ${token}`).toBe(true);
    }
    for (const variant of ["outline", "ghost", "link"] as const) {
      const classes = of({ variant });
      expect(classes.has("disabled:not-aria-busy:text-muted-foreground"), variant).toBe(true);
      expect(classes.has("disabled:not-aria-busy:bg-muted"), variant).toBe(false);
    }
    expect(of({ variant: "outline" }).has("disabled:not-aria-busy:border-border/60")).toBe(true);
    for (const variant of [
      "primary",
      "secondary",
      "outline",
      "ghost",
      "destructive",
      "link",
    ] as const)
      expect(
        [...of({ variant })].some((token) => token.includes("opacity-50")),
        variant,
      ).toBe(false);
  });

  it("outline es transparente en oscuro, sin el bloque gris de la plantilla", () => {
    const classes = tokens(buttonVariants({ variant: "outline" }));
    expect(classes.has("dark:bg-transparent")).toBe(true);
    expect(classes.has("dark:bg-input/30")).toBe(false);
  });

  it("AsyncButton pendiente no se atenúa: conserva su variante con el indicador", () => {
    render(
      <AsyncButton size="default" pending pendingLabel="Guardando">
        Guardar borrador
      </AsyncButton>,
    );
    // jsdom no aplica `invisible`: el nombre incluye también el texto que queda oculto.
    const button = screen.getByRole("button", { name: /Guardando/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("data-variant")).toBe("primary");
    // Toda regla de deshabilitado que cambia el aspecto excluye `aria-busy`.
    const disabledRules = button.className
      .split(/\s+/)
      .filter(
        (token) => /^(aria-)?disabled:/.test(token) && token !== "disabled:pointer-events-none",
      );
    expect(disabledRules.length).toBeGreaterThan(0);
    expect(disabledRules.every((token) => token.includes(":not-aria-busy:"))).toBe(true);
  });

  it("sin tamaño, usa el transitorio legacy-md para las pantallas aún no migradas", () => {
    render(<Button>Continuar</Button>);
    expect(screen.getByRole("button", { name: "Continuar" }).getAttribute("data-size")).toBe(
      "legacy-md",
    );
  });
});

describe("Badge", () => {
  it("lleva el color en el icono y deja el texto en foreground", () => {
    render(
      <Badge variant="warning">
        <svg aria-hidden="true" />
        Pruebas
      </Badge>,
    );
    const badge = screen.getByText("Pruebas");
    expect(badge.getAttribute("data-variant")).toBe("warning");
    expect(badge.className).toContain("text-foreground");
    expect(badge.className).toContain("[&>svg]:text-warning");
  });
});

describe("Sheet", () => {
  function ControlledSheet() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Abrir panel
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" closeLabel="Cerrar menú">
            <SheetTitle>Menú</SheetTitle>
            <SheetDescription>Navegación principal</SheetDescription>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  it("abre controlado, se cierra con Escape y devuelve el foco a quien lo abrió", async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);
    const opener = screen.getByRole("button", { name: "Abrir panel" });
    await user.click(opener);
    expect(await screen.findByRole("dialog", { name: "Menú" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cerrar menú" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("el botón de cerrar visible cierra el panel", async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);
    await user.click(screen.getByRole("button", { name: "Abrir panel" }));
    await user.click(await screen.findByRole("button", { name: "Cerrar menú" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Tooltip", () => {
  it("se muestra con el foco del teclado", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Facturas">
              F
            </button>
          </TooltipTrigger>
          <TooltipContent>Facturas</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect((await screen.findByRole("tooltip")).textContent).toContain("Facturas");
  });
});

describe("DropdownMenu", () => {
  it("se abre con el teclado, recorre con flechas y devuelve el foco al cerrarse", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Nuevo</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Nueva factura</DropdownMenuItem>
          <DropdownMenuItem>Nueva retención</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Nuevo" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(2);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Nueva retención" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Breadcrumb", () => {
  it("se nombra en español y anuncia la página actual", () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/facturas">Facturas</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Detalle de factura</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(screen.getByRole("navigation", { name: "Ruta de navegación" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Facturas" }).getAttribute("href")).toBe("/facturas");
    expect(screen.getByText("Detalle de factura").getAttribute("aria-current")).toBe("page");
  });
});

describe("CommandDialog", () => {
  it("se nombra en español, filtra lo escrito y se cierra con Escape", async () => {
    const user = userEvent.setup();
    function Palette() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Buscar
          </button>
          <CommandDialog
            open={open}
            onOpenChange={setOpen}
            title="Paleta de comandos"
            description="Busca un destino o una acción"
          >
            <Command>
              <CommandInput placeholder="Buscar destino o acción" />
              <CommandList>
                <CommandEmpty>Sin resultados.</CommandEmpty>
                <CommandGroup heading="Ir a">
                  <CommandItem>Facturas</CommandItem>
                  <CommandItem>Productos</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </CommandDialog>
        </>
      );
    }
    render(<Palette />);
    const opener = screen.getByRole("button", { name: "Buscar" });
    await user.click(opener);
    expect(await screen.findByRole("dialog", { name: "Paleta de comandos" })).toBeTruthy();
    await user.type(screen.getByRole("combobox"), "produ");
    expect(screen.getByRole("option", { name: "Productos" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Facturas" })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe("Collapsible, Separator, Avatar, Kbd, Empty y Skeleton", () => {
  it("el desplegable anuncia si está abierto", async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger>Configuración</CollapsibleTrigger>
        <CollapsibleContent>Empresa</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByRole("button", { name: "Configuración" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("los elementos decorativos quedan fuera del árbol de accesibilidad", () => {
    render(
      <>
        <Separator data-testid="separador" />
        <Avatar>
          <AvatarFallback>{initials("Ana María Admin")}</AvatarFallback>
        </Avatar>
        <Kbd>Ctrl K</Kbd>
        <Skeleton data-testid="esqueleto" />
      </>,
    );
    expect(screen.getByTestId("separador").getAttribute("role")).toBe("none");
    expect(screen.getByText("AA").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Ctrl K").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("esqueleto").getAttribute("aria-hidden")).toBe("true");
  });

  it("calcula las iniciales del nombre", () => {
    expect(initials("Ana María Admin")).toBe("AA");
    expect(initials("Óscar")).toBe("Ó");
    expect(initials("  ")).toBe("?");
  });

  it("el título del vacío puede ser el encabezado que le toca", () => {
    render(
      <Empty>
        <EmptyTitle asChild>
          <h1>Página no encontrada</h1>
        </EmptyTitle>
      </Empty>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Página no encontrada" })).toBeTruthy();
  });
});

describe("Sidebar", () => {
  function Shell() {
    return (
      <TooltipProvider>
        <SidebarProvider>
          <Sidebar>
            <SidebarContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Facturas" isActive>
                    <Link href="/facturas" aria-current="page">
                      <span>Facturas</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarContent>
          </Sidebar>
          <SidebarTrigger aria-label="Alternar la barra lateral" size="icon-sm" />
        </SidebarProvider>
      </TooltipProvider>
    );
  }

  it("en escritorio se colapsa a iconos, guarda la preferencia y responde a Ctrl+B", async () => {
    const user = userEvent.setup();
    setViewportWidth(1280);
    const { container } = render(<Shell />);
    const sidebar = container.querySelector("[data-slot=sidebar]")!;
    expect(sidebar.getAttribute("data-state")).toBe("expanded");
    await user.click(screen.getByRole("button", { name: "Alternar la barra lateral" }));
    expect(sidebar.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon");
    expect(document.cookie).toContain("sidebar_state=false");
    await user.keyboard("{Control>}b{/Control}");
    expect(sidebar.getAttribute("data-state")).toBe("expanded");
    expect(document.cookie).toContain("sidebar_state=true");
    // El destino conserva su nombre accesible también colapsado.
    const link = screen.getByRole("link", { name: "Facturas" });
    expect(link.getAttribute("aria-current")).toBe("page");
    // El destino actual va en el azul activo, no en gris.
    expect(link.className.split(/\s+/)).toContain("data-active:bg-active");
    expect(link.className.split(/\s+/)).toContain("data-active:text-active-foreground");
  });

  it("en móvil abre un panel con botón de cerrar y devuelve el foco al botón de menú", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Alternar la barra lateral" });
    await user.click(trigger);
    const panel = await screen.findByRole("dialog", { name: "Menú" });
    expect(panel.getAttribute("data-mobile")).toBe("true");
    expect(screen.getByRole("link", { name: "Facturas" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
