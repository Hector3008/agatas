// Utilidades sin dependencias: tokens, códigos cortos, cookies y contadores en memoria.
import { createHash, randomBytes, randomInt } from "node:crypto";

export const generarToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

// Sin I, O, 0 ni 1: se dictan y se teclean sin confundirlos.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function codigoCorto(largo = 8) {
  let s = "";
  for (let i = 0; i < largo; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

/** Deja solo letras y números en mayúsculas («abcd-efgh» → «ABCDEFGH»). */
export const normalizarCodigo = (t) =>
  typeof t === "string" ? t.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";

export const formatearCodigo = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

export const idCorto = () => randomBytes(9).toString("base64url");

export function leerCookie(cabecera, nombre) {
  if (!cabecera || typeof cabecera !== "string") return null;
  for (const par of cabecera.split(";")) {
    const i = par.indexOf("=");
    if (i < 0 || par.slice(0, i).trim() !== nombre) continue;
    try {
      return decodeURIComponent(par.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function serializarCookie(nombre, valor, { maxAgeSeg, secure = false } = {}) {
  const p = [`${nombre}=${encodeURIComponent(valor)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) p.push("Secure");
  if (maxAgeSeg !== undefined) p.push(`Max-Age=${Math.floor(maxAgeSeg)}`);
  return p.join("; ");
}

/**
 * Contador de ventana fija en memoria. `golpe(clave, max)` devuelve true si todavía cabe
 * (y lo cuenta) o false si ya se llegó al tope. Vive en el proceso: se reinicia con el
 * servidor y no se comparte entre instancias (igual que los limitadores del core).
 */
export function crearContador({ ventanaMs, ahora = () => Date.now() }) {
  const mapa = new Map();
  const podar = (t) => {
    if (mapa.size < 5000) return;
    for (const [k, e] of mapa) if (t - e.desde >= ventanaMs) mapa.delete(k);
  };
  const vigente = (clave, t) => {
    const e = mapa.get(clave);
    return e && t - e.desde < ventanaMs ? e : null;
  };
  return {
    golpe(clave, max) {
      const t = ahora();
      const e = vigente(clave, t);
      if (e) {
        if (e.n >= max) return false;
        e.n += 1;
        return true;
      }
      podar(t);
      mapa.set(clave, { n: 1, desde: t });
      return true;
    },
    /** Cuántos golpes lleva la clave en la ventana (sin contar uno nuevo). */
    cuenta(clave) {
      return vigente(clave, ahora())?.n ?? 0;
    },
  };
}
