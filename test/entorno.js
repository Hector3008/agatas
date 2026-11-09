// Entorno de pruebas: núcleo falso (modelos en memoria + motor de documentos REAL del núcleo),
// un Express con agatas montado en /agatas y clientes HTTP con cookies.
import { createServer } from "node:http";
import express from "express";
import mongoose from "mongoose";
import { permite } from "core";
import { crearServicioDocumentos } from "core/src/documentos/index.js";
import { documentoSchema, documentoVersionSchema, contadorSchema } from "core/src/documentos/modelos.js";
import { empresaSchema } from "core/src/modelos/empresa.js";
import { crearBaseFalsa } from "./fake-db.js";
import { createRouter } from "../src/index.js";

export const oid = () => new mongoose.Types.ObjectId();

export async function crearEntorno({ jitter = false, usuarios = {} } = {}) {
  const base = crearBaseFalsa({ jitter });
  const Documento = base.model("Documento", documentoSchema, "documentos");
  const DocumentoVersion = base.model("DocumentoVersion", documentoVersionSchema, "documento_versiones");
  const Contador = base.model("Contador", contadorSchema, "contadores");
  const Empresa = base.model("Empresa", empresaSchema, "empresas");
  const documentos = crearServicioDocumentos({ Documento, DocumentoVersion, Contador });

  // Empresas: se insertan sin tenancy (el modelo real es global).
  const empresas = {};
  async function nuevaEmpresa(slug, { activa = true, servicios = [{ codigo: "agatas", activa: true }] } = {}) {
    const _id = oid();
    base.datos.get("empresas").push({ _id, slug, activa, servicios, nombre: slug });
    empresas[slug] = String(_id);
    return String(_id);
  }
  // El modelo Empresa falso no filtra por empresa: lo hacemos pasar por global.
  const EmpresaGlobal = {
    findOne: (f) => ({
      lean: async () => base.datos.get("empresas").find((e) => Object.entries(f).every(([k, v]) => e[k] === v)) ?? null,
    }),
  };

  const sesiones = new Map(); // cabecera x-user → { usuarioId, empresaId, permisos }
  const core = {
    model: base.model,
    documentos,
    modelos: { Empresa: EmpresaGlobal },
    auth: {
      exigirCsrf(req) {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
        if (!req.headers["x-requested-with"]) {
          const e = new Error("falta la cabecera x-requested-with");
          e.codigo = "CSRF";
          e.status = 403;
          throw e;
        }
      },
    },
    autenticar: () => (req, res, next) => {
      const s = sesiones.get(req.headers["x-user"]);
      if (!s) return res.status(401).json({ error: "SIN_SESION" });
      req.auth = { usuarioId: s.usuarioId, empresaId: s.empresaId };
      req.rol = { permisos: s.permisos };
      next();
    },
    requierePermiso: (p) => (req, res, next) =>
      permite(req.rol?.permisos ?? [], p) ? next() : res.status(403).json({ error: "PERMISO_INSUFICIENTE" }),
    // Sesión de cliente simulada: la cabecera x-cliente trae el id.
    cuentasCliente: {
      autenticarCliente: ({ empresaDe }) => (req, res, next) => {
        const id = req.headers["x-cliente"];
        if (!id) return res.status(401).json({ error: "SIN_SESION" });
        empresaDe(req);
        req.cliente = { clienteId: id };
        next();
      },
    },
  };

  const router = createRouter({ core });
  const app = express();
  app.set("trust proxy", true);
  app.use("/agatas", router);
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/agatas`;

  function personal(nombre, empresaSlug, permisos) {
    sesiones.set(nombre, { usuarioId: String(oid()), empresaId: empresas[empresaSlug], permisos });
  }

  // Cliente HTTP con su propia cookie (un jugador o un mesero).
  function cliente({ ip, user, clienteCuenta } = {}) {
    let cookie = null;
    async function pedir(metodo, ruta, cuerpo, { sinCsrf = false, cabeceras = {} } = {}) {
      const h = { ...cabeceras };
      if (cuerpo !== undefined) h["content-type"] = "application/json";
      if (!sinCsrf && metodo !== "GET") h["x-requested-with"] = "fetch";
      if (cookie) h.cookie = cookie;
      if (ip) h["x-forwarded-for"] = ip;
      if (user) h["x-user"] = user;
      if (clienteCuenta) h["x-cliente"] = clienteCuenta;
      const r = await fetch(url + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
      const sc = r.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      const txt = await r.text();
      let cuerpoRes = null;
      try { cuerpoRes = txt ? JSON.parse(txt) : null; } catch { cuerpoRes = txt; }
      return { status: r.status, body: cuerpoRes, setCookie: sc };
    }
    return {
      get: (ruta, o) => pedir("GET", ruta, undefined, o),
      post: (ruta, cuerpo = {}, o) => pedir("POST", ruta, cuerpo, o),
      put: (ruta, cuerpo = {}, o) => pedir("PUT", ruta, cuerpo, o),
      get cookie() { return cookie; },
      set cookie(v) { cookie = v; },
    };
  }

  return {
    base, core, router, url, documentos, nuevaEmpresa, empresas, personal, cliente,
    cerrar: () => new Promise((r) => server.close(r)),
  };
}

/** Configuración completa de pruebas: las 36 preguntas escritas. */
export function preguntasCompletas(config) {
  const preguntas = {};
  for (const c of config.colores) for (let n = 1; n <= config.agatasPorColor; n++) preguntas[`${c.id}-${n}`] = `¿Pregunta ${c.id} ${n}?`;
  return preguntas;
}
