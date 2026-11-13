// Reinicio programado de las partidas (5.83). Lógica pura, sin base de datos ni tareas programadas.
//
// En vez de «borrar a medianoche» (que exigiría un proceso programado que puede caerse o correr dos veces),
// una partida solo vale si se creó DESPUÉS del último límite de reinicio. El límite se calcula al momento
// con la hora de la empresa, así que un reinicio nunca se «pierde» aunque el servidor haya estado apagado.

export const MODOS_REINICIO = Object.freeze(["nunca", "diario", "semanal"]);

export const REINICIO_POR_DEFECTO = Object.freeze({
  modo: "nunca",
  hora: "00:00", // «HH:MM», hora de la empresa
  diaSemana: 1, // 0 = domingo … 6 = sábado (solo en modo semanal)
  zona: "America/Lima", // zona horaria IANA
});

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const nombreDia = (d) => NOMBRES_DIA[d] ?? "";

const formateadores = new Map();
function formateador(zona) {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formateadores.set(zona, f);
  }
  return f;
}

export function zonaValida(zona) {
  if (typeof zona !== "string" || !zona || zona.length > 64) return false;
  try {
    formateador(zona);
    return true;
  } catch {
    return false;
  }
}

/** Hora de pared de `ms` en `zona`, como si fuera UTC (año, mes, día, hora, minuto, segundo). */
function pared(zona, ms) {
  const p = {};
  for (const { type, value } of formateador(zona).formatToParts(new Date(ms))) p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Instante UTC en que la hora de pared de `zona` marca el año/mes/día/hora/minuto dados. */
function instante(zona, y, m, d, h, mi) {
  const objetivo = Date.UTC(y, m - 1, d, h, mi, 0);
  let guess = objetivo;
  for (let i = 0; i < 3; i++) {
    const desfase = pared(zona, guess) - guess; // cuánto se adelanta la pared respecto de UTC en ese instante
    guess = objetivo - desfase;
  }
  return guess;
}

/** «HH:MM» → minutos desde la medianoche, o null. */
export function minutosDeHora(hora) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hora ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Instante (ms) del último reinicio ocurrido hasta `ahoraMs`; `null` si el modo es «nunca»
 * (la partida no caduca). Una partida creada antes de este instante ya no vale.
 */
export function ultimoLimite(reinicio, ahoraMs) {
  const r = reinicio ?? REINICIO_POR_DEFECTO;
  if (r.modo !== "diario" && r.modo !== "semanal") return null;
  const min = minutosDeHora(r.hora);
  if (min === null || !zonaValida(r.zona)) return null;
  const h = Math.floor(min / 60);
  const mi = min % 60;
  const p = new Date(pared(r.zona, ahoraMs)); // hoy, en pared de la empresa
  let dia = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate());
  if (r.modo === "semanal") {
    const atras = (p.getUTCDay() - r.diaSemana + 7) % 7;
    dia -= atras * 86_400_000;
  }
  const paso = r.modo === "semanal" ? 7 : 1;
  for (let i = 0; i < 2; i++) {
    const f = new Date(dia);
    const t = instante(r.zona, f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), h, mi);
    if (t <= ahoraMs) return t;
    dia -= paso * 86_400_000;
  }
  return null;
}

/** ¿Una partida creada en `creadaMs` sigue valiendo? */
export function vigenteDesde(reinicio, creadaMs, ahoraMs) {
  const limite = ultimoLimite(reinicio, ahoraMs);
  return limite === null || creadaMs >= limite;
}

/** Texto para el jugador: «Las partidas se reinician todos los días a las 00:00.» o null si nunca. */
export function textoReinicio(reinicio) {
  const r = reinicio ?? REINICIO_POR_DEFECTO;
  if (r.modo === "diario") return `Las partidas se reinician todos los días a las ${r.hora}.`;
  if (r.modo === "semanal") return `Las partidas se reinician cada ${nombreDia(r.diaSemana)} a las ${r.hora}.`;
  return null;
}
