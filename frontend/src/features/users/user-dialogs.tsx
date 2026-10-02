// Diálogos del módulo Usuarios (design D12): Crear usuario, Cambiar rol y Establecer contraseña.
// Formularios con React Hook Form y los esquemas del contrato; los valores se conservan ante errores.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { userSchemas, type CreateUserInput, type Role, type UserView } from "@facturador/contracts";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { PasswordField } from "@/components/password-field";
import { SelectionCardGroup, type SelectionCardOption } from "@/components/selection-card-group";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useChangeRole, useCreateUser, useSetPassword } from "./users-api";

// La longitud de la contraseña es configuración del despliegue: la valida el servidor, cuyo mensaje
// indica el valor vigente. El cliente solo exige que el campo no esté vacío.
const schemas = userSchemas();
const createUserForm = schemas.createUser.extend({
  password: z.string().min(1, "Escribe la contraseña inicial."),
});
const setPasswordForm = schemas.setPassword.extend({
  password: z.string().min(1, "Escribe la contraseña nueva."),
});

export const ROLE_OPTIONS: readonly SelectionCardOption<Role>[] = [
  { value: "OPERATOR", label: "Operador", description: "Emite y consulta comprobantes" },
  {
    value: "ADMIN",
    label: "Administrador",
    description: "Configura la empresa y gestiona usuarios",
  },
];

/** Error que no corresponde a un campo: se muestra en el cuerpo del diálogo, no en un aviso. */
function operationError(error: unknown): string {
  return errorMessage(error);
}

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const roleLabel = useId();
  const [error, setError] = useState<string>();
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserForm),
    // El rol por defecto es el de menor privilegio.
    defaultValues: { name: "", email: "", password: "", role: "OPERATOR" },
  });
  const { errors } = form.formState;
  const close = () => {
    onOpenChange(false);
    form.reset();
    setError(undefined);
  };
  const create = useCreateUser({
    onSuccess: close,
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "EMAIL_IN_USE") {
        form.setError("email", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      if (cause instanceof ApiError && cause.status === 400) {
        setError(operationError(cause));
        return true;
      }
      return false;
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Crear usuario"
      description="La persona entra con su correo y la contraseña inicial que definas."
      submitLabel="Crear usuario"
      pending={create.isPending}
      error={error}
      onSubmit={form.handleSubmit((input) => {
        setError(undefined);
        create.mutate(input);
      })}
    >
      <FormField id="create-name" label="Nombre" error={errors.name?.message}>
        <Input
          {...fieldAria("create-name", errors.name?.message)}
          {...form.register("name")}
          autoComplete="off"
        />
      </FormField>
      <FormField id="create-email" label="Correo" error={errors.email?.message}>
        <Input
          {...fieldAria("create-email", errors.email?.message)}
          {...form.register("email")}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </FormField>
      <FormField id="create-password" label="Contraseña inicial" error={errors.password?.message}>
        <PasswordField
          {...fieldAria("create-password", errors.password?.message)}
          {...form.register("password")}
          autoComplete="new-password"
        />
      </FormField>
      <div className="flex flex-col gap-0.5">
        <span id={roleLabel} className="text-sm font-medium">
          Rol
        </span>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <SelectionCardGroup
              options={ROLE_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              aria-labelledby={roleLabel}
            />
          )}
        />
      </div>
    </FormDialog>
  );
}

export function ChangeRoleDialog({
  user,
  onClose,
}: {
  user: UserView | null;
  onClose: () => void;
}) {
  const roleLabel = useId();
  const [role, setRole] = useState<Role | null>(null);
  const change = useChangeRole({ onSuccess: () => close() });
  const close = () => {
    setRole(null);
    onClose();
  };
  const selected = role ?? user?.role ?? "OPERATOR";

  return (
    <FormDialog
      open={user !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Cambiar rol"
      {...(user
        ? { description: `Elige el acceso de ${user.name}. El cambio rige en su siguiente acción.` }
        : {})}
      submitLabel="Guardar rol"
      pending={change.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (user) change.mutate({ user, role: selected });
      }}
    >
      <span id={roleLabel} className="sr-only">
        Rol
      </span>
      <SelectionCardGroup
        options={ROLE_OPTIONS}
        value={selected}
        onChange={setRole}
        aria-labelledby={roleLabel}
      />
    </FormDialog>
  );
}

export function SetPasswordDialog({
  user,
  onClose,
}: {
  user: UserView | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const form = useForm<{ password: string }>({
    resolver: zodResolver(setPasswordForm),
    defaultValues: { password: "" },
  });
  const { errors } = form.formState;
  const close = () => {
    form.reset();
    setError(undefined);
    onClose();
  };
  const setPassword = useSetPassword({
    onSuccess: close,
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 400) {
        form.setError("password", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      return false;
    },
  });

  return (
    <FormDialog
      open={user !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Establecer contraseña"
      {...(user
        ? {
            description: `${user.name} entrará con la contraseña nueva. Sus sesiones abiertas se cerrarán.`,
          }
        : {})}
      submitLabel="Establecer contraseña"
      pending={setPassword.isPending}
      error={error}
      onSubmit={form.handleSubmit(({ password }) => {
        setError(undefined);
        if (user) setPassword.mutate({ user, password });
      })}
    >
      <FormField id="set-password" label="Contraseña nueva" error={errors.password?.message}>
        <PasswordField
          {...fieldAria("set-password", errors.password?.message)}
          {...form.register("password")}
          autoComplete="new-password"
        />
      </FormField>
    </FormDialog>
  );
}
