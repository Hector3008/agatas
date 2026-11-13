import express from "express";
import { PERMISOS } from "./roles.js";
import { manejar, middlewareCsrf } from "./http.js";

/** Rutas del personal (mesero y administración), bajo /staff. */
export function crearRouterStaff({ core, premios, retiros }) {
  const csrf = middlewareCsrf(core);
  const auth = core.autenticar({ requiereEmpresa: true });
  const actorDe = (req) => ({ usuarioId: req.auth.usuarioId, permisos: req.rol?.permisos ?? [] });
  const ctx = (req) => ({ empresaId: req.auth.empresaId, actor: actorDe(req) });

  const r = express.Router();
  r.use(express.json({ limit: "4kb" }));

  r.get("/premios", auth, core.requierePermiso(PERMISOS.leer), manejar(async (req, res) => {
    const estado = ["pendiente", "entregado", "anulado"].includes(req.query.estado) ? req.query.estado : "pendiente";
    res.json({ premios: await premios.listar({ ...ctx(req), estado }) });
  }));

  r.get("/premios/:codigo", auth, core.requierePermiso(PERMISOS.validar), manejar(async (req, res) => {
    res.json(await premios.consultar({ ...ctx(req), codigo: req.params.codigo }));
  }));

  r.post("/premios/:codigo/entregar", auth, csrf, core.requierePermiso(PERMISOS.validar), manejar(async (req, res) => {
    res.json(await premios.entregar({ ...ctx(req), codigo: req.params.codigo }));
  }));

  r.post("/premios/:codigo/anular", auth, csrf, core.requierePermiso(PERMISOS.validar), manejar(async (req, res) => {
    res.json(await premios.anular({ ...ctx(req), codigo: req.params.codigo, motivo: String(req.body?.motivo ?? "") }));
  }));

  r.get("/partidas", auth, core.requierePermiso(PERMISOS.leer), manejar(async (req, res) => {
    res.json({ partidas: await retiros.listar(ctx(req)) });
  }));

  r.post("/partidas/:id/retirar", auth, csrf, core.requierePermiso(PERMISOS.validar), manejar(async (req, res) => {
    res.json(await retiros.retirar({ ...ctx(req), id: req.params.id }));
  }));

  // Empresa de quien atiende (para mostrar su identificador en la pantalla del mesero).
  r.get("/empresa", auth, manejar(async (req, res) => {
    const e = await core.modelos?.Empresa?.findOne({ _id: req.auth.empresaId }).lean();
    res.json({ slug: e?.slug ?? null });
  }));

  return r;
}
