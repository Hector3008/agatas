// Prueba contra MongoDB REAL y el núcleo REAL. Se salta sola si no hay base:
//
//   MONGO_URL="mongodb://localhost:27017" node --test test/mongo.integration.test.js
//
// Usa una base temporal (`agatas_test_<n>`) y la borra al terminar. Es la única prueba que
// valida de verdad los operadores de actualización ($elemMatch, `$`, upsert), los índices
// únicos (E11000) y los casts de Mongoose; las demás usan una base falsa en memoria.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import mongoose from "mongoose";
import { createCore } from "core";
import { createRouter, CONFIG_POR_DEFECTO } from "../src/index.js";
import { preguntasCompletas } from "./entorno.js";

const URL_MONGO = process.env.MONGO_URL;

test("flujo completo contra MongoDB real", { skip: URL_MONGO ? false : "defina MONGO_URL para correrla" }, async (t) => {
  const conn = await mongoose.createConnection(URL_MONGO, { dbName: `agatas_test_${Date.now()}` }).asPromise();
  t.after(async () => { await conn.dropDatabase(); await conn.close(); });

  const core = createCore({ connection: conn });
  await core.documentos.listo();
  const router = createRouter({ core });
  await router.listo;

  const empresa = await core.modelos.Empresa.create({
    nombre: "Gecko", slug: "gecko", servicios: [{ codigo: "agatas", activa: true }],
  });
  const empresaId = String(empresa._id);
  await router.servicio.guardar({
    empresaId, actor: { permisos: ["*"] }, cambios: { preguntas: preguntasCompletas(CONFIG_POR_DEFECTO) },
  });

  const app = express();
  app.use("/agatas", router);
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/agatas/p/gecko`;

  const jugador = async (apodo) => {
    let cookie = "";
    const pedir = async (m, ruta, cuerpo) => {
      const r = await fetch(base + ruta, {
        method: m,
        headers: { "content-type": "application/json", "x-requested-with": "fetch", cookie },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      const sc = r.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const c = await pedir("POST", "/partida", { apodo });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    return { pedir, ...c.body };
  };

  // Hasta que dos jugadores tengan colores distintos (el color sale al azar).
  let a, b;
  do { a = await jugador("Ana"); b = await jugador("Beto"); } while (a.colorId === b.colorId);

  const inv = (await a.pedir("POST", "/intercambios", { aid: a.mano[0].aid })).body.invitacion;
  assert.ok(inv);
  // Dos propuestas con la misma agata a la vez: solo una puede quedarse con ella.
  const dobles = await Promise.all([
    a.pedir("POST", "/intercambios", { aid: a.mano[1].aid }),
    a.pedir("POST", "/intercambios", { aid: a.mano[1].aid }),
  ]);
  assert.deepEqual(dobles.map((r) => r.status).sort(), [201, 409]);

  const u = await b.pedir("POST", "/intercambios/unirse", { invitacion: inv, aid: b.mano[0].aid });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const [c1, c2] = await Promise.all([
    a.pedir("POST", `/intercambios/${inv}/confirmar`),
    b.pedir("POST", `/intercambios/${inv}/confirmar`),
  ]);
  assert.equal(c1.status, 200);
  assert.equal(c2.status, 200);

  const va = (await a.pedir("GET", "/partida")).body;
  const vb = (await b.pedir("GET", "/partida")).body;
  assert.equal(va.mano.length, 6);
  assert.equal(vb.mano.length, 6);
  assert.equal(va.mano[0].colorId, b.colorId);
  assert.equal(vb.mano[0].colorId, a.colorId);
  assert.equal(va.distintos, 2);

  // Un premio de 2 colores no existe en la configuración por defecto (el mínimo es 3): se bloquea.
  assert.equal((await a.pedir("POST", "/premios", { premioId: "p3" })).status, 409);
  // Y el índice único de premios responde de verdad: se arma una mano de 3 colores a mano.
  const Partida = conn.models.AgatasPartida;
  const { conEmpresa } = await import("core");
  await conEmpresa(empresaId, async () => {
    const p = await Partida.findOne({ apodo: "Ana" });
    p.mano[1].colorId = "cafe";
    p.mano[2].colorId = "crema";
    await p.save();
  });
  const rs = await Promise.all(Array.from({ length: 5 }, () => a.pedir("POST", "/premios", { premioId: "p3" })));
  assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.map((r) => r.body)));
  assert.equal(new Set(rs.map((r) => r.body.codigoCanje)).size, 1);
  const docs = await conEmpresa(empresaId, () => core.documentos.listar({ tipo: "premio" }));
  assert.equal(docs.length, 1);

  const actor = { usuarioId: String(new mongoose.Types.ObjectId()), permisos: ["juego:validar"] };
  const entregas = await Promise.allSettled(
    Array.from({ length: 4 }, () => router.juego.premios.entregar({ empresaId, actor, codigo: rs[0].body.codigoCanje })),
  );
  assert.equal(entregas.filter((x) => x.status === "fulfilled").length, 1);
});
