// Cliente del API del jugador: /agatas/p/<slug>/...  La cookie de partida la maneja el navegador.

export class ErrorApi extends Error {
  constructor({ codigo, mensaje, status, red = false }) {
    super(mensaje);
    this.codigo = codigo;
    this.mensaje = mensaje;
    this.status = status;
    this.red = red;
  }
}

/**
 * `href` es la dirección de esta página (p. ej. https://x/agatas/app/): el API queda en `../p/<slug>/`,
 * así funciona con cualquier prefijo con el que el gateway monte el servicio.
 */
export function crearApi(slug, { href = globalThis.location?.href, fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  const raiz = new URL(`../p/${encodeURIComponent(slug)}/`, href);

  async function pedir(metodo, ruta, cuerpo) {
    const init = { method: metodo, headers: {}, credentials: "same-origin", cache: "no-store" };
    if (metodo !== "GET") init.headers["x-requested-with"] = "fetch";
    if (cuerpo !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(cuerpo);
    }
    let r;
    try {
      r = await fetchFn(new URL(ruta, raiz).toString(), init);
    } catch {
      throw new ErrorApi({ codigo: "RED", mensaje: "Sin conexión", status: 0, red: true });
    }
    let datos = null;
    try {
      datos = await r.json();
    } catch {
      /* la respuesta no era JSON */
    }
    if (!r.ok) {
      throw new ErrorApi({
        codigo: datos?.error ?? "ERROR",
        mensaje: datos?.mensaje ?? "Ocurrió un error inesperado.",
        status: r.status,
      });
    }
    return datos;
  }

  const inv = (codigo) => encodeURIComponent(codigo);
  return {
    info: () => pedir("GET", "info"),
    partida: () => pedir("GET", "partida"),
    crearPartida: (apodo) => pedir("POST", "partida", { apodo }),
    proponer: (aid) => pedir("POST", "intercambios", { aid }),
    ver: (codigo) => pedir("GET", `intercambios/${inv(codigo)}`),
    unirse: (invitacion, aid) => pedir("POST", "intercambios/unirse", { invitacion, aid }),
    confirmar: (codigo) => pedir("POST", `intercambios/${inv(codigo)}/confirmar`),
    cancelar: (codigo) => pedir("POST", `intercambios/${inv(codigo)}/cancelar`),
    reclamar: (premioId) => pedir("POST", "premios", { premioId }),
  };
}
