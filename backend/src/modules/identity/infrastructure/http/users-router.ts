// Rutas de la cuenta propia y de la administración de usuarios bajo /api/v1 (design D10). Exigen el
// contexto de requireContext y responden con listas permitidas.
import { Router, type Response } from "express";
import type { Me, UserListMeta, UserView } from "@facturador/contracts";
import type { CompanyMember } from "../../application/memberships.ts";
import type { UserAdministration } from "../../application/user-administration.ts";
import { contextOf } from "./request-context.ts";

export function toUserView(member: CompanyMember): UserView {
  return {
    id: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt.toISOString(),
  };
}

function send<T>(res: Response, status: number, data: T, meta?: UserListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

export function usersRouter(users: UserAdministration): Router {
  const router = Router();

  router.get("/me", async (_req, res) => {
    const me = await users.getMe(contextOf(res));
    send<Me>(res, 200, { name: me.name, email: me.email, role: me.role });
  });

  router.get("/users", async (req, res) => {
    const { items, total, page, pageSize } = await users.listUsers(contextOf(res), req.query);
    send(res, 200, items.map(toUserView), { page, pageSize, total });
  });

  router.post("/users", async (req, res) => {
    send(res, 201, toUserView(await users.createUser(contextOf(res), req.body)));
  });

  router.put("/users/:userId/role", async (req, res) => {
    send(res, 200, toUserView(await users.changeRole(contextOf(res), req.params.userId, req.body)));
  });

  router.put("/users/:userId/status", async (req, res) => {
    send(
      res,
      200,
      toUserView(await users.changeStatus(contextOf(res), req.params.userId, req.body)),
    );
  });

  router.put("/users/:userId/password", async (req, res) => {
    await users.setPassword(contextOf(res), req.params.userId, req.body);
    res.status(204).end();
  });

  return router;
}
