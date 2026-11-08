import mongoose from "mongoose";
import { tenancyPlugin } from "core";

// Una configuración por empresa (colección `agatas_config`, con tenancy).
export function crearModeloConfig(core) {
  const schema = new mongoose.Schema(
    {
      // La forma exacta la valida src/config.js; aquí se guarda tal cual.
      config: { type: mongoose.Schema.Types.Mixed, required: true },
      actualizadoPor: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { timestamps: true },
  );
  schema.plugin(tenancyPlugin);
  // Índice único por empresa: una sola configuración.
  schema.index({ empresaId: 1 }, { unique: true });
  return core.model("AgatasConfig", schema, "agatas_config");
}
