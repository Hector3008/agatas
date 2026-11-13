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

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

// Una partida por jugador. La mano vive aquí, en un solo documento: así cada cambio
// (reservar, soltar, intercambiar una agata) es una actualización atómica condicionada.
export function crearModeloPartida(core) {
  const item = new Schema(
    {
      aid: { type: String, required: true }, // identidad única de esta agata concreta
      codigo: { type: String, required: true }, // «<colorId>-<n>»: decide la pregunta
      colorId: { type: String, required: true },
      reservadaPor: { type: String, default: null }, // invitación del intercambio que la tiene reservada
      reservadaTs: { type: Date, default: null },
    },
    { _id: false },
  );
  const schema = new Schema(
    {
      tokenHash: { type: String, required: true }, // sha256 del token de la cookie; el token no se guarda
      apodo: { type: String, required: true },
      clienteId: { type: ObjectId, default: null }, // solo con requiereCuenta
      colorId: { type: String, required: true }, // el color que le tocó al entrar
      manoTam: { type: Number, required: true },
      mano: { type: [item], default: [] },
      cupo: {
        ventana: { type: Date, default: Date.now },
        n: { type: Number, default: 0 },
      },
      // 5.83: «activa» o «retirada» (la retira el mesero; queda el historial). Sin el campo = activa.
      estado: { type: String, enum: ["activa", "retirada"], default: "activa" },
      creadaTs: { type: Date, default: null }, // con él se decide si el reinicio programado ya la dejó atrás
      retiradaTs: { type: Date, default: null },
      retiradaPor: { type: ObjectId, default: null },
    },
    { timestamps: true },
  );
  schema.plugin(tenancyPlugin);
  schema.index({ empresaId: 1, tokenHash: 1 }, { unique: true });
  schema.index(
    { empresaId: 1, clienteId: 1 },
    { unique: true, partialFilterExpression: { clienteId: { $type: "objectId" } } },
  );
  return core.model("AgatasPartida", schema, "agatas_partidas");
}

// Enrutado de un intercambio: la invitación (secreta, va en el QR o se dicta) → su documento IA.
// El estado vive en el documento IA; esto solo permite encontrarlo sin recorrer documentos.
export function crearModeloIntercambio(core) {
  const schema = new Schema(
    {
      invitacion: { type: String, required: true },
      iaCode: { type: String, required: true },
      aPartidaId: { type: ObjectId, required: true },
    },
    { timestamps: true },
  );
  schema.plugin(tenancyPlugin);
  schema.index({ empresaId: 1, invitacion: 1 }, { unique: true });
  return core.model("AgatasIntercambio", schema, "agatas_intercambios");
}

// Un premio por partida y por premio de la configuración (índice único). El código de canje
// es de un solo uso: lo valida el mesero y el documento PR pasa a «entregado» una única vez.
export function crearModeloPremio(core) {
  const schema = new Schema(
    {
      partidaId: { type: ObjectId, required: true },
      premioId: { type: String, required: true },
      codigoCanje: { type: String, required: true },
      prCode: { type: String, default: null }, // documento PR; null mientras se crea
      creandoTs: { type: Date, default: null }, // arrendamiento de quien está creando el PR
    },
    { timestamps: true },
  );
  schema.plugin(tenancyPlugin);
  schema.index({ empresaId: 1, partidaId: 1, premioId: 1 }, { unique: true });
  schema.index({ empresaId: 1, codigoCanje: 1 }, { unique: true });
  return core.model("AgatasPremio", schema, "agatas_premios");
}

export function crearModelos(core) {
  return {
    Config: crearModeloConfig(core),
    Partida: crearModeloPartida(core),
    Intercambio: crearModeloIntercambio(core),
    Premio: crearModeloPremio(core),
  };
}
