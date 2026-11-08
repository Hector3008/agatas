// Tipos de documento del servicio. Los registra createRouter al montarse.
// Prefijos propios (IA, PR): no chocan con PD, RC, DOC_ITEM (tobt) ni DP (topd).

export const MOTIVOS_CANCELACION = Object.freeze([
  "se_arrepintio",
  "no_respondio",
  "error",
  "otro",
]);

/**
 * Intercambio entre dos jugadores.
 * propuesto → aceptado → completado; cancelado y vencido son finales.
 * El servicio (5.80) mueve estos estados con sistema: true, porque los
 * jugadores no son personal con permisos de estación.
 */
export const TIPO_INTERCAMBIO = Object.freeze({
  tipo: "intercambio",
  prefijo: "IA",
  estadoInicial: "propuesto",
  transiciones: {
    propuesto: ["aceptado", "cancelado", "vencido"],
    aceptado: ["completado", "cancelado", "vencido"],
  },
  motivos: {
    cancelado: [...MOTIVOS_CANCELACION],
    vencido: ["sin_respuesta"],
  },
});

export const MOTIVOS_ANULACION_PREMIO = Object.freeze(["error", "fraude", "otro"]);

/**
 * Premio ganado: pendiente → entregado (lo valida el mesero), o anulado.
 * Una vez por partida y por premio (se garantiza en 5.80).
 */
export const TIPO_PREMIO = Object.freeze({
  tipo: "premio",
  prefijo: "PR",
  estadoInicial: "pendiente",
  transiciones: {
    pendiente: ["entregado", "anulado"],
  },
  permisos: {
    entregado: "juego:validar",
    anulado: "juego:validar",
  },
  motivos: {
    anulado: [...MOTIVOS_ANULACION_PREMIO],
  },
});
