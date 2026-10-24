// Avatar propio de un usuario (redesign-account-profile, design D4 y D5): PNG o JPEG reconocidos por
// el contenido, con la inspección compartida de `platform/images`, y un tamaño máximo configurable
// con los mismos límites que el logo.

/** Tamaño máximo por defecto del avatar; la variable AVATAR_MAX_BYTES lo configura. */
export const DEFAULT_AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_MAX_BYTES_RANGE = { min: 16 * 1024, max: 2 * 1024 * 1024 } as const;
