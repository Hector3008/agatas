import { ErrorConfig } from "./config.js";
import { ErrorAgatas } from "./servicio.js";

const STATUS_DOCUMENTO = {
  DOCUMENTO_NO_ENCONTRADO: 404,
  CONFLICTO_VERSION: 409,
  TRANSICION_INVALIDA: 409,
  ESTADO_NO_EDITABLE: 409,
  PERMISO_INSUFICIENTE: 403,
};

export function responderError(res, error) {
  if (res.headersSent) return;
  if (error instanceof ErrorConfig || error instanceof ErrorAgatas) {
    return res.status(error.status).json({ error: error.codigo, mensaje: error.message, campo: error.campo ?? undefined });
  }
  if (error?.name === "ErrorDocumento") {
    return res.status(STATUS_DOCUMENTO[error.codigo] ?? 400).json({ error: error.codigo, mensaje: error.message });
  }
  if (typeof error?.status === "number" && error.codigo) {
    return res.status(error.status).json({ error: error.codigo, mensaje: error.message });
  }
  if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
    return res.status(400).json({ error: "DATOS_INVALIDOS", mensaje: "Cuerpo inválido" });
  }
  console.error("[agatas]", error);
  return res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Error inesperado" });
}

/** Envuelve un manejador async: cualquier fallo sale por responderError. */
export const manejar = (fn) => async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    await fn(req, res);
  } catch (e) {
    responderError(res, e);
  }
};

/**
 * `core.auth.exigirCsrf(req)` no es un middleware: lanza si falta la cabecera
 * `x-requested-with` en una petición que escribe. Aquí se convierte en uno.
 */
export function middlewareCsrf(core) {
  const exigir = core.auth?.exigirCsrf;
  if (typeof exigir !== "function") {
    throw new Error("agatas necesita core.auth.exigirCsrf (actualiza el núcleo)");
  }
  return (req, res, next) => {
    try {
      exigir.call(core.auth, req);
      next();
    } catch (e) {
      responderError(res, e);
    }
  };
}
