import express from "express";
import { TIPO_INTERCAMBIO, TIPO_PREMIO } from "./tipos.js";
import { crearModelos } from "./modelo.js";
import { crearServicio, ErrorAgatas } from "./servicio.js";
import { crearPartidas } from "./partidas.js";
import { crearIntercambios } from "./intercambios.js";
import { crearPremios } from "./premios.js";
import { crearRetiros } from "./retiros.js";
import { crearRouterPublico } from "./http-publico.js";
import { crearRouterStaff } from "./http-staff.js";
import { crearFront } from "./front.js";
import { manejar, middlewareCsrf } from "./http.js";
import { PERMISOS } from "./roles.js";

export { TIPO_INTERCAMBIO, TIPO_PREMIO, MOTIVOS_CANCELACION } from "./tipos.js";
export * from "./config.js";
export { MODOS_REINICIO, REINICIO_POR_DEFECTO, ultimoLimite, vigenteDesde, textoReinicio } from "./reinicio.js";
export { PERMISOS, PLANTILLA_ROLES } from "./roles.js";
export { crearServicio, ErrorAgatas } from "./servicio.js";
export { armarMano, coloresDistintos, estadoPremios } from "./juego.js";

/**
 * createRouter({ core }): registra los tipos de documento, crea el modelo y
 * devuelve el router de /agatas. No abre conexiones y trae su express.json().
 */
export function createRouter({ core, dist } = {}) {
  if (!core?.documentos || !core?.model || !core?.autenticar || !core?.requierePermiso) {
    throw new Error("agatas necesita el núcleo (core) con documentos, auth y permisos");
  }
  core.documentos.registrarTipo(TIPO_INTERCAMBIO);
  core.documentos.registrarTipo(TIPO_PREMIO);

  const M = crearModelos(core);
  const servicio = crearServicio({ core, Config: M.Config });
  const partidas = crearPartidas({ M, configDe: servicio.configDe });
  const intercambios = crearIntercambios({ M, documentos: core.documentos, configDe: servicio.configDe, partidas });
  const premios = crearPremios({ M, documentos: core.documentos, configDe: servicio.configDe });
  const retiros = crearRetiros({ M, partidas, intercambios, premios, configDe: servicio.configDe });

  const router = express.Router();
  router.use(express.json());

  router.get("/estado", (_req, res) => {
    res.json({ servicio: "agatas", version: "0.5.0", ok: true });
  });

  // `exigirCsrf` del núcleo lanza en vez de llamar a next(): middlewareCsrf lo adapta.
  const csrf = middlewareCsrf(core);
  const actorDe = (req) => ({ usuarioId: req.auth.usuarioId, permisos: req.rol?.permisos ?? [] });

  router.get(
    "/config",
    core.autenticar({ requiereEmpresa: true }),
    core.requierePermiso(PERMISOS.configurar),
    manejar(async (req, res) => {
      res.json(await servicio.leer({ empresaId: req.auth.empresaId, actor: actorDe(req) }));
    }),
  );

  router.put(
    "/config",
    core.autenticar({ requiereEmpresa: true }),
    csrf,
    core.requierePermiso(PERMISOS.configurar),
    manejar(async (req, res) => {
      res.json(await servicio.guardar({ empresaId: req.auth.empresaId, actor: actorDe(req), cambios: req.body }));
    }),
  );

  router.use("/staff", crearRouterStaff({ core, premios, retiros }));
  // Front del jugador (5.81): /app/?e=<slug>. Con barra final; sin ella redirige.
  router.get("/app", (req, res, next) => {
    const [ruta, consulta] = req.originalUrl.split("?");
    if (ruta.endsWith("/")) return next();
    res.redirect(301, `${ruta}/${consulta ? `?${consulta}` : ""}`);
  });
  router.use("/app", crearFront({ dist }));
  router.use("/p/:slug", crearRouterPublico({ core, servicio, partidas, intercambios, premios }));

  // Índices únicos listos antes de atender (el gateway puede esperar a `router.listo`).
  router.listo = Promise.all(Object.values(M).map((m) => m.init?.())).then(() => undefined);
  router.servicio = servicio;
  router.juego = { partidas, intercambios, premios, retiros };
  return router;
}

export default createRouter;
