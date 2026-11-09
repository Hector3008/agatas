import express from "express";
import { vistaPublica } from "./config.js";
import { ErrorAgatas } from "./servicio.js";
import { manejar, middlewareCsrf, responderError } from "./http.js";
import { leerCookie, serializarCookie } from "./util.js";

const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const noEncontrado = (res) => res.status(404).json({ error: "NO_ENCONTRADO", mensaje: "No encontrado" });

/**
 * Rutas del jugador, bajo /p/:slug. La empresa sale del slug; el jugador, de su cookie
 * de partida (`ag_<slug>`, token opaco: en la base solo está su hash).
 */
export function crearRouterPublico({ core, servicio, partidas, intercambios, premios }) {
  const csrf = middlewareCsrf(core);
  const Empresa = core.modelos?.Empresa;
  if (!Empresa) throw new Error("agatas necesita core.modelos.Empresa");
  const produccion = () => process.env.NODE_ENV === "production";

  const r = express.Router({ mergeParams: true });

  // Una empresa inexistente, apagada o sin el servicio activado responde igual: 404.
  r.use(async (req, res, next) => {
    try {
      const slug = String(req.params.slug ?? "").toLowerCase();
      const emp = RE_SLUG.test(slug) ? await Empresa.findOne({ slug, activa: true }).lean() : null;
      const activo = emp?.servicios?.some((s) => s.codigo === "agatas" && s.activa);
      if (!activo) return noEncontrado(res);
      req.empresa = { id: String(emp._id), slug };
      next();
    } catch (e) {
      next(e);
    }
  });

  const cookieNombre = (req) => `ag_${req.empresa.slug}`;
  const empresaDe = (req) => req.empresa;

  async function jugador(req) {
    const token = leerCookie(req.headers.cookie, cookieNombre(req));
    return partidas.porToken({ empresaId: req.empresa.id, token });
  }

  // Con requiereCuenta se usa la sesión de cliente del núcleo (cookie propia, ya validada allí).
  async function clienteDe(req, res) {
    const config = await servicio.configDe({ empresaId: req.empresa.id });
    if (!config.requiereCuenta) return { ok: true, clienteId: null };
    const mw = core.cuentasCliente?.autenticarCliente?.({ empresaDe });
    if (!mw) throw new ErrorAgatas("CUENTAS_NO_DISPONIBLES", "Este juego pide cuenta pero el núcleo no la ofrece", 500);
    const pasa = await new Promise((resolve) => {
      res.once("close", () => resolve(false));
      mw(req, res, () => resolve(true));
    });
    return { ok: pasa, clienteId: pasa ? req.cliente.clienteId : null };
  }

  async function vistaCompleta(req, partida) {
    const empresaId = req.empresa.id;
    const config = await servicio.configDe({ empresaId });
    const sano = await intercambios.sanear({ empresaId, partida });
    const reclamados = await premios.reclamadosDe({ empresaId, partidaId: sano.partida._id });
    return partidas.vista({ partida: sano.partida, config, abiertos: sano.abiertos, reclamados });
  }

  r.get("/info", manejar(async (req, res) => {
    const config = await servicio.configDe({ empresaId: req.empresa.id });
    res.json(vistaPublica(config));
  }));

  r.post("/partida", express.json({ limit: "4kb" }), csrf, manejar(async (req, res) => {
    const { ok, clienteId } = await clienteDe(req, res);
    if (!ok) return; // el núcleo ya respondió (sin sesión)
    const { token, partida, nueva } = await partidas.crear({
      empresaId: req.empresa.id,
      apodo: req.body?.apodo,
      clienteId,
      ip: req.ip,
    });
    const config = await servicio.configDe({ empresaId: req.empresa.id });
    res.append(
      "Set-Cookie",
      serializarCookie(cookieNombre(req), token, {
        maxAgeSeg: config.reglas.cookieDias * 86400,
        secure: produccion(),
      }),
    );
    res.status(nueva ? 201 : 200).json(await vistaCompleta(req, partida));
  }));

  r.get("/partida", manejar(async (req, res) => {
    res.json(await vistaCompleta(req, await jugador(req)));
  }));

  r.post("/intercambios", express.json({ limit: "4kb" }), csrf, manejar(async (req, res) => {
    const partida = await jugador(req);
    const v = await intercambios.proponer({ empresaId: req.empresa.id, partida, aid: String(req.body?.aid ?? "") });
    res.status(201).json(v);
  }));

  r.post("/intercambios/unirse", express.json({ limit: "4kb" }), csrf, manejar(async (req, res) => {
    const partida = await jugador(req);
    res.json(
      await intercambios.unirse({
        empresaId: req.empresa.id,
        partida,
        invitacion: String(req.body?.invitacion ?? ""),
        aid: String(req.body?.aid ?? ""),
      }),
    );
  }));

  r.get("/intercambios/:invitacion", manejar(async (req, res) => {
    const partida = await jugador(req);
    res.json(await intercambios.ver({ empresaId: req.empresa.id, partida, invitacion: req.params.invitacion }));
  }));

  r.post("/intercambios/:invitacion/confirmar", csrf, manejar(async (req, res) => {
    const partida = await jugador(req);
    res.json(await intercambios.confirmar({ empresaId: req.empresa.id, partida, invitacion: req.params.invitacion }));
  }));

  r.post("/intercambios/:invitacion/cancelar", csrf, manejar(async (req, res) => {
    const partida = await jugador(req);
    res.json(await intercambios.cancelar({ empresaId: req.empresa.id, partida, invitacion: req.params.invitacion }));
  }));

  r.post("/premios", express.json({ limit: "4kb" }), csrf, manejar(async (req, res) => {
    const partida = await jugador(req);
    res.status(201).json(
      await premios.reclamar({ empresaId: req.empresa.id, partida, premioId: String(req.body?.premioId ?? "") }),
    );
  }));

  // Fallos de los middlewares (p. ej. la búsqueda de la empresa) con el mismo formato de error.
  r.use((err, _req, res, _next) => responderError(res, err));

  return r;
}
