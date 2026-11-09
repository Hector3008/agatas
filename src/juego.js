// Reglas puras del juego (sin base de datos): armar la mano, contar colores, ver premios.
import { codigoAgata } from "./config.js";
import { idCorto } from "./util.js";

/** Mano inicial: `manoPorJugador` agatas del color asignado, numeradas 1..n. */
export function armarMano(config, colorId, nuevoId = idCorto) {
  if (!config.colores.some((c) => c.id === colorId)) throw new Error(`color desconocido: ${colorId}`);
  return Array.from({ length: config.manoPorJugador }, (_, i) => ({
    aid: nuevoId(),
    codigo: codigoAgata(colorId, i + 1),
    colorId,
    reservadaPor: null,
    reservadaTs: null,
  }));
}

/** Colores distintos que hay hoy en la mano (el color propio cuenta). */
export function coloresDistintos(mano) {
  return [...new Set(mano.map((m) => m.colorId))];
}

/** Estado de cada premio para una mano: bloqueado, disponible o reclamado. */
export function estadoPremios(config, mano, reclamados) {
  const n = coloresDistintos(mano).length;
  return config.premios.map((p) => ({
    id: p.id,
    umbral: p.umbral,
    nombre: p.nombre,
    descripcion: p.descripcion,
    estado: reclamados.has(p.id) ? "reclamado" : n >= p.umbral ? "disponible" : "bloqueado",
  }));
}
