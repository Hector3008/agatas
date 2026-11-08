import express from "express";
import { TIPO_INTERCAMBIO, TIPO_PREMIO } from "./tipos.js";
import { crearModeloConfig } from "./modelo.js";
import { crearServicio, ErrorAgatas } from "./servicio.js";
import { ErrorConfig } from "./config.js";
import { PERMISOS } from "./roles.js";

export { TIPO_INTERCAMBIO, TIPO_PREMIO, MOTIVOS_CANCELACION } from "./tipos.js";
export * from "./config.js";
export { PERMISOS, PLANTILLA_ROLES } from "./roles.js";
export { crearServicio, ErrorAgatas } from "./servicio.js";

function responderError(res, error) {
  if (error instanceof ErrorConfig || error instanceof ErrorAgatas) {
    return res.status(error.status).json({ error: error.codigo, mensaje: error.message, campo: error.campo ?? undefined });
  }
  if (typeof error?.status === "number" && error.codigo) {
    return res.status(error.status).json({ error: error.codigo, mensaje: error.message });
  }
  console.error("[agatas]", error);
  return res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Error inesperado" });
}

/**
 * createRouter({ core }): registra los tipos de documento, crea el modelo y
 * devuelve el router de /agatas. No abre conexiones y trae su express.json().
 */
export function createRouter({ core } = {}) {
  if (!core?.documentos || !core?.model || !core?.autenticar || !core?.requierePermiso) {
    throw new Error("agatas necesita el núcleo (core) con documentos, auth y permisos");
  }
  core.documentos.registrarTipo(TIPO_INTERCAMBIO);
  core.documentos.registrarTipo(TIPO_PREMIO);

  const Config = crearModeloConfig(core);
  const servicio = crearServicio({ core, Config });

  const router = express.Router();
  router.use(express.json());

  router.get("/estado", (_req, res) => {
    res.json({ servicio: "agatas", version: "0.1.0", ok: true });
  });

  // Las escrituras exigen la cabecera anti-CSRF del núcleo. Si no está, se falla
  // al arrancar en vez de dejar PUT /config sin protección.
  const csrf = core.auth?.exigirCsrf;
  if (typeof csrf !== "function") {
    throw new Error("agatas necesita core.auth.exigirCsrf (actualiza el núcleo)");
  }
  const actorDe = (req) => ({ usuarioId: req.auth.usuarioId, permisos: req.rol?.permisos ?? [] });

  router.get(
    "/config",
    core.autenticar({ requiereEmpresa: true }),
    core.requierePermiso(PERMISOS.configurar),
    async (req, res) => {
      try {
        res.set("Cache-Control", "no-store");
        res.json(await servicio.leer({ empresaId: req.auth.empresaId, actor: actorDe(req) }));
      } catch (e) { responderError(res, e); }
    },
  );

  router.put(
    "/config",
    core.autenticar({ requiereEmpresa: true }),
    csrf,
    core.requierePermiso(PERMISOS.configurar),
    async (req, res) => {
      try {
        res.set("Cache-Control", "no-store");
        res.json(await servicio.guardar({ empresaId: req.auth.empresaId, actor: actorDe(req), cambios: req.body }));
      } catch (e) { responderError(res, e); }
    },
  );

  router.servicio = servicio;
  return router;
}

export default createRouter;
