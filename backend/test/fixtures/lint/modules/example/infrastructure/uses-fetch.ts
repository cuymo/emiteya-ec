// Fixture: fuera del transporte de sri-engine no se llama a fetch, ni como global ni por globalThis.
export const a = () => fetch("https://example.invalid");
export const b = () => globalThis.fetch("https://example.invalid");
