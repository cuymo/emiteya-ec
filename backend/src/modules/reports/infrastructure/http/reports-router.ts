// Rutas de los reportes bajo /api/v1 (add-reports-export, design D10 y D12): una lista y una
// exportación por reporte, con rutas concretas como las documenta el OpenAPI. La empresa sale de la
// sesión. La exportación entrega el archivo temporal por la misma respuesta y lo borra al terminar,
// al fallar o cuando el cliente se desconecta; si el cliente se va mientras se genera, la
// generación se detiene sin auditar ni entregar nada.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { REPORT_EXPORT_CONTENT_TYPES, REPORT_IDS } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { Reports } from "../../application/reports.ts";

export function reportsRouter(reports: Reports): Router {
  const router = Router();

  for (const report of REPORT_IDS) {
    router.get(`/reports/${report}`, async (req, res) => {
      const { data, meta } = await reports.list(contextOf(res), report, req.query);
      res.status(200).json({ data, meta });
    });

    router.get(`/reports/${report}/export`, async (req, res, next) => {
      // Express atiende HEAD con la ruta GET: un HEAD no recibe el archivo, así que nunca genera ni
      // audita una exportación.
      if (req.method === "HEAD") {
        res.status(405).set("Allow", "GET").end();
        return;
      }
      const aborted = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) aborted.abort();
      });
      const started = performance.now();
      let generated;
      try {
        generated = await reports.export(contextOf(res), report, req.query, aborted.signal);
      } catch (error) {
        // Sin cliente no hay a quién responder; el temporal ya se borró.
        if (aborted.signal.aborted) return;
        next(error);
        return;
      }
      const { path, fileName, rows, dispose } = generated;
      try {
        if (aborted.signal.aborted) return;
        const { size } = await stat(path);
        res.status(200).set({
          "Content-Type": REPORT_EXPORT_CONTENT_TYPES[0],
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        // Sin filtros ni la ruta del temporal (design D17).
        req.log.info(
          { report, rows, durationMs: Math.round(performance.now() - started) },
          "reporte exportado",
        );
        await pipeline(createReadStream(path), res);
      } catch (error) {
        // Una desconexión durante la entrega no es un error del servidor; el evento ya registró
        // que el archivo se generó y se autorizó para entregarse, no que llegó.
        if (!res.headersSent) next(error);
        else res.destroy();
      } finally {
        await dispose();
      }
    });
  }

  return router;
}
