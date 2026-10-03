// Logs estructurados con redacción de secretos (docs/quality/observability.md).
import { pino, type DestinationStream, type Logger, type LevelWithSilent } from "pino";

export const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "token",
  "secret",
  "*.password",
  "*.token",
  "*.secret",
  // Archivo de la firma electrónica (add-signing-certificate, design D13).
  "file",
  "*.file",
];

export function createLogger(level: LevelWithSilent, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" } }, destination);
}
