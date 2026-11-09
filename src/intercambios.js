import { conEmpresa } from "core";
import { ErrorAgatas } from "./servicio.js";
import { codigoCorto, crearContador, normalizarCodigo } from "./util.js";

const MIN = 60_000;
const FINALES = new Set(["cancelado", "vencido", "completado"]);
const esConflicto = (e) =>
  ["CONFLICTO_VERSION", "TRANSICION_INVALIDA", "ESTADO_NO_EDITABLE"].includes(e?.codigo);
const noEncontrado = () => new ErrorAgatas("INTERCAMBIO_NO_ENCONTRADO", "No existe ese intercambio", 404);
const noDisponible = (m = "Ese intercambio ya no está disponible") => new ErrorAgatas("NO_DISPONIBLE", m, 409);

/**
 * Intercambio 1 a 1 entre dos jugadores.
 *
 *   A propone (reserva una agata)  →  B se une con la invitación (reserva la suya)
 *   →  el servidor revela ambas preguntas  →  los dos confirman  →  cambio atómico.
 *
 * Sin transacciones, la seguridad sale de tres piezas:
 *  1. Una agata solo se reserva con una actualización condicionada («no está reservada»),
 *     así que no puede estar en dos intercambios.
 *  2. El documento IA es el punto de serialización: cada paso lo mueve con
 *     { code, version, estado }; si dos peticiones chocan, una pierde y reintenta o falla.
 *  3. El cambio reemplaza cada agata en su sitio (misma posición de la mano): el tamaño de la
 *     mano nunca cambia, y es idempotente (se puede repetir tras una caída sin duplicar nada).
 */
export function crearIntercambios({ M, documentos, configDe, partidas, ahora = () => Date.now(), aleatorioCodigo = codigoCorto }) {
  const fallos = crearContador({ ventanaMs: 10 * MIN, ahora });

  // ---------- reservas ----------
  async function reservar(partidaId, aid, invitacion) {
    const r = await M.Partida.updateOne(
      { _id: partidaId, mano: { $elemMatch: { aid, reservadaPor: null } } },
      { $set: { "mano.$.reservadaPor": invitacion, "mano.$.reservadaTs": new Date(ahora()) } },
    );
    return r.matchedCount > 0;
  }

  async function liberar(partidaId, invitacion) {
    await M.Partida.updateOne(
      { _id: partidaId, "mano.reservadaPor": invitacion },
      { $set: { "mano.$.reservadaPor": null, "mano.$.reservadaTs": null } },
    );
  }

  async function liberarDe(d) {
    await liberar(d.a.partidaId, d.invitacion);
    if (d.b) await liberar(d.b.partidaId, d.invitacion);
  }

  // ---------- búsqueda ----------
  async function buscar(partida, invitacion) {
    const clave = String(partida._id);
    if (fallos.cuenta(clave) >= 15) {
      throw new ErrorAgatas("DEMASIADOS_INTENTOS", "Demasiados intentos con códigos que no existen; espera unos minutos", 429);
    }
    const cod = normalizarCodigo(invitacion);
    const idx = cod ? await M.Intercambio.findOne({ invitacion: cod }).lean() : null;
    if (!idx) {
      fallos.golpe(clave, Number.MAX_SAFE_INTEGER);
      throw noEncontrado();
    }
    return idx;
  }

  const rolDe = (d, partida) => {
    const id = String(partida._id);
    return d.a.partidaId === id ? "a" : d.b?.partidaId === id ? "b" : null;
  };

  // ---------- movimientos del documento ----------
  async function cerrar(ia, a, motivo) {
    try {
      await documentos.transicionar({ code: ia.code, a, motivo, sistema: true, esperaVersion: ia.version });
    } catch (e) {
      if (esConflicto(e)) return false;
      throw e;
    }
    await liberarDe(ia.payload.doc);
    return true;
  }

  // Reemplaza en su sitio la agata que sale por la que entra. Repetirlo no hace daño.
  async function cambiarMano(partidaId, aidSale, entra, invitacion) {
    const r = await M.Partida.updateOne(
      { _id: partidaId, mano: { $elemMatch: { aid: aidSale, reservadaPor: invitacion } } },
      {
        $set: {
          "mano.$": { aid: entra.aid, codigo: entra.codigo, colorId: entra.colorId, reservadaPor: null, reservadaTs: null },
        },
      },
    );
    if (r.matchedCount) return;
    const yaEsta = await M.Partida.findOne({ _id: partidaId, "mano.aid": entra.aid }).lean();
    if (!yaEsta) {
      throw new ErrorAgatas("INCONSISTENTE", "El intercambio no se pudo completar; avisa al personal", 500);
    }
  }

  async function completar(ia) {
    const d = ia.payload.doc;
    await cambiarMano(d.a.partidaId, d.a.aid, d.b, d.invitacion);
    await cambiarMano(d.b.partidaId, d.b.aid, d.a, d.invitacion);
    try {
      await documentos.transicionar({ code: ia.code, a: "completado", sistema: true, esperaVersion: ia.version });
    } catch (e) {
      if (!esConflicto(e)) throw e; // otro ya lo marcó
    }
  }

  /**
   * Lee el documento aplicando lo que toque: vencer lo que se pasó de tiempo y terminar
   * lo que ya tiene las dos confirmaciones (así una caída a mitad del cambio se repara sola).
   */
  async function refrescar(idx) {
    for (let i = 0; i < 6; i++) {
      const ia = await documentos.obtener({ code: idx.iaCode });
      if (!ia) throw noEncontrado();
      const d = ia.payload.doc;
      const t = ahora();
      if (ia.estado === "propuesto" && t > d.ofertaVence) {
        await cerrar(ia, "vencido", { codigo: "sin_respuesta" });
        continue;
      }
      if (ia.estado === "aceptado") {
        if (d.conf.a && d.conf.b) {
          try {
            await completar(ia);
          } catch (e) {
            console.error("[agatas] no se pudo completar", ia.code, e);
            return ia;
          }
          continue;
        }
        if (t > d.reservaVence) {
          await cerrar(ia, "vencido", { codigo: "sin_respuesta" });
          continue;
        }
      }
      return ia;
    }
    return documentos.obtener({ code: idx.iaCode });
  }

  // ---------- vistas ----------
  function vista({ ia, partida, config }) {
    const d = ia.payload.doc;
    const rol = rolDe(d, partida);
    const t = ahora();
    const resto = (ms) => Math.max(0, Math.ceil((ms - t) / 1000));
    if (!rol) {
      // Quien llega con la invitación solo ve qué color se ofrece, no quién ni qué pregunta.
      return {
        invitacion: d.invitacion,
        estado: ia.estado,
        participa: false,
        ofrece: { colorId: d.a.colorId },
        de: d.a.apodo,
        venceEnSeg: resto(d.ofertaVence),
      };
    }
    const otro = rol === "a" ? "b" : "a";
    const yo = d[rol];
    const el = d[otro];
    const reveladas = ia.estado === "aceptado" || ia.estado === "completado";
    const pq = ia.snapshot?.preguntas ?? {};
    const base = (x, lado) => ({
      codigo: x.codigo,
      colorId: x.colorId,
      ...(reveladas ? { pregunta: pq[lado] ?? null } : {}),
    });
    const ultimo = ia.historial?.at(-1);
    return {
      invitacion: d.invitacion,
      codigo: ia.code,
      estado: ia.estado,
      participa: true,
      rol,
      con: el?.apodo ?? null,
      entrego: base(yo, rol),
      recibo: el ? base(el, otro) : null,
      confirmaciones: { yo: Boolean(d.conf[rol]), otro: Boolean(d.conf[otro]) },
      venceEnSeg:
        ia.estado === "propuesto" ? resto(d.ofertaVence) : ia.estado === "aceptado" && !(d.conf.a && d.conf.b) ? resto(d.reservaVence) : null,
      motivo: ia.estado === "vencido" || ia.estado === "cancelado" ? (ultimo?.motivo?.codigo ?? null) : null,
    };
  }

  // ---------- operaciones del jugador ----------
  async function proponer({ empresaId, partida, aid }) {
    const config = await configDe({ empresaId });
    return conEmpresa(empresaId, async () => {
      const item = partida.mano.find((m) => m.aid === aid);
      if (!item || item.reservadaPor) throw new ErrorAgatas("AGATA_NO_DISPONIBLE", "Esa agata no está disponible para intercambiar", 409);
      if (!config.preguntas[item.codigo]) {
        throw new ErrorAgatas("SIN_PREGUNTA", "Esta agata todavía no tiene pregunta; avisa al personal", 409);
      }
      await partidas.cobrarCupo({ partidaId: partida._id, max: config.reglas.intercambiosPorHora });

      const invitacion = aleatorioCodigo(8);
      if (!(await reservar(partida._id, aid, invitacion))) {
        throw new ErrorAgatas("AGATA_NO_DISPONIBLE", "Esa agata no está disponible para intercambiar", 409);
      }
      let ia = null;
      try {
        ia = await documentos.crear({
          tipo: "intercambio",
          doc: {
            invitacion,
            a: { partidaId: String(partida._id), apodo: partida.apodo, aid, codigo: item.codigo, colorId: item.colorId },
            b: null,
            conf: { a: false, b: false },
            ofertaVence: ahora() + config.reglas.ofertaVenceSeg * 1000,
            reservaVence: null,
          },
        });
        await M.Intercambio.create({ invitacion, iaCode: ia.code, aPartidaId: partida._id });
      } catch (e) {
        if (ia) await documentos.transicionar({ code: ia.code, a: "cancelado", motivo: { codigo: "error" }, sistema: true }).catch(() => {});
        await liberar(partida._id, invitacion).catch(() => {});
        throw e;
      }
      return vista({ ia, partida, config });
    });
  }

  async function ver({ empresaId, partida, invitacion }) {
    const config = await configDe({ empresaId });
    return conEmpresa(empresaId, async () => {
      const idx = await buscar(partida, invitacion);
      const ia = await refrescar(idx);
      const v = vista({ ia, partida, config });
      // Un intercambio ajeno que ya no está en oferta no se enseña a extraños.
      if (!v.participa && ia.estado !== "propuesto") throw noDisponible();
      return v;
    });
  }

  async function unirse({ empresaId, partida, invitacion, aid }) {
    const config = await configDe({ empresaId });
    return conEmpresa(empresaId, async () => {
      const idx = await buscar(partida, invitacion);
      const ia = await refrescar(idx);
      const d = ia.payload.doc;
      if (ia.estado !== "propuesto") throw noDisponible("Esa oferta ya fue tomada, cancelada o venció");
      if (d.a.partidaId === String(partida._id)) {
        throw new ErrorAgatas("PROPIO", "No puedes intercambiar contigo mismo", 409);
      }
      const item = partida.mano.find((m) => m.aid === aid);
      if (!item || item.reservadaPor) throw new ErrorAgatas("AGATA_NO_DISPONIBLE", "Esa agata no está disponible para intercambiar", 409);
      if (item.colorId === d.a.colorId) {
        throw new ErrorAgatas("MISMO_COLOR", "Ese intercambio no te daría un color nuevo: elige una agata de otro color", 409);
      }
      const pregA = config.preguntas[d.a.codigo];
      const pregB = config.preguntas[item.codigo];
      if (!pregA || !pregB) throw new ErrorAgatas("SIN_PREGUNTA", "Falta la pregunta de una de las agatas; avisa al personal", 409);

      await partidas.cobrarCupo({ partidaId: partida._id, max: config.reglas.intercambiosPorHora });
      if (!(await reservar(partida._id, aid, d.invitacion))) {
        throw new ErrorAgatas("AGATA_NO_DISPONIBLE", "Esa agata no está disponible para intercambiar", 409);
      }
      try {
        const nuevo = {
          ...d,
          b: { partidaId: String(partida._id), apodo: partida.apodo, aid, codigo: item.codigo, colorId: item.colorId },
          reservaVence: ahora() + config.reglas.reservaVenceSeg * 1000,
        };
        const aceptado = await documentos.transicionar({
          code: ia.code,
          a: "aceptado",
          doc: nuevo,
          snapshot: { preguntas: { a: pregA, b: pregB } },
          sistema: true,
          esperaVersion: ia.version,
        });
        return vista({ ia: aceptado, partida, config });
      } catch (e) {
        // Perdió la carrera contra otra persona (o contra la cancelación): suelta su agata.
        await liberar(partida._id, d.invitacion).catch(() => {});
        if (esConflicto(e)) throw noDisponible("Alguien se te adelantó con esa oferta");
        throw e;
      }
    });
  }

  async function confirmar({ empresaId, partida, invitacion }) {
    const config = await configDe({ empresaId });
    return conEmpresa(empresaId, async () => {
      const idx = await buscar(partida, invitacion);
      for (let i = 0; i < 6; i++) {
        const ia = await refrescar(idx);
        const d = ia.payload.doc;
        const rol = rolDe(d, partida);
        if (!rol) throw noEncontrado();
        if (ia.estado === "completado") return vista({ ia, partida, config });
        if (ia.estado !== "aceptado") throw noDisponible(ia.estado === "vencido" ? "El intercambio venció" : "El intercambio ya no está activo");
        if (d.conf[rol]) return vista({ ia, partida, config });
        try {
          await documentos.nuevaVersion({
            code: ia.code,
            doc: { ...d, conf: { ...d.conf, [rol]: true } },
            esperaVersion: ia.version,
          });
        } catch (e) {
          if (esConflicto(e)) continue;
          throw e;
        }
        // Si con esta ya están las dos, refrescar termina el cambio.
        return vista({ ia: await refrescar(idx), partida, config });
      }
      throw noDisponible("El intercambio cambió varias veces seguidas; vuelve a intentarlo");
    });
  }

  async function cancelar({ empresaId, partida, invitacion }) {
    const config = await configDe({ empresaId });
    return conEmpresa(empresaId, async () => {
      const idx = await buscar(partida, invitacion);
      for (let i = 0; i < 6; i++) {
        const ia = await refrescar(idx);
        const d = ia.payload.doc;
        if (!rolDe(d, partida)) throw noEncontrado();
        if (ia.estado === "cancelado" || ia.estado === "vencido") return vista({ ia, partida, config });
        if (ia.estado === "completado") throw new ErrorAgatas("YA_COMPLETADO", "El intercambio ya se hizo", 409);
        if (d.conf.a && d.conf.b) throw new ErrorAgatas("YA_CONFIRMADO", "Los dos ya confirmaron: el intercambio se está completando", 409);
        if (await cerrar(ia, "cancelado", { codigo: "se_arrepintio" })) {
          return vista({ ia: await documentos.obtener({ code: ia.code }), partida, config });
        }
      }
      throw noDisponible("El intercambio cambió varias veces seguidas; vuelve a intentarlo");
    });
  }

  /**
   * Pone al día las reservas de la mano antes de mostrarla: vence lo caducado, termina lo
   * confirmado, suelta lo cancelado y libera reservas huérfanas (caídas a mitad de proponer).
   */
  async function sanear({ empresaId, partida }) {
    const reservadas = partida.mano.filter((m) => m.reservadaPor);
    if (!reservadas.length) return { partida, abiertos: [] };
    return conEmpresa(empresaId, async () => {
      const abiertos = [];
      for (const m of reservadas) {
        const idx = await M.Intercambio.findOne({ invitacion: m.reservadaPor }).lean();
        if (!idx) {
          const edad = ahora() - new Date(m.reservadaTs ?? 0).getTime();
          if (edad > 2 * MIN) await liberar(partida._id, m.reservadaPor);
          else abiertos.push({ invitacion: m.reservadaPor, aid: m.aid, estado: "creandose" });
          continue;
        }
        const ia = await refrescar(idx);
        if (FINALES.has(ia.estado)) {
          await liberar(partida._id, m.reservadaPor);
          continue;
        }
        abiertos.push({
          invitacion: m.reservadaPor,
          aid: m.aid,
          estado: ia.estado,
          rol: rolDe(ia.payload.doc, partida),
        });
      }
      const fresca = await M.Partida.findOne({ _id: partida._id }).lean();
      return { partida: fresca ?? partida, abiertos };
    });
  }

  return { proponer, ver, unirse, confirmar, cancelar, sanear };
}
