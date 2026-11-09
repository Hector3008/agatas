import { conEmpresa, permite } from "core";
import { ErrorAgatas } from "./servicio.js";
import { PERMISOS } from "./roles.js";
import { coloresDistintos } from "./juego.js";
import { codigoCorto, crearContador, formatearCodigo, normalizarCodigo } from "./util.js";

const ARRIENDO_MS = 30_000;
const esConflicto = (e) =>
  ["CONFLICTO_VERSION", "TRANSICION_INVALIDA", "ESTADO_NO_EDITABLE"].includes(e?.codigo);

/**
 * Premios. Un premio de la configuración se gana una sola vez por partida (índice único
 * {partida, premio}); el jugador recibe un código de canje y el mesero lo valida. Entregar
 * es una transición condicionada del documento PR: solo una petición puede ganarla.
 */
export function crearPremios({ M, documentos, configDe, ahora = () => Date.now(), aleatorioCodigo = codigoCorto }) {
  const fallosStaff = crearContador({ ventanaMs: 10 * 60_000, ahora });

  function exigir(actor, permiso) {
    if (!actor || !permite(actor.permisos ?? [], permiso)) {
      throw new ErrorAgatas("PERMISO_INSUFICIENTE", "Permiso insuficiente", 403);
    }
  }

  // Crea el documento PR de un registro de premio. Solo lo crea quien consigue el arriendo,
  // para que dos peticiones simultáneas no generen dos documentos.
  async function asegurarPr(reg, datos) {
    if (reg.prCode) return reg.prCode;
    const t = ahora();
    const tomado = await M.Premio.updateOne(
      {
        _id: reg._id,
        prCode: null,
        $or: [{ creandoTs: null }, { creandoTs: { $lt: new Date(t - ARRIENDO_MS) } }],
      },
      { $set: { creandoTs: new Date(t) } },
    );
    if (!tomado.matchedCount) {
      return (await M.Premio.findOne({ _id: reg._id }).lean())?.prCode ?? null;
    }
    const pr = await documentos.crear({ tipo: "premio", doc: datos });
    await M.Premio.updateOne({ _id: reg._id }, { $set: { prCode: pr.code } });
    return pr.code;
  }

  const datosPr = (reg, premio, partida) => ({
    premioId: reg.premioId,
    nombre: premio.nombre,
    descripcion: premio.descripcion,
    partidaId: String(partida._id),
    apodo: partida.apodo,
    codigoCanje: reg.codigoCanje,
  });

  async function reclamar({ empresaId, partida, premioId }) {
    const config = await configDe({ empresaId });
    const premio = config.premios.find((p) => p.id === premioId);
    if (!premio) throw new ErrorAgatas("PREMIO_NO_ENCONTRADO", "Ese premio no existe", 404);
    return conEmpresa(empresaId, async () => {
      // Se cuenta con la mano de ahora mismo, no con la que se cargó al empezar la petición.
      const viva = await M.Partida.findOne({ _id: partida._id }).lean();
      const tiene = coloresDistintos(viva.mano).length;

      let reg = await M.Premio.findOne({ partidaId: partida._id, premioId }).lean();
      if (!reg) {
        if (tiene < premio.umbral) {
          throw new ErrorAgatas("NO_ALCANZA", `Necesitas ${premio.umbral} colores distintos y tienes ${tiene}`, 409);
        }
        for (let i = 0; i < 4 && !reg; i++) {
          try {
            const creado = await M.Premio.create({ partidaId: partida._id, premioId, codigoCanje: aleatorioCodigo(8) });
            reg = creado.toObject?.() ?? creado;
          } catch (e) {
            if (e?.code !== 11000) throw e;
            // O ya lo reclamó otra petición (ganó la carrera) o el código salió repetido.
            reg = await M.Premio.findOne({ partidaId: partida._id, premioId }).lean();
          }
        }
        if (!reg) throw new ErrorAgatas("REINTENTAR", "No se pudo generar el código; vuelve a intentarlo", 503);
      }
      const prCode = await asegurarPr(reg, datosPr(reg, premio, viva));
      return vistaReclamo({ reg, prCode, premio });
    });
  }

  async function vistaReclamo({ reg, prCode, premio }) {
    const pr = prCode ? await documentos.obtener({ code: prCode }) : null;
    return {
      premioId: reg.premioId,
      nombre: premio.nombre,
      codigoCanje: reg.codigoCanje,
      codigoCanjeTexto: formatearCodigo(reg.codigoCanje),
      estado: pr?.estado ?? "pendiente",
    };
  }

  /** Premios ya reclamados por una partida: Map premioId → { codigoCanje, estadoCanje }. */
  async function reclamadosDe({ empresaId, partidaId }) {
    return conEmpresa(empresaId, async () => {
      const regs = await M.Premio.find({ partidaId }).lean();
      const mapa = new Map();
      for (const r of regs) {
        const pr = r.prCode ? await documentos.obtener({ code: r.prCode }) : null;
        mapa.set(r.premioId, {
          codigoCanje: r.codigoCanje,
          codigoCanjeTexto: formatearCodigo(r.codigoCanje),
          estadoCanje: pr?.estado ?? "pendiente",
        });
      }
      return mapa;
    });
  }

  // ---------- mesero ----------
  async function buscarPorCodigo({ empresaId, actor, codigo }) {
    const limpio = normalizarCodigo(codigo);
    const clave = String(actor.usuarioId ?? "anon");
    if (fallosStaff.cuenta(clave) >= 20) {
      throw new ErrorAgatas("DEMASIADOS_INTENTOS", "Demasiados códigos inválidos; espera unos minutos", 429);
    }
    const reg = limpio ? await M.Premio.findOne({ codigoCanje: limpio }).lean() : null;
    if (!reg) {
      fallosStaff.golpe(clave, Number.MAX_SAFE_INTEGER);
      throw new ErrorAgatas("CODIGO_NO_ENCONTRADO", "Ese código no existe", 404);
    }
    const config = await configDe({ empresaId });
    const premio = config.premios.find((p) => p.id === reg.premioId) ?? { nombre: reg.premioId, descripcion: "" };
    const partida = await M.Partida.findOne({ _id: reg.partidaId }).lean();
    const prCode = await asegurarPr(reg, datosPr(reg, premio, partida ?? { _id: reg.partidaId, apodo: "?" }));
    if (!prCode) throw new ErrorAgatas("REINTENTAR", "El premio se está preparando; vuelve a intentarlo", 503);
    return { reg, prCode, premio, partida };
  }

  const vistaStaff = ({ reg, prCode, premio, partida, pr }) => ({
    codigoCanje: formatearCodigo(reg.codigoCanje),
    prCode,
    premio: { id: reg.premioId, nombre: premio.nombre, descripcion: premio.descripcion },
    jugador: partida?.apodo ?? null,
    estado: pr.estado,
    entregadoTs: pr.estado === "entregado" ? pr.historial?.at(-1)?.ts : null,
  });

  async function consultar({ empresaId, actor, codigo }) {
    exigir(actor, PERMISOS.validar);
    return conEmpresa(empresaId, async () => {
      const r = await buscarPorCodigo({ empresaId, actor, codigo });
      const pr = await documentos.obtener({ code: r.prCode });
      return vistaStaff({ ...r, pr });
    });
  }

  async function cerrarPremio({ empresaId, actor, codigo, a, motivo }) {
    exigir(actor, PERMISOS.validar);
    return conEmpresa(empresaId, async () => {
      const r = await buscarPorCodigo({ empresaId, actor, codigo });
      try {
        const pr = await documentos.transicionar({
          code: r.prCode,
          a,
          motivo,
          usuarioId: actor.usuarioId ?? null,
          permisos: actor.permisos,
        });
        return vistaStaff({ ...r, pr });
      } catch (e) {
        if (esConflicto(e)) {
          const pr = await documentos.obtener({ code: r.prCode });
          throw new ErrorAgatas("YA_PROCESADO", `Ese código ya está «${pr.estado}»`, 409);
        }
        throw e;
      }
    });
  }

  const entregar = ({ empresaId, actor, codigo }) => cerrarPremio({ empresaId, actor, codigo, a: "entregado" });
  const anular = ({ empresaId, actor, codigo, motivo }) =>
    cerrarPremio({ empresaId, actor, codigo, a: "anulado", motivo: { codigo: motivo } });

  async function listar({ empresaId, actor, estado = "pendiente", limite = 50 }) {
    exigir(actor, PERMISOS.leer);
    return conEmpresa(empresaId, async () => {
      const docs = await documentos.listar({ tipo: "premio", estado, limite });
      return docs.map((d) => ({
        prCode: d.code,
        estado: d.estado,
        codigoCanje: formatearCodigo(d.payload.doc.codigoCanje),
        premio: d.payload.doc.nombre,
        jugador: d.payload.doc.apodo,
        creado: d.createdAt,
      }));
    });
  }

  async function partidas({ empresaId, actor, limite = 100 }) {
    exigir(actor, PERMISOS.leer);
    return conEmpresa(empresaId, async () => {
      const lista = await M.Partida.find({}).sort({ createdAt: -1 }).limit(Math.min(limite, 200)).lean();
      return lista.map((p) => ({
        id: String(p._id),
        apodo: p.apodo,
        colorId: p.colorId,
        distintos: coloresDistintos(p.mano).length,
        creada: p.createdAt,
      }));
    });
  }

  return { reclamar, reclamadosDe, consultar, entregar, anular, listar, partidas };
}
