// Preferencia de la barra lateral (adopt-premium-design-foundation-and-shell, design D12). Vive fuera
// de los módulos de cliente para que el layout del servidor lea la cookie y renderice el estado
// correcto sin parpadeo; la barra la escribe al expandirse o colapsarse.
export const SIDEBAR_COOKIE_NAME = "sidebar_state";

/** Expandida salvo que la cookie diga lo contrario. */
export function sidebarDefaultOpen(cookieValue: string | undefined): boolean {
  return cookieValue !== "false";
}
