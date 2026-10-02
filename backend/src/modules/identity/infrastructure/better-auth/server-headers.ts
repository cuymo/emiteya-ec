// Better Auth lee la IP del cliente solo de cabeceras (S-1, E3). Express escribe cabeceras propias
// del servidor con `req.ip`, que respeta `trust proxy`, y con la correlación de la petición,
// sobrescribiendo cualquier valor enviado por el cliente (design D9).
import type { RequestHandler } from "express";

export const CLIENT_IP_HEADER = "x-app-client-ip";
export const REQUEST_ID_HEADER = "x-request-id";

export const serverHeaders: RequestHandler = (req, _res, next) => {
  req.headers[CLIENT_IP_HEADER] = req.ip ?? "";
  req.headers[REQUEST_ID_HEADER] = req.requestId;
  next();
};
