import mongoose from "mongoose";
import { tenancyPlugin } from "core";

// Una configuración por empresa (colección `agatas_config`, con tenancy).
export function crearModeloConfig(core) {
  const schema = new mongoose.Schema(
    {
      // La forma exacta la valida src/config.js; aquí se guarda tal cual.
      // Fija en "config": con empresaId forma el índice único (una sola por empresa).
      clave: { type: String, default: "config" },
      config: { type: mongoose.Schema.Types.Mixed, required: true },
      actualizadoPor: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { timestamps: true },
  );
  schema.plugin(tenancyPlugin);
  // El plugin de tenancy ya indexa `empresaId` solo; un índice único sobre el mismo
  // campo se descarta con aviso. Por eso la unicidad va en el par (empresaId, clave).
  schema.index({ empresaId: 1, clave: 1 }, { unique: true });
  return core.model("AgatasConfig", schema, "agatas_config");
}
