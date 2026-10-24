// El recorrido visto se recuerda en el navegador, por usuario (add-onboarding-tour, design D3;
// decisión del propietario, 2026-10-24). Un almacenamiento no disponible, como en algunos modos
// privados, solo hace que el recorrido se vuelva a ofrecer.

const PREFIX = "emiteya.recorrido.v1:";

/** La clave del usuario: su correo en minúsculas. */
export const tourKey = (email: string) => `${PREFIX}${email.trim().toLowerCase()}`;

export function tourSeen(email: string): boolean {
  try {
    return window.localStorage.getItem(tourKey(email)) !== null;
  } catch {
    return false;
  }
}

export function markTourSeen(email: string): void {
  try {
    window.localStorage.setItem(tourKey(email), new Date().toISOString());
  } catch {
    // Sin almacenamiento, el recorrido se ofrecerá otra vez: no es un error para el usuario.
  }
}
