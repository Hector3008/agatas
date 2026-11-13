// Lógica pura de la pantalla del mesero (5.82). Sin React ni DOM: se prueba con `node --test`.

/** Código de canje que escribió el mesero: mayúsculas, sin guion ni espacios. 8 caracteres o null. */
export function normalizarCanje(texto) {
  if (typeof texto !== "string") return null;
  const limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return limpio.length === 8 ? limpio : null;
}

/** «8X569XPL» → «8X56-9XPL» mientras se escribe (sin cortar lo que falta). */
export function formatearCanje(texto) {
  const limpio = String(texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;
}

export const ESTADOS_PREMIO = {
  pendiente: "Pendiente de entregar",
  entregado: "Entregado",
  anulado: "Anulado",
};

export const PESTANAS_LISTA = [
  ["pendiente", "Pendientes"],
  ["entregado", "Entregados"],
  ["anulado", "Anulados"],
];

/** Motivos que acepta el servidor al anular un código (no admite texto libre). */
export const MOTIVOS_ANULACION = [
  ["error", "Se emitió por error"],
  ["fraude", "Trampa o fraude"],
  ["otro", "Otro motivo"],
];

/** Texto para el mesero según lo que respondió el servidor. */
export function mensajeStaff(e) {
  if (!e) return "";
  if (e.red) return "Sin conexión. Revisa el internet e inténtalo de nuevo.";
  if (e.status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  if (e.status === 403) return "Tu usuario no tiene permiso para esto.";
  if (e.status === 429) return "Demasiados intentos. Espera un momento.";
  if (e.codigo === "CODIGO_NO_ENCONTRADO") return "Ese código no existe. Revisa que esté bien escrito.";
  if (e.codigo === "JUGADOR_NO_ENCONTRADO") return "Ese jugador ya no está en la lista.";
  if (e.codigo === "YA_PROCESADO") return e.mensaje || "Ese código ya fue procesado.";
  if (e.status >= 500) return "El servidor tuvo un problema. Inténtalo de nuevo.";
  return e.mensaje || "No se pudo completar la acción.";
}

/** ¿Hay que pedirle que entre? (sin sesión o sesión sin empresa) */
export const sinSesion = (e) => e?.status === 401;
export const sinPermiso = (e) => e?.status === 403;

/** Fecha corta para las listas: «hoy 14:05» o «8 nov 14:05». */
export function fechaCorta(iso, ahora = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === ahora.toDateString()) return `hoy ${hh}`;
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d.getDate()} ${MESES[d.getMonth()]} ${hh}`;
}
