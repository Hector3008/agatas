// Texto del reinicio programado para el jugador. Es el mismo que arma el servidor en src/reinicio.js
// (una prueba comprueba que no se desvíen).
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** «Las partidas se reinician todos los días a las 00:00.» o null si nunca se reinician. */
export function textoReinicio(reinicio) {
  if (reinicio?.modo === "diario") return `Las partidas se reinician todos los días a las ${reinicio.hora}.`;
  if (reinicio?.modo === "semanal") return `Las partidas se reinician cada ${DIAS[reinicio.diaSemana] ?? ""} a las ${reinicio.hora}.`;
  return null;
}
