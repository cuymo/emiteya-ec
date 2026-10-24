// Ejecución del recorrido de bienvenida con driver.js (add-onboarding-tour, design D1 y D2). driver.js
// recorre una sola pantalla: el recorrido abre un tramo por pantalla, navega al siguiente y espera a
// que aparezca su primer elemento. Solo señala y explica: nunca guarda ni emite.
import { driver, type DriveStep, type Driver } from "driver.js";
import type { TourSegment, TourStep } from "./tour-steps";

/** Cuánto espera a que una pantalla muestre el primer elemento de su tramo. */
export const SEGMENT_TIMEOUT_MS = 8_000;

/** El elemento a la vista de un selector, o `null` si no está o está oculto. */
export function visibleElement(selector: string): Element | null {
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const visible =
      typeof element.checkVisibility === "function" ? element.checkVisibility() : true;
    if (visible) return element;
  }
  return null;
}

const present = (step: TourStep) => !step.selector || visibleElement(step.selector) !== null;
const anchored = (segment: TourSegment) => segment.steps.some((step) => step.selector);

/** Espera a que la pantalla muestre algún elemento del tramo; false si se agota el tiempo. */
function waitForSegment(segment: TourSegment, signal: { cancelled: boolean }): Promise<boolean> {
  if (!anchored(segment)) return Promise.resolve(true);
  const ready = () => segment.steps.some((step) => step.selector && present(step));
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (signal.cancelled || ready()) done(!signal.cancelled);
    });
    const timer = window.setTimeout(() => done(false), SEGMENT_TIMEOUT_MS);
    function done(result: boolean) {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(result);
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

export type TourOptions = {
  segments: readonly TourSegment[];
  /** La dirección actual, sin la consulta. */
  currentPath: () => string;
  navigate: (path: string) => void;
  /** Al terminar o cerrar el recorrido: el llamador lo recuerda. */
  onFinish: () => void;
  reducedMotion: boolean;
};

export type Tour = { start: () => void; stop: () => void };

export function createTour({
  segments,
  currentPath,
  navigate,
  onFinish,
  reducedMotion,
}: TourOptions): Tour {
  let active: Driver | null = null;
  let signal = { cancelled: false };

  function finish() {
    active = null;
    onFinish();
  }

  async function run(index: number, fromEnd: boolean, token: { cancelled: boolean }) {
    const segment = segments[index];
    if (!segment) return finish();
    if (currentPath() !== segment.path) navigate(segment.path);
    const ready = await waitForSegment(segment, token);
    if (token.cancelled) return;
    const steps = ready ? segment.steps.filter(present) : [];
    // Un tramo sin nada a la vista se salta, sin dejar el recorrido detenido.
    if (steps.length === 0) return run(fromEnd ? index - 1 : index + 1, fromEnd, token);
    const lastSegment = index === segments.length - 1;
    let leaving = false;
    const leave = (target: number, toEnd: boolean) => {
      leaving = true;
      active?.destroy();
      if (target < 0) return finish();
      void run(target, toEnd, token);
    };
    const driveSteps: DriveStep[] = steps.map((step, position) => ({
      ...(step.selector ? { element: () => visibleElement(step.selector!) ?? document.body } : {}),
      popover: {
        title: step.title,
        description: step.description,
        ...(step.side ? { side: step.side } : {}),
        // «Anterior» vuelve al tramo previo desde el primer paso; «Siguiente» sigue al próximo.
        ...(position === 0 && index > 0 ? { disableButtons: [] } : {}),
        ...(position === steps.length - 1 && !lastSegment ? { doneBtnText: "Siguiente" } : {}),
      },
    }));
    active = driver({
      steps: driveSteps,
      animate: !reducedMotion,
      smoothScroll: !reducedMotion,
      allowClose: true,
      showProgress: true,
      progressText: `${segment.label} · {{current}} de {{total}}`,
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Terminar",
      closeBtnLabel: "Cerrar el recorrido",
      popoverClass: "emiteya-tour",
      // Solo señala: el elemento resaltado no recibe clics mientras dura el paso.
      disableActiveInteraction: true,
      onNextClick: (_element, _step, { driver: tour }) => {
        if (tour.isLastStep()) return leave(lastSegment ? -1 : index + 1, false);
        tour.moveNext();
      },
      onPrevClick: (_element, _step, { driver: tour }) => {
        if (tour.isFirstStep()) {
          if (index > 0) leave(index - 1, true);
          return;
        }
        tour.movePrevious();
      },
      onDestroyStarted: (_element, _step, { driver: tour }) => {
        // Cerrar con el botón, Escape o un clic fuera termina el recorrido y se recuerda.
        tour.destroy();
        if (!leaving) finish();
      },
      onPopoverRender: (popover) => {
        popover.nextButton.focus({ preventScroll: true });
      },
    });
    active.drive(fromEnd ? steps.length - 1 : 0);
  }

  return {
    start() {
      signal.cancelled = true;
      active?.destroy();
      signal = { cancelled: false };
      void run(0, false, signal);
    },
    stop() {
      signal.cancelled = true;
      active?.destroy();
      active = null;
    },
  };
}
