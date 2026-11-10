// Cliente del API del personal: /agatas/staff/...  Usa la sesión de `cuenta` (cookie `sid`, mismo dominio).
import { ErrorApi } from "./api.js";

/** `href` es la dirección de esta página (…/agatas/app/): el API queda en `../staff/`. */
export function crearApiStaff({ href = globalThis.location?.href, fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  const raiz = new URL("../staff/", href);

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
      // El núcleo responde { error: "texto", codigo: "SIN_SESION" }; agatas, { error: "CODIGO", mensaje }.
      throw new ErrorApi({
        codigo: datos?.codigo ?? datos?.error ?? "ERROR",
        mensaje: datos?.mensaje ?? (datos?.codigo ? datos?.error : null) ?? "Ocurrió un error inesperado.",
        status: r.status,
      });
    }
    return datos;
  }

  const c = (codigo) => encodeURIComponent(codigo);
  return {
    premios: (estado = "pendiente") => pedir("GET", `premios?estado=${encodeURIComponent(estado)}`),
    consultar: (codigo) => pedir("GET", `premios/${c(codigo)}`),
    entregar: (codigo) => pedir("POST", `premios/${c(codigo)}/entregar`),
    anular: (codigo, motivo) => pedir("POST", `premios/${c(codigo)}/anular`, { motivo: motivo ?? "" }),
    partidas: () => pedir("GET", "partidas"),
  };
}
