// Derivado de shadcn/ui, `components/ui/calendar.tsx` (MIT; frontend/THIRD_PARTY_NOTICES.md), sobre
// react-day-picker 9 (decisión del propietario, 2026-10-22: las fechas con el calendario de shadcn).
// Adaptado: en español (`es` de react-day-picker, con sus rótulos accesibles), la semana desde el
// lunes, los tokens del proyecto en lugar de los de la plantilla, el mes y el año en listas
// desplegables con el nombre del mes completo, y solo las piezas que tienen consumidor (una fecha,
// sin rangos ni números de semana). Se pinta solo en el cliente, dentro del popover: el único estilo
// en línea de DayPicker (una región «aria-live» oculta) lo aplica React por el CSSOM, como el
// posicionamiento del popover de Radix, y `style-src-attr 'none'` (ADR 0025) no lo bloquea.
"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, type ComponentProps } from "react";
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
const monthName = new Intl.DateTimeFormat("es-EC", { month: "long" });
const monthAndYear = new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric" });

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  formatters,
  components,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      locale={es}
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("group/calendar bg-popover p-1 [--cell-size:--spacing(9)]", className)}
      formatters={{
        formatMonthDropdown: (date) => capitalize(monthName.format(date)),
        formatCaption: (date) => capitalize(monthAndYear.format(date)),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaults.root),
        months: cn("relative flex flex-col gap-4", defaults.months),
        month: cn("flex w-full flex-col gap-4", defaults.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaults.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaults.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaults.button_next,
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaults.month_caption,
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaults.dropdowns,
        ),
        dropdown_root: cn(
          "relative rounded-md border border-input has-focus:border-ring has-focus:ring-2 has-focus:ring-ring/40",
          defaults.dropdown_root,
        ),
        dropdown: cn("absolute inset-0 bg-popover opacity-0", defaults.dropdown),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : "flex h-8 items-center gap-1 rounded-md pr-1 pl-2 text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaults.caption_label,
        ),
        month_grid: "w-full border-collapse",
        weekdays: cn("flex", defaults.weekdays),
        weekday: cn(
          "flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none",
          defaults.weekday,
        ),
        week: cn("mt-1 flex w-full", defaults.week),
        day: cn(
          "group/day relative aspect-square h-full w-full p-0 text-center select-none",
          defaults.day,
        ),
        today: cn("rounded-md bg-accent text-accent-foreground", defaults.today),
        outside: cn("text-muted-foreground aria-selected:text-muted-foreground", defaults.outside),
        disabled: cn("text-muted-foreground opacity-50", defaults.disabled),
        hidden: cn("invisible", defaults.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...rest }) => (
          <div data-slot="calendar" ref={rootRef} className={className} {...rest} />
        ),
        Chevron: ({ className, orientation }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeft
              : orientation === "right"
                ? ChevronRight
                : ChevronDown;
          return <Icon aria-hidden="true" className={cn("size-4", className)} />;
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

/** El día: el elegido en el azul primario; el foco del teclado sigue al día enfocado. */
function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.isoDate}
      data-selected-single={modifiers.selected || undefined}
      className={cn(
        "flex aspect-square size-auto w-full min-w-(--cell-size) font-normal tabular-nums max-md:size-auto",
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:hover:bg-primary/90",
        className,
      )}
      {...props}
    />
  );
}
