// Rutas de la portabilidad bajo /api/v1 (add-data-portability, design D16 y D17). La empresa sale
// de la sesión. La descarga envía el paquete por streaming desde el mismo descriptor que el servicio
// verificó completo antes de cualquier cabecera; HEAD no se atiende, no hay rangos ni enlaces
// firmados o públicos, y el nombre del archivo es ASCII y sin datos personales.
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { DATA_EXPORT_CONTENT_TYPES } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { DataExports } from "../../application/service.ts";

export function dataPortabilityRouter(exports: DataExports): Router {
  const router = Router();

  router.post("/data-exports", async (req, res) => {
    const data = await exports.request(contextOf(res), req.body as unknown);
    res.status(202).json({ data });
  });

  router.get("/data-exports", async (req, res) => {
    const { data, meta } = await exports.list(contextOf(res), req.query);
    res.status(200).json({ data, meta });
  });

  router.get("/data-exports/:id", async (req, res) => {
    res.status(200).json({ data: await exports.detail(contextOf(res), req.params) });
  });

  router.get("/data-exports/:id/download", async (req, res, next) => {
    // Express atiende HEAD con la ruta GET: un HEAD nunca verifica ni audita una descarga.
    if (req.method === "HEAD") {
      res.status(405).set("Allow", "GET").end();
      return;
    }
    let downloadable;
    try {
      downloadable = await exports.download(contextOf(res), req.params);
    } catch (error) {
      next(error);
      return;
    }
    const { handle, sizeBytes, fileName } = downloadable;
    try {
      res.status(200).set({
        "Content-Type": DATA_EXPORT_CONTENT_TYPES[0],
        "Content-Length": String(sizeBytes),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      await pipeline(handle.createReadStream({ start: 0, highWaterMark: 1 << 20 }), res);
    } catch (error) {
      // Una desconexión durante la entrega no es un error del servidor: el evento solo registró
      // que la descarga empezó, no que llegó completa.
      if (!res.headersSent) next(error);
      else res.destroy();
    } finally {
      await handle.close().catch(() => undefined);
    }
  });

  return router;
}
