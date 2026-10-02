// Datos del módulo Usuarios: consultas canceladas al cambiar el alcance y mutaciones que pasan por
// useMutationFeedback (pendiente, resultado, invalidación y mensajes de negocio).
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  userListMetaSchema,
  userViewSchema,
  type CreateUserInput,
  type MembershipStatus,
  type Role,
  type UserView,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/permissions";

export const USERS_KEY = ["users"] as const;

export type UsersQuery = {
  search: string;
  status: MembershipStatus | undefined;
  page: number;
  pageSize: number;
};

export function useUsers(query: UsersQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...USERS_KEY, query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search) params.set("search", query.search);
      if (query.status) params.set("status", query.status);
      return apiFetchPage(`/users?${params.toString()}`, {
        schema: z.array(userViewSchema),
        meta: userListMetaSchema,
        signal,
      });
    },
  });
}

const sendUser = (method: "POST" | "PUT", path: string, json: unknown) =>
  apiFetch(path, { method, json, schema: userViewSchema });

export function useCreateUser(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: (input: CreateUserInput) => sendUser("POST", "/users", input),
    success: (user) => `Creaste a ${user.name} como ${ROLE_LABELS[user.role].toLowerCase()}.`,
    invalidate: [USERS_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useChangeRole(options: { onSuccess: () => void }) {
  return useMutationFeedback({
    mutationFn: ({ user, role }: { user: UserView; role: Role }) =>
      sendUser("PUT", `/users/${encodeURIComponent(user.id)}/role`, { role }),
    success: (user) => `${user.name} ahora es ${ROLE_LABELS[user.role].toLowerCase()}.`,
    invalidate: [USERS_KEY],
    onSuccess: options.onSuccess,
  });
}

export function useSetPassword(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({ user, password }: { user: UserView; password: string }) =>
      apiFetch<undefined>(`/users/${encodeURIComponent(user.id)}/password`, {
        method: "PUT",
        json: { password },
      }),
    success: (_result, { user }) =>
      `Estableciste una contraseña nueva para ${user.name}. Sus sesiones se cerraron.`,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

/** Desactivar es reversible: un paso, con Deshacer en el aviso (escalera de confirmación). */
export function useChangeStatus() {
  const mutation = useMutationFeedback({
    mutationFn: ({ user, status }: { user: UserView; status: MembershipStatus }) =>
      sendUser("PUT", `/users/${encodeURIComponent(user.id)}/status`, { status }),
    success: (user): SuccessFeedback =>
      user.status === "DEACTIVATED"
        ? {
            message: `Desactivaste a ${user.name}. Sus sesiones se cerraron.`,
            action: {
              label: "Deshacer",
              onClick: () => mutation.mutate({ user, status: "ACTIVE" }),
            },
          }
        : `Reactivaste a ${user.name}.`,
    invalidate: [USERS_KEY],
  });
  return mutation;
}
