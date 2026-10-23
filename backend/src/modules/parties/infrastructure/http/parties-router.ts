// Rutas de terceros bajo /api/v1 (add-parties-and-products, design D11). No hay ruta de borrado:
// los terceros se desactivan.
import { Router, type Response } from "express";
import type { ListMeta, PartyView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { Parties, PartyResult } from "../../application/parties.ts";

export function toPartyView(party: PartyResult): PartyView {
  return {
    id: party.id,
    identificationType: party.identificationType,
    identificationTypeLabel: party.identificationTypeLabel,
    identification: party.identification,
    legalName: party.legalName,
    address: party.address,
    emails: [...party.emails],
    phone: party.phone,
    roles: party.roles,
    status: party.status,
    systemRecord: party.systemRecord,
    version: party.version,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
  };
}

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

export function partiesRouter(parties: Parties): Router {
  const router = Router();

  router.get("/parties", async (req, res) => {
    const { items, meta } = await parties.list(contextOf(res), req.query);
    send(res, 200, items.map(toPartyView), meta);
  });

  router.post("/parties", async (req, res) => {
    send(res, 201, toPartyView(await parties.create(contextOf(res), req.body)));
  });

  router.get("/parties/:partyId", async (req, res) => {
    send(res, 200, toPartyView(await parties.get(contextOf(res), req.params.partyId)));
  });

  router.put("/parties/:partyId", async (req, res) => {
    send(res, 200, toPartyView(await parties.update(contextOf(res), req.params.partyId, req.body)));
  });

  router.put("/parties/:partyId/status", async (req, res) => {
    send(
      res,
      200,
      toPartyView(await parties.changeStatus(contextOf(res), req.params.partyId, req.body)),
    );
  });

  return router;
}
