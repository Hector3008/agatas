import { CONFIG_POR_DEFECTO, aplicarCambios, faltantes, advertencias, validarConfig } from "./config.js";
import { PERMISOS } from "./roles.js";
import { conEmpresa, permite } from "core";

export class ErrorAgatas extends Error {
  constructor(codigo, mensaje, status) {
    super(mensaje);
    this.name = "ErrorAgatas";
    this.codigo = codigo;
    this.status = status;
  }
}

/**
 * Servicio de configuración. Cada operación recibe `actor = { usuarioId, permisos }`
 * y comprueba su permiso aunque la ruta no lo haga (como en 5.14 a 5.16).
 */
export function crearServicio({ core, Config }) {
  function exigir(actor, permiso) {
    if (!actor || !permite(actor.permisos ?? [], permiso)) {
      throw new ErrorAgatas(
        "PERMISO_INSUFICIENTE",
        "Permiso insuficiente",
        403,
      );
    }
  }

  async function cargar(empresaId) {
    return conEmpresa(empresaId, async () => {
      const doc = await Config.findOne({}).lean();
      return doc?.config ?? null;
    });
  }

  return {
    /** Lectura interna (sin actor): la usará el juego en 5.80. Sin guardar, devuelve los valores por defecto. */
    async configDe({ empresaId }) {
      // validarConfig completa lo que falte (p. ej. `reglas` en configuraciones de 5.79)
      return validarConfig((await cargar(empresaId)) ?? structuredClone(CONFIG_POR_DEFECTO));
    },

    async leer({ empresaId, actor }) {
      exigir(actor, PERMISOS.configurar);
      const guardada = await cargar(empresaId);
      const config = validarConfig(guardada ?? structuredClone(CONFIG_POR_DEFECTO));
      return {
        config,
        guardada: Boolean(guardada),
        sinPregunta: faltantes(config),
        advertencias: advertencias(config),
      };
    },

    async guardar({ empresaId, actor, cambios }) {
      exigir(actor, PERMISOS.configurar);
      const actual =
        (await cargar(empresaId)) ?? structuredClone(CONFIG_POR_DEFECTO);
      const config = aplicarCambios(actual, cambios);
      await conEmpresa(empresaId, async () => {
        await Config.updateOne(
          { clave: "config" },
          { $set: { config, actualizadoPor: actor.usuarioId ?? null } },
          { upsert: true },
        );
      });
      return { config, guardada: true, sinPregunta: faltantes(config), advertencias: advertencias(config) };
    },
  };
}
