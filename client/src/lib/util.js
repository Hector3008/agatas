// Lógica pura del front (sin React ni DOM): se prueba con `node --test`.

const ALFABETO = /[^A-Z2-9]/g;

/** Texto legible sobre un color de fondo (blanco o casi negro) según su luminancia. */
export function contraste(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return "#1b1410";
  const n = parseInt(m[1], 16);
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  return L > 0.4 ? "#1b1410" : "#ffffff";
}

/** Saca la invitación de lo que haya pegado o escaneado: el código suelto o un enlace con `i=`. */
export function extraerInvitacion(texto) {
  if (typeof texto !== "string") return null;
  let crudo = texto.trim();
  const enlace = /[?&#]i=([^&#\s]+)/i.exec(crudo);
  if (enlace) crudo = decodeURIComponent(enlace[1]);
  const limpio = crudo.toUpperCase().replace(ALFABETO, "");
  return limpio.length === 8 ? limpio : null;
}

/** Parámetros del enlace del juego: `?e=<slug>` y, si viene de un QR de invitación, `&i=<código>`. */
export function leerParametros(search) {
  const p = new URLSearchParams(search);
  const slug = (p.get("e") ?? "").trim().toLowerCase();
  return { slug: /^[a-z0-9][a-z0-9-]{0,60}$/.test(slug) ? slug : null, invitacion: extraerInvitacion(p.get("i") ?? "") };
}

/** Enlace que va dentro del QR de una invitación: misma página, con la empresa y el código. */
export function enlaceInvitacion(href, slug, invitacion) {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("e", slug);
  u.searchParams.set("i", invitacion);
  return u.toString();
}

export function enlaceJuego(href, slug) {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("e", slug);
  return u.toString();
}

export const restante = (venceMs, ahora = Date.now()) => Math.max(0, Math.ceil((venceMs - ahora) / 1000));

export function reloj(segundos) {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const capitalizar = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");

/**
 * Qué pantalla de intercambio toca según lo que responde el servidor.
 *  vista previa (soy un tercero), esperando pareja, preguntas, listo, cerrado.
 */
export function fase(v) {
  if (!v) return "cargando";
  if (!v.participa) return v.estado === "propuesto" ? "oferta" : "cerrado";
  if (v.estado === "propuesto") return "esperando";
  if (v.estado === "aceptado") return "preguntas";
  if (v.estado === "completado") return "listo";
  return "cerrado";
}

const MOTIVOS = {
  sin_respuesta: "Se acabó el tiempo.",
  se_arrepintio: "Alguien canceló el intercambio.",
  error: "Hubo un problema y se canceló.",
  otro: "El intercambio se canceló.",
};
export const textoMotivo = (m) => MOTIVOS[m] ?? "Este intercambio ya no está disponible.";

/** Mensaje para la persona: lo que dice el servidor (ya viene en español) o uno propio si no hubo respuesta. */
export function mensajeError(e) {
  if (e?.red) return "No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.";
  return e?.mensaje || "Ocurrió un error inesperado.";
}

/** Cuántos colores distintos faltan para un premio (0 si ya los tiene). */
export const faltan = (distintos, umbral) => Math.max(0, umbral - distintos);

/** Ágatas de la mano con las que puedo unirme a una oferta: libres y de otro color que el ofrecido. */
export function elegibles(mano, colorOfrecido) {
  return mano.filter((a) => !a.reservada && a.colorId !== colorOfrecido);
}

/** Resumen de colores para mostrar «Naranja ×5, Crema ×1». */
export function resumenColores(mano) {
  const cuenta = new Map();
  for (const a of mano) cuenta.set(a.colorId, (cuenta.get(a.colorId) ?? 0) + 1);
  return [...cuenta].map(([colorId, n]) => ({ colorId, n }));
}
