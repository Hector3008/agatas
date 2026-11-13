import { conEmpresa, permite } from "core";
import { ErrorAgatas } from "./servicio.js";
import { PERMISOS } from "./roles.js";
import { coloresDistintos } from "./juego.js";

const RE_ID = /^[0-9a-f]{24}$/i;

/**
 * Gestión de jugadores por el personal (5.83): ver quién juega y retirar a alguien.
 * Retirar no borra: la partida queda marcada «retirada» (con quién y cuándo), sus intercambios abiertos
 * se cancelan y sus premios pendientes se anulan. Se puede repetir sin efectos dobles.
 */
export function crearRetiros({ M, partidas, intercambios, premios, configDe, ahora = () => Date.now() }) {
  function exigir(actor, permiso) {
    if (!actor || !permite(actor.permisos ?? [], permiso)) {
      throw new ErrorAgatas("PERMISO_INSUFICIENTE", "Permiso insuficiente", 403);
    }
  }

  /** Jugadores en juego ahora: sin los retirados ni los de antes del último reinicio. */
  async function listar({ empresaId, actor, limite = 100 }) {
    exigir(actor, PERMISOS.leer);
    const config = await configDe({ empresaId });
    return conEmpresa(empresaId, async () => {
      const lista = await M.Partida.find({}).sort({ createdAt: -1 }).limit(400).lean();
      return lista
        .filter((p) => !partidas.motivoInvalida(p, config))
        .slice(0, Math.min(limite, 200))
        .map((p) => ({
          id: String(p._id),
          apodo: p.apodo,
          colorId: p.colorId,
          distintos: coloresDistintos(p.mano).length,
          creada: p.creadaTs ?? p.createdAt,
        }));
    });
  }

  async function retirar({ empresaId, actor, id }) {
    exigir(actor, PERMISOS.validar);
    if (!RE_ID.test(String(id ?? ""))) throw new ErrorAgatas("JUGADOR_NO_ENCONTRADO", "No existe ese jugador", 404);
    return conEmpresa(empresaId, async () => {
      const previa = await M.Partida.findOne({ _id: id }).lean();
      if (!previa) throw new ErrorAgatas("JUGADOR_NO_ENCONTRADO", "No existe ese jugador", 404);
      // Primero se marca (así deja de poder hacer nada) y después se limpia; la limpieza es repetible.
      await M.Partida.updateOne(
        { _id: id, estado: { $ne: "retirada" } },
        { $set: { estado: "retirada", retiradaTs: new Date(ahora()), retiradaPor: actor.usuarioId ?? null } },
      );
      const fresca = await M.Partida.findOne({ _id: id }).lean();
      await intercambios.sanear({ empresaId, partida: fresca });
      const premiosAnulados = await premios.anularPendientesDe({ empresaId, actor, partidaId: fresca._id });
      return { id: String(fresca._id), apodo: fresca.apodo, estado: "retirada", premiosAnulados };
    });
  }

  return { listar, retirar };
}
