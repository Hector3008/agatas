// Configuración del juego, por empresa. Lógica pura: sin base de datos.
// Todo lo que el admin puede cambiar vive aquí y se valida aquí.

import { MODOS_REINICIO, REINICIO_POR_DEFECTO, minutosDeHora, zonaValida } from "./reinicio.js";

export const LIMITES = Object.freeze({
  coloresMin: 2,
  coloresMax: 12,
  agatasPorColorMax: 50,
  manoMax: 50,
  premiosMax: 10,
  preguntaMax: 200,
  textoMax: 4000,
  nombreMax: 40,
});

// Rangos de las reglas del juego (`config.reglas`).
export const LIMITES_REGLAS = Object.freeze({
  partidasPorIpHora: [1, 1000],
  intercambiosPorHora: [1, 200],
  ofertaVenceSeg: [30, 3600],
  reservaVenceSeg: [60, 7200],
  cookieDias: [1, 365],
});

export const CONFIG_POR_DEFECTO = Object.freeze({
  personaje: { singular: "agata", plural: "agatas" },
  colores: [
    { id: "naranja", nombre: "Naranja", hex: "#f28c28" },
    { id: "crema", nombre: "Crema", hex: "#e8dcb5" },
    { id: "verde", nombre: "Verde", hex: "#5a8f2e" },
    { id: "cafe", nombre: "Café", hex: "#8b5a2b" },
    { id: "amarillo", nombre: "Amarillo", hex: "#e8b923" },
    { id: "rojo", nombre: "Rojo", hex: "#d6402b" },
  ],
  agatasPorColor: 6,
  manoPorJugador: 6,
  requiereCuenta: false,
  premios: [
    { id: "p3", umbral: 3, nombre: "3 stickers", descripcion: "" },
    { id: "p5", umbral: 5, nombre: "1 agata armable de papel", descripcion: "" },
    { id: "p6", umbral: 6, nombre: "10 % de descuento en tu próxima compra", descripcion: "" },
  ],
  preguntas: {},
  textos: { instrucciones: "", reglas: "" },
  // Reglas del juego (5.80). Los topes de IP son generosos: en un café todos comparten el WiFi.
  reglas: {
    partidasPorIpHora: 30, // partidas nuevas por IP y hora
    intercambiosPorHora: 12, // propuestas + aceptaciones por jugador y hora
    ofertaVenceSeg: 180, // una oferta sin pareja se cae a los 3 minutos
    reservaVenceSeg: 900, // aceptado pero sin confirmar por los dos: se cae a los 15 minutos
    cookieDias: 30, // duración de la cookie de partida
  },
  // Reinicio programado de las partidas (5.83). Por defecto nunca: nada cambia para quien ya tenía el juego.
  reinicio: { ...REINICIO_POR_DEFECTO },
});

export class ErrorConfig extends Error {
  constructor(mensaje, campo) {
    super(mensaje);
    this.name = "ErrorConfig";
    this.codigo = "DATOS_INVALIDOS";
    this.status = 400;
    this.campo = campo ?? null;
  }
}

const RE_ID = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const RE_HEX = /^#[0-9a-f]{6}$/;

function texto(valor, campo, max, { vacio = false } = {}) {
  if (typeof valor !== "string") throw new ErrorConfig(`${campo}: debe ser texto`, campo);
  const t = valor.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  if (!vacio && !t) throw new ErrorConfig(`${campo}: no puede estar vacío`, campo);
  if (t.length > max) throw new ErrorConfig(`${campo}: máximo ${max} caracteres`, campo);
  return t;
}

function entero(valor, campo, min, max) {
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new ErrorConfig(`${campo}: debe ser un entero entre ${min} y ${max}`, campo);
  }
  return valor;
}

/** Código de una agata: «<colorId>-<n>», con n desde 1. */
export function codigoAgata(colorId, n) {
  return `${colorId}-${n}`;
}

/** Todas las agatas que define una configuración, en orden. */
export function agatasDe(config) {
  const lista = [];
  for (const c of config.colores) {
    for (let n = 1; n <= config.agatasPorColor; n++) {
      lista.push({ codigo: codigoAgata(c.id, n), colorId: c.id, numero: n });
    }
  }
  return lista;
}

/** Códigos de agata que todavía no tienen pregunta. */
export function faltantes(config) {
  return agatasDe(config)
    .filter((a) => !config.preguntas[a.codigo])
    .map((a) => a.codigo);
}

/**
 * Valida y normaliza una configuración completa (la que llega del admin o la
 * ya guardada). Devuelve un objeto nuevo; nunca modifica el de entrada.
 */
export function validarConfig(entrada) {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new ErrorConfig("La configuración debe ser un objeto");
  }
  const permitidas = new Set([
    "personaje", "colores", "agatasPorColor", "manoPorJugador",
    "requiereCuenta", "premios", "preguntas", "textos", "reglas", "reinicio",
  ]);
  for (const k of Object.keys(entrada)) {
    if (!permitidas.has(k)) throw new ErrorConfig(`Campo desconocido: ${k}`, k);
  }

  const p = entrada.personaje;
  if (!p || typeof p !== "object") throw new ErrorConfig("personaje: faltan singular y plural", "personaje");
  const personaje = {
    singular: texto(p.singular, "personaje.singular", LIMITES.nombreMax),
    plural: texto(p.plural, "personaje.plural", LIMITES.nombreMax),
  };

  if (!Array.isArray(entrada.colores)) throw new ErrorConfig("colores: debe ser una lista", "colores");
  if (entrada.colores.length < LIMITES.coloresMin || entrada.colores.length > LIMITES.coloresMax) {
    throw new ErrorConfig(
      `colores: entre ${LIMITES.coloresMin} y ${LIMITES.coloresMax}`, "colores",
    );
  }
  const idsColor = new Set();
  const colores = entrada.colores.map((c, i) => {
    if (!c || typeof c !== "object") throw new ErrorConfig(`colores[${i}]: inválido`, "colores");
    const id = texto(c.id, `colores[${i}].id`, 24).toLowerCase();
    if (!RE_ID.test(id)) {
      throw new ErrorConfig(`colores[${i}].id: minúsculas, números, _ y - (sin espacios)`, "colores");
    }
    if (idsColor.has(id)) throw new ErrorConfig(`colores: id repetido «${id}»`, "colores");
    idsColor.add(id);
    const hex = texto(c.hex, `colores[${i}].hex`, 7).toLowerCase();
    if (!RE_HEX.test(hex)) throw new ErrorConfig(`colores[${i}].hex: use #rrggbb`, "colores");
    return { id, nombre: texto(c.nombre, `colores[${i}].nombre`, LIMITES.nombreMax), hex };
  });

  const agatasPorColor = entero(entrada.agatasPorColor, "agatasPorColor", 1, LIMITES.agatasPorColorMax);
  const manoPorJugador = entero(entrada.manoPorJugador, "manoPorJugador", 1, LIMITES.manoMax);
  if (manoPorJugador > agatasPorColor) {
    throw new ErrorConfig(
      "manoPorJugador no puede superar agatasPorColor (la mano se arma con las agatas de su color)",
      "manoPorJugador",
    );
  }

  if (typeof entrada.requiereCuenta !== "boolean") {
    throw new ErrorConfig("requiereCuenta: debe ser verdadero o falso", "requiereCuenta");
  }

  if (!Array.isArray(entrada.premios) || entrada.premios.length > LIMITES.premiosMax) {
    throw new ErrorConfig(`premios: lista de hasta ${LIMITES.premiosMax}`, "premios");
  }
  const idsPremio = new Set();
  const umbrales = new Set();
  const premios = entrada.premios.map((pr, i) => {
    if (!pr || typeof pr !== "object") throw new ErrorConfig(`premios[${i}]: inválido`, "premios");
    const id = texto(pr.id, `premios[${i}].id`, 24).toLowerCase();
    if (!RE_ID.test(id)) throw new ErrorConfig(`premios[${i}].id: formato inválido`, "premios");
    if (idsPremio.has(id)) throw new ErrorConfig(`premios: id repetido «${id}»`, "premios");
    idsPremio.add(id);
    const umbral = entero(pr.umbral, `premios[${i}].umbral`, 1, colores.length);
    if (umbrales.has(umbral)) throw new ErrorConfig(`premios: dos premios con umbral ${umbral}`, "premios");
    umbrales.add(umbral);
    return {
      id,
      umbral,
      nombre: texto(pr.nombre, `premios[${i}].nombre`, 80),
      descripcion: texto(pr.descripcion ?? "", `premios[${i}].descripcion`, 300, { vacio: true }),
    };
  }).sort((a, b) => a.umbral - b.umbral);

  const validos = new Set(
    colores.flatMap((c) => Array.from({ length: agatasPorColor }, (_, n) => codigoAgata(c.id, n + 1))),
  );
  const preguntas = {};
  const origen = entrada.preguntas ?? {};
  if (typeof origen !== "object" || Array.isArray(origen)) {
    throw new ErrorConfig("preguntas: debe ser un objeto código → pregunta", "preguntas");
  }
  for (const [codigo, valor] of Object.entries(origen)) {
    if (!validos.has(codigo)) {
      throw new ErrorConfig(`preguntas: «${codigo}» no es una ${personaje.singular} de esta configuración`, "preguntas");
    }
    const t = texto(valor, `preguntas.${codigo}`, LIMITES.preguntaMax, { vacio: true });
    if (t) preguntas[codigo] = t;
  }

  const tx = entrada.textos ?? {};
  const textos = {
    instrucciones: texto(tx.instrucciones ?? "", "textos.instrucciones", LIMITES.textoMax, { vacio: true }),
    reglas: texto(tx.reglas ?? "", "textos.reglas", LIMITES.textoMax, { vacio: true }),
  };

  // Las configuraciones guardadas antes de 5.80 no traen `reglas`: se completan con los valores por defecto.
  const rg = entrada.reglas ?? {};
  if (typeof rg !== "object" || Array.isArray(rg)) throw new ErrorConfig("reglas: debe ser un objeto", "reglas");
  for (const k of Object.keys(rg)) {
    if (!(k in LIMITES_REGLAS)) throw new ErrorConfig(`reglas: campo desconocido «${k}»`, "reglas");
  }
  const reglas = {};
  for (const [k, [min, max]] of Object.entries(LIMITES_REGLAS)) {
    reglas[k] = entero(rg[k] ?? CONFIG_POR_DEFECTO.reglas[k], `reglas.${k}`, min, max);
  }

  const rn = entrada.reinicio ?? {};
  if (typeof rn !== "object" || Array.isArray(rn)) throw new ErrorConfig("reinicio: debe ser un objeto", "reinicio");
  for (const k of Object.keys(rn)) {
    if (!(k in REINICIO_POR_DEFECTO)) throw new ErrorConfig(`reinicio: campo desconocido «${k}»`, "reinicio");
  }
  const modo = rn.modo ?? REINICIO_POR_DEFECTO.modo;
  if (!MODOS_REINICIO.includes(modo)) throw new ErrorConfig("reinicio.modo: nunca, diario o semanal", "reinicio");
  const hora = rn.hora ?? REINICIO_POR_DEFECTO.hora;
  if (minutosDeHora(hora) === null) throw new ErrorConfig("reinicio.hora: use HH:MM (de 00:00 a 23:59)", "reinicio");
  const zona = rn.zona ?? REINICIO_POR_DEFECTO.zona;
  if (!zonaValida(zona)) throw new ErrorConfig("reinicio.zona: zona horaria desconocida (ej. America/Lima)", "reinicio");
  const diaSemana = entero(rn.diaSemana ?? REINICIO_POR_DEFECTO.diaSemana, "reinicio.diaSemana", 0, 6);
  const reinicio = { modo, hora, diaSemana, zona };

  return { personaje, colores, agatasPorColor, manoPorJugador, requiereCuenta: entrada.requiereCuenta, premios, preguntas, textos, reglas, reinicio };
}

/** Avisos que no impiden guardar pero dejan el juego cojo (el admin debería verlos). */
export function advertencias(config) {
  const lista = [];
  for (const p of config.premios) {
    if (p.umbral > config.manoPorJugador) {
      lista.push({
        codigo: "PREMIO_INALCANZABLE",
        premioId: p.id,
        mensaje: `«${p.nombre}» pide ${p.umbral} colores distintos, pero la mano es de ${config.manoPorJugador}: nadie podrá ganarlo`,
      });
    }
  }
  return lista;
}

/** Une los cambios del admin sobre lo guardado (campo a campo) y valida el resultado. */
export function aplicarCambios(actual, cambios) {
  if (!cambios || typeof cambios !== "object" || Array.isArray(cambios)) {
    throw new ErrorConfig("El cuerpo debe ser un objeto con los campos a cambiar");
  }
  if (Object.keys(cambios).length === 0) throw new ErrorConfig("No hay nada que cambiar");
  const base = JSON.parse(JSON.stringify(actual ?? CONFIG_POR_DEFECTO));
  const fusion = { ...base };
  for (const [k, v] of Object.entries(cambios)) {
    if (k === "textos" && v && typeof v === "object" && !Array.isArray(v)) fusion.textos = { ...base.textos, ...v };
    else if (k === "reglas" && v && typeof v === "object" && !Array.isArray(v)) fusion.reglas = { ...CONFIG_POR_DEFECTO.reglas, ...base.reglas, ...v };
    else if (k === "reinicio" && v && typeof v === "object" && !Array.isArray(v)) fusion.reinicio = { ...CONFIG_POR_DEFECTO.reinicio, ...base.reinicio, ...v };
    else if (k === "personaje" && v && typeof v === "object" && !Array.isArray(v)) fusion.personaje = { ...base.personaje, ...v };
    else fusion[k] = v;
  }
  return validarConfig(fusion);
}

/**
 * Resumen que ve el jugador. Nunca incluye las preguntas de agatas ajenas:
 * eso se decide en 5.80; aquí solo sale lo público de la configuración.
 */
export function vistaPublica(config) {
  return {
    personaje: config.personaje,
    colores: config.colores,
    manoPorJugador: config.manoPorJugador,
    requiereCuenta: config.requiereCuenta,
    premios: config.premios.map(({ id, umbral, nombre, descripcion }) => ({ id, umbral, nombre, descripcion })),
    textos: config.textos,
    reinicio: config.reinicio,
    // Tiempos que el front necesita para mostrar cuenta atrás
    tiempos: { ofertaVenceSeg: config.reglas.ofertaVenceSeg, reservaVenceSeg: config.reglas.reservaVenceSeg },
  };
}
