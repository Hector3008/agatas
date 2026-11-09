import { crearEntorno, preguntasCompletas } from "./entorno.js";
import { CONFIG_POR_DEFECTO } from "../src/config.js";

export const P = "/p/gecko";

export async function preparar({ config = {}, jitter = false } = {}) {
  const e = await crearEntorno({ jitter });
  await e.nuevaEmpresa("gecko");
  e.personal("admin", "gecko", ["*"]);
  e.personal("mesero", "gecko", ["juego:validar", "juego:leer"]);
  e.personal("lector", "gecko", ["juego:leer"]);
  e.personal("nadie", "gecko", []);
  const admin = e.cliente({ user: "admin" });
  const r = await admin.put("/config", { preguntas: preguntasCompletas(CONFIG_POR_DEFECTO), ...config });
  if (r.status !== 200) throw new Error(`no se pudo configurar: ${JSON.stringify(r.body)}`);
  e.admin = admin;
  e.partidasDb = () => e.base.datos.get("agatas_partidas");
  e.premiosDb = () => e.base.datos.get("agatas_premios");
  e.docs = (tipo) => e.base.datos.get("documentos").filter((d) => d.tipo === tipo);
  let n = 0;

  /** Crea un jugador. Con `colores` se le arma una mano a medida (solo para armar el escenario). */
  e.jugador = async (apodo, { colorId, colores, ip } = {}) => {
    const cli = e.cliente({ ip: ip ?? `10.0.0.${++n}` });
    const r = await cli.post(`${P}/partida`, { apodo });
    if (r.status !== 201) throw new Error(`no se pudo crear ${apodo}: ${JSON.stringify(r.body)}`);
    const j = {
      cli,
      apodo,
      ver: async () => (await cli.get(`${P}/partida`)).body,
      doc: () => e.partidasDb().find((p) => p.apodo === apodo),
    };
    if (colores || colorId) {
      const lista = colores ?? Array(6).fill(colorId);
      const p = j.doc();
      p.colorId = lista[0];
      p.mano = lista.map((c, i) => ({ aid: `${apodo}-${i}`, codigo: `${c}-${i + 1}`, colorId: c, reservadaPor: null, reservadaTs: null }));
    }
    return j;
  };
  e.proponer = (j, aid) => j.cli.post(`${P}/intercambios`, { aid });
  e.unirse = (j, invitacion, aid) => j.cli.post(`${P}/intercambios/unirse`, { invitacion, aid });
  e.confirmar = (j, inv) => j.cli.post(`${P}/intercambios/${inv}/confirmar`);
  e.cancelar = (j, inv) => j.cli.post(`${P}/intercambios/${inv}/cancelar`);
  e.verInt = (j, inv) => j.cli.get(`${P}/intercambios/${inv}`);
  return e;
}

/** Desplaza el reloj `ms` hacia adelante; devuelve la función que lo restaura. */
export function adelantarReloj(ms) {
  const real = Date.now;
  Date.now = () => real() + ms;
  return () => { Date.now = real; };
}

export const colores = (j) => j.doc().mano.map((m) => m.colorId);
export const aids = (j) => j.doc().mano.map((m) => m.aid);
