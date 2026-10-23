// Una lista editable de correos (add-email-delivery, design D14), que comparten Terceros y el
// reenvío: una fila por correo porque `useFieldArray` trabaja con objetos. Cada fila se valida en su
// posición con la regla del contrato, así el error queda junto a su campo; una fila vacía no se
// envía.
import { z } from "zod";

export type EmailRow = { address: string };

export const toEmailRows = (addresses: readonly string[]): EmailRow[] =>
  (addresses.length > 0 ? addresses : [""]).map((address) => ({ address }));

export function emailRowsSchema({
  max,
  address,
  tooMany,
  required,
}: {
  max: number;
  /** La regla de una dirección, la del contrato. */
  address: z.ZodType<string, string>;
  tooMany: string;
  /** Sin este mensaje, la lista puede quedar vacía. */
  required?: string;
}) {
  return z
    .array(z.object({ address: z.string() }))
    .max(max, tooMany)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        const email = row.address.trim();
        if (email === "") return;
        const result = address.safeParse(email);
        if (!result.success) {
          const message =
            result.error.issues[0]?.message ?? "El correo no tiene un formato válido.";
          ctx.addIssue({ code: "custom", path: [index, "address"], message });
          return;
        }
        const key = email.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "address"],
            message: "El correo está repetido.",
          });
        }
        seen.add(key);
      });
      if (required && seen.size === 0 && rows.every((row) => row.address.trim() === "")) {
        ctx.addIssue({ code: "custom", path: [], message: required });
      }
    })
    .transform((rows) => rows.map((row) => row.address.trim()).filter((email) => email !== ""));
}
