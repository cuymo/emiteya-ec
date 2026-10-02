// Recuperación administrativa de emergencia (design D8): `admin:recover --email <correo>`.
// La contraseña nueva se lee de la entrada estándar, nunca de argumentos, para que no quede en el
// historial del shell ni en la lista de procesos. El servidor HTTP no importa este archivo.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { emailSchema, passwordSchema } from "@facturador/contracts";
import { EnvError, loadEnv, passwordPolicy } from "../config/env.ts";
import { RecoveryError, recoverAdministrator } from "../modules/identity/application/recovery.ts";
import {
  authSettingsFromEnv,
  createAuth,
  createUnitOfWork,
} from "../modules/identity/infrastructure/better-auth/index.ts";
import { createDatabase } from "../platform/db/database.ts";

const USAGE =
  "Uso: admin:recover --email <correo>  (la contraseña nueva se lee de la entrada estándar)";

/** Lee una línea sin mostrarla si la entrada es una terminal; si no, lee la entrada completa. */
async function readPassword(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += String(chunk);
    return data.replace(/\r?\n$/, "");
  }
  process.stderr.write("Contraseña nueva: ");
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (char: string) => {
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stderr.write("\n");
        resolve(value);
      } else if (char === "\u0003") {
        stdin.setRawMode(false);
        reject(new Error("Cancelado."));
      } else if (char === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { email: { type: "string" } }, strict: true });
  const email = emailSchema.safeParse(values.email);
  if (!email.success) {
    console.error(`El correo falta o no es válido.\n${USAGE}`);
    return 2;
  }

  const env = loadEnv();
  const policy = passwordPolicy(env);
  const password = passwordSchema(policy).safeParse(await readPassword());
  if (!password.success) {
    console.error(
      `La contraseña debe tener entre ${policy.minLength} y ${policy.maxLength} caracteres.`,
    );
    return 2;
  }

  const database = createDatabase(env.DATABASE_URL);
  try {
    const settings = authSettingsFromEnv(env);
    const auth = createAuth({ prisma: database.prisma, settings });
    const result = await recoverAdministrator(createUnitOfWork(database.prisma, auth, settings), {
      email: email.data,
      password: password.data,
      correlationId: `admin-recover-${randomUUID()}`,
    });
    console.log(
      `Administrador recuperado${result.reactivated ? " y reactivado" : ""}; sus sesiones anteriores quedaron invalidadas.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof RecoveryError) {
      console.error(`${error.message} No se cambió nada.`);
      return 1;
    }
    throw error;
  } finally {
    await database.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      error instanceof EnvError
        ? error.message
        : `La recuperación falló; no se cambió nada. ${(error as Error).message}`,
    );
    process.exit(1);
  },
);
