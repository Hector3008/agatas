import { randomInt } from "node:crypto";
import { conEmpresa } from "core";
import { ErrorAgatas } from "./servicio.js";
import { armarMano, coloresDistintos, estadoPremios } from "./juego.js";
import { crearContador, generarToken, hashToken } from "./util.js";
import { vigenteDesde } from "./reinicio.js";

const HORA = 3600_000;

export function limpiarApodo(valor) {
  if (typeof valor !== "string") throw new ErrorAgatas("DATOS_INVALIDOS", "Escribe un apodo", 400);
  const t = valor.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 24) {
    throw new ErrorAgatas("DATOS_INVALIDOS", "El apodo debe tener entre 2 y 24 caracteres", 400);
  }
  return t;
}

/**
 * ¿La partida sigue valiendo? Devuelve null si sí, o el motivo: «retirada» (la sacó el mesero)
 * o «reiniciada» (se creó antes del último reinicio programado). Las partidas anteriores a 5.83
 * no traen `creadaTs` ni `estado`: se usan `createdAt` y «activa».
 */
export function motivoInvalida(partida, config, ahoraMs) {
  if ((partida.estado ?? "activa") === "retirada") return "retirada";
  const creada = new Date(partida.creadaTs ?? partida.createdAt ?? 0).getTime();
  return vigenteDesde(config.reinicio, creada, ahoraMs) ? null : "reiniciada";
}

const ERRORES_INVALIDA = {
  retirada: ["PARTIDA_RETIRADA", "El personal retiró tu partida. Puedes empezar una nueva."],
  reiniciada: ["PARTIDA_REINICIADA", "El juego se reinició. Empieza una partida nueva; si tenías un premio sin canjear, pídele al personal que lo busque por tu apodo."],
};

/**
 * Partidas: crear (con color al azar y mano completa), reconocer al jugador por su cookie
 * y cobrarle el tope horario de intercambios.
 */
export function crearPartidas({ M, configDe, ahora = () => Date.now(), aleatorio = randomInt }) {
  const porIp = crearContador({ ventanaMs: HORA, ahora });

  async function crear({ empresaId, apodo, clienteId = null, ip = "desconocida" }) {
    const config = await configDe({ empresaId });
    if (config.requiereCuenta && !clienteId) {
      throw new ErrorAgatas("CUENTA_REQUERIDA", "Para jugar necesitas iniciar sesión", 401);
    }
    const nombre = limpiarApodo(apodo);

    return conEmpresa(empresaId, async () => {
      // Con cuenta hay una sola partida por cliente: volver a entrar (otro dispositivo, cookie
      // borrada) entrega un token nuevo y deja sin efecto el anterior.
      if (clienteId) {
        const previa = await M.Partida.findOne({ clienteId }).lean();
        if (previa) {
          if (!motivoInvalida(previa, config, ahora())) return recuperar(previa, config);
          // Retirada o de antes del reinicio: se suelta el vínculo con la cuenta y empieza una partida nueva.
          await M.Partida.updateOne({ _id: previa._id }, { $set: { clienteId: null } });
        }
      }
      if (!porIp.golpe(ip, config.reglas.partidasPorIpHora)) {
        throw new ErrorAgatas("DEMASIADAS_PARTIDAS", "Demasiadas partidas nuevas desde esta conexión; prueba más tarde", 429);
      }
      const colorId = config.colores[aleatorio(config.colores.length)].id;
      const token = generarToken();
      const t = new Date(ahora());
      try {
        const partida = await M.Partida.create({
          tokenHash: hashToken(token),
          apodo: nombre,
          clienteId,
          colorId,
          manoTam: config.manoPorJugador,
          mano: armarMano(config, colorId),
          cupo: { ventana: t, n: 0 },
          estado: "activa",
          creadaTs: t,
        });
        return { token, partida: partida.toObject?.() ?? partida, nueva: true };
      } catch (e) {
        if (e?.code === 11000 && clienteId) {
          const previa = await M.Partida.findOne({ clienteId }).lean();
          if (previa && !motivoInvalida(previa, config, ahora())) return recuperar(previa, config);
        }
        throw e;
      }
    });
  }

  async function recuperar(previa) {
    const token = generarToken();
    await M.Partida.updateOne({ _id: previa._id }, { $set: { tokenHash: hashToken(token) } });
    return { token, partida: previa, nueva: false };
  }

  /** Reconoce al jugador por el token de su cookie y comprueba que su partida siga valiendo. */
  async function porToken({ empresaId, token }) {
    if (!token || typeof token !== "string" || token.length > 100) {
      throw new ErrorAgatas("SIN_PARTIDA", "No tienes una partida abierta", 401);
    }
    // Dentro de conEmpresa hay que esperar la consulta (es perezosa): si no, se ejecuta fuera de la empresa.
    const p = await conEmpresa(empresaId, async () => await M.Partida.findOne({ tokenHash: hashToken(token) }).lean());
    if (!p) throw new ErrorAgatas("SIN_PARTIDA", "No tienes una partida abierta", 401);
    const motivo = motivoInvalida(p, await configDe({ empresaId }), ahora());
    if (motivo) throw new ErrorAgatas(...ERRORES_INVALIDA[motivo], 401);
    return p;
  }

  async function recargar({ empresaId, partidaId }) {
    return conEmpresa(empresaId, async () => await M.Partida.findOne({ _id: partidaId }).lean());
  }

  /**
   * Cobra una unidad del tope horario de intercambios. Dos pasos condicionados:
   * sumar si la ventana sigue abierta y hay cupo, o reabrir la ventana si ya venció.
   */
  async function cobrarCupo({ partidaId, max }) {
    const t = ahora();
    const limite = new Date(t - HORA);
    const a = await M.Partida.updateOne(
      { _id: partidaId, "cupo.n": { $lt: max }, "cupo.ventana": { $gt: limite } },
      { $inc: { "cupo.n": 1 } },
    );
    if (a.modifiedCount) return;
    const b = await M.Partida.updateOne(
      { _id: partidaId, "cupo.ventana": { $lte: limite } },
      { $set: { cupo: { ventana: new Date(t), n: 1 } } },
    );
    if (b.modifiedCount) return;
    throw new ErrorAgatas("LIMITE_INTERCAMBIOS", "Llegaste al tope de intercambios por hora; espera un rato", 429);
  }

  /** Vista que ve el propio jugador. `abiertos` y `premiosReclamados` los aportan los otros servicios. */
  function vista({ partida, config, abiertos = [], reclamados = new Map() }) {
    const color = config.colores.find((c) => c.id === partida.colorId) ?? null;
    const t = ahora();
    const ventanaViva = t - new Date(partida.cupo?.ventana ?? 0).getTime() < HORA;
    const usados = ventanaViva ? (partida.cupo?.n ?? 0) : 0;
    return {
      apodo: partida.apodo,
      colorId: partida.colorId,
      color,
      manoTam: partida.manoTam,
      mano: partida.mano.map((m) => ({
        aid: m.aid,
        codigo: m.codigo,
        colorId: m.colorId,
        reservada: Boolean(m.reservadaPor),
        invitacion: m.reservadaPor ?? undefined,
      })),
      distintos: coloresDistintos(partida.mano).length,
      colores: coloresDistintos(partida.mano),
      premios: estadoPremios(config, partida.mano, new Set(reclamados.keys())).map((p) => ({
        ...p,
        ...(reclamados.get(p.id) ?? {}),
      })),
      intercambios: abiertos,
      cupo: { usados, max: config.reglas.intercambiosPorHora },
    };
  }

  return { crear, porToken, recargar, cobrarCupo, vista, motivoInvalida: (p, config) => motivoInvalida(p, config, ahora()) };
}
