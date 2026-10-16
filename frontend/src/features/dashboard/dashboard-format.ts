// Formatos del tablero de Inicio, aparte de los gráficos para no cargar Recharts con la pantalla.

const MONTH = new Intl.DateTimeFormat("es-EC", { month: "long", timeZone: "UTC" });
export const MONTH_SHORT = new Intl.DateTimeFormat("es-EC", { month: "short", timeZone: "UTC" });

/** «2026-09» → «septiembre»; con `MONTH_SHORT`, «sept». */
export const monthName = (month: string, format = MONTH) =>
  format.format(new Date(`${month}-01T12:00:00Z`)).replace(".", "");
