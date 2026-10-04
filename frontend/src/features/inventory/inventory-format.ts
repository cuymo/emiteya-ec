// Presentación del inventario (add-minimal-inventory, design D8 y D13): el estado con icono y texto,
// el saldo negativo destacado y sin cifra antes de inicializar, y los movimientos en lenguaje de
// negocio.
import {
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_TRACKING_STATE_LABELS,
  type StockMovementOrigin,
  type StockTrackingState,
} from "@facturador/contracts";
import { CircleCheck, CircleDashed, CirclePause, CircleSlash, type LucideIcon } from "lucide-react";
import type { StatusTone } from "@/components/states";
import { formatDecimal } from "@/lib/decimal";

export const STOCK_STATE_BADGES: Record<
  StockTrackingState,
  { tone: StatusTone; label: string; icon: LucideIcon }
> = {
  NOT_TRACKED: {
    tone: "neutral",
    label: STOCK_TRACKING_STATE_LABELS.NOT_TRACKED,
    icon: CircleSlash,
  },
  TRACKED_NOT_INITIALIZED: {
    tone: "warning",
    label: STOCK_TRACKING_STATE_LABELS.TRACKED_NOT_INITIALIZED,
    icon: CircleDashed,
  },
  TRACKED_INITIALIZED: {
    tone: "success",
    label: STOCK_TRACKING_STATE_LABELS.TRACKED_INITIALIZED,
    icon: CircleCheck,
  },
  DISABLED_INITIALIZED: {
    tone: "neutral",
    label: STOCK_TRACKING_STATE_LABELS.DISABLED_INITIALIZED,
    icon: CirclePause,
  },
};

export const MOVEMENT_TYPE_LABELS = STOCK_MOVEMENT_TYPE_LABELS;

export const ORIGIN_LABELS: Record<StockMovementOrigin, string> = {
  USER: "Usuario",
  SYSTEM: "Sistema",
};

/** Variación con signo explícito: "+5", "-3,5". */
export const formatDelta = (delta: string) =>
  delta.startsWith("-") ? formatDecimal(delta) : `+${formatDecimal(delta)}`;
