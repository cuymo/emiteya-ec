// Geometría de la composición, medida en el navegador (design D17). Se ejecuta dentro de la página
// con `page.evaluate`, así que no usa nada de fuera de la función. Las cajas van en píxeles CSS,
// redondeadas a centésimas, con la y medida desde el principio del documento.
export function measureComposition() {
  const round = (value: number) => Math.round(value * 100) / 100;
  const box = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y + window.scrollY),
      w: round(rect.width),
      h: round(rect.height),
    };
  };
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      (rect.width > 0 || rect.height > 0)
    );
  };
  const text = (element: Element) =>
    (element.getAttribute("aria-label") ?? element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const all = (selector: string, root: ParentNode = document) =>
    Array.from(root.querySelectorAll(selector)).filter(visible);

  // Barra superior: cada hijo visible, en orden, y el hueco con el siguiente.
  const header = document.querySelector("header");
  const items = header
    ? Array.from(header.querySelectorAll(":scope > *"))
        .filter(visible)
        .map((element) => ({ text: text(element), ...box(element) }))
    : [];
  const topbar = header
    ? {
        ...box(header),
        items,
        gaps: items.slice(1).map((item, index) => {
          const previous = items[index]!;
          return round(item.x - (previous.x + previous.w));
        }),
      }
    : null;

  const main = document.querySelector("main");
  const title = main?.querySelector("h1");
  const breadcrumbs = all("[data-slot=breadcrumb]").map((element) => ({
    inTopbar: Boolean(element.closest("header")),
    text: text(element),
    ...box(element),
  }));

  // Acciones: los botones visibles de la página y de un diálogo abierto, con su estado y su color.
  const actions = all("[data-slot=button]").map((element) => {
    const style = getComputedStyle(element);
    return {
      text: text(element),
      variant: element.getAttribute("data-variant"),
      disabled:
        (element as HTMLButtonElement).disabled === true ||
        element.getAttribute("aria-disabled") === "true",
      busy: element.getAttribute("aria-busy") === "true",
      inDialog: Boolean(element.closest("[role=dialog],[role=alertdialog]")),
      background: style.backgroundColor,
      color: style.color,
      opacity: style.opacity,
      ...box(element),
    };
  });

  // Campos: cada etiqueta con su control y el hueco entre ambos.
  const fields = all("label[for]").flatMap((label) => {
    const control = document.getElementById(label.getAttribute("for") ?? "");
    if (!control || !visible(control)) return [];
    const labelBox = box(label);
    const controlBox = box(control);
    return [
      {
        label: text(label),
        labelBox,
        controlBox,
        gapY: round(controlBox.y - (labelBox.y + labelBox.h)),
        offsetX: round(controlBox.x - labelBox.x),
      },
    ];
  });

  const surfaces = all(
    "main section, main [data-slot=card], main aside, [role=dialog], [role=alertdialog]",
  ).map((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role"),
    label:
      element.getAttribute("aria-label") ??
      (element.getAttribute("aria-labelledby")
        ? text(document.getElementById(element.getAttribute("aria-labelledby")!) ?? element)
        : null),
    ...box(element),
  }));

  // Desbordes: la página y cada contenedor que se desplaza a lo ancho.
  const root = document.documentElement;
  const scrollers = all("body *").flatMap((element) => {
    const style = getComputedStyle(element);
    if (!["auto", "scroll"].includes(style.overflowX)) return [];
    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) return [];
    return [{ text: text(element).slice(0, 40), overflow: round(overflow), ...box(element) }];
  });

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: { width: root.scrollWidth, height: root.scrollHeight },
    pageOverflowX: root.scrollWidth - root.clientWidth,
    topbar,
    main: main ? box(main) : null,
    title: title ? { text: text(title), ...box(title) } : null,
    breadcrumbs,
    actions,
    fields,
    surfaces,
    scrollers,
  };
}

export type Composition = ReturnType<typeof measureComposition>;
