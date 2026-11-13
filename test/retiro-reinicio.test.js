import test from "node:test";
import assert from "node:assert/strict";
import { preparar, P, adelantarReloj } from "./ayudas.js";

const con = (fn) => async (t) => {
  const e = await preparar();
  t.after(() => e.cerrar());
  await fn(e, t);
};
const idDe = (e, apodo) => String(e.partidasDb().find((p) => p.apodo === apodo)._id);
const hhmmLima = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

// ───────────── retirar ─────────────
test("retirar: marca la partida, la deja fuera de juego y de la lista, y queda el historial", con(async (e) => {
  const ana = await e.jugador("Ana");
  await e.jugador("Beto");
  const mesero = e.cliente({ user: "mesero" });
  assert.equal((await mesero.get("/staff/partidas")).body.partidas.length, 2);

  const r = await mesero.post(`/staff/partidas/${idDe(e, "Ana")}/retirar`);
  assert.equal(r.status, 200);
  assert.deepEqual({ apodo: r.body.apodo, estado: r.body.estado, premiosAnulados: r.body.premiosAnulados }, { apodo: "Ana", estado: "retirada", premiosAnulados: 0 });

  const doc = e.partidasDb().find((p) => p.apodo === "Ana");
  assert.equal(doc.estado, "retirada");
  assert.ok(doc.retiradaTs && doc.retiradaPor !== undefined, "queda quién y cuándo");
  assert.deepEqual((await mesero.get("/staff/partidas")).body.partidas.map((p) => p.apodo), ["Beto"]);

  const v = await ana.cli.get(`${P}/partida`);
  assert.equal(v.status, 401);
  assert.equal(v.body.error, "PARTIDA_RETIRADA");
  for (const [m, ruta, cuerpo] of [["post", `${P}/intercambios`, { aid: "x" }], ["post", `${P}/premios`, { premioId: "p3" }]]) {
    assert.equal((await ana.cli[m](ruta, cuerpo)).status, 401, ruta);
  }
  // Puede volver a jugar con otro apodo: la partida nueva reemplaza la cookie.
  const otra = await ana.cli.post(`${P}/partida`, { apodo: "Ana 2" });
  assert.equal(otra.status, 201);
  assert.equal((await ana.cli.get(`${P}/partida`)).body.apodo, "Ana 2");
}));

test("retirar: permisos, sesión, identificador inválido o inexistente", con(async (e) => {
  await e.jugador("Ana");
  const id = idDe(e, "Ana");
  assert.equal((await e.cliente({ user: "lector" }).post(`/staff/partidas/${id}/retirar`)).status, 403);
  assert.equal((await e.cliente({ user: "nadie" }).post(`/staff/partidas/${id}/retirar`)).status, 403);
  assert.equal((await e.cliente().post(`/staff/partidas/${id}/retirar`)).status, 401);
  assert.equal((await e.cliente({ user: "mesero" }).post(`/staff/partidas/${id}/retirar`, {}, { sinCsrf: true })).status, 403);
  assert.equal(e.partidasDb().find((p) => p.apodo === "Ana").estado ?? "activa", "activa", "ningún intento fallido la retiró");
  const mesero = e.cliente({ user: "mesero" });
  assert.equal((await mesero.post(`/staff/partidas/zzz/retirar`)).status, 404);
  assert.equal((await mesero.post(`/staff/partidas/${"a".repeat(24)}/retirar`)).status, 404);
}));

test("retirar cancela sus intercambios y libera las piezas de la otra persona", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "verde" });
  const beto = await e.jugador("Beto", { colorId: "cafe" });
  const cami = await e.jugador("Cami", { colorId: "rojo" });
  const mesero = e.cliente({ user: "mesero" });

  // Oferta sin pareja
  const o1 = (await e.proponer(ana, "Ana-0")).body;
  await mesero.post(`/staff/partidas/${idDe(e, "Ana")}/retirar`);
  const v1 = await e.verInt(cami, o1.invitacion);
  assert.ok(v1.status === 409 || v1.body.estado === "cancelado", "nadie puede tomar la oferta de una persona retirada");
  assert.equal((await e.unirse(cami, o1.invitacion, "Cami-0")).status, 409);
  assert.ok(e.partidasDb().find((p) => p.apodo === "Ana").mano.every((m) => !m.reservadaPor), "sus piezas quedaron libres");
  assert.ok(e.partidasDb().find((p) => p.apodo === "Cami").mano.every((m) => !m.reservadaPor), "y la de quien intentó unirse también");

  // Intercambio ya aceptado: Beto propone, Cami se une, retiran a Beto → Cami ve el cancelado y recupera su pieza
  const o2 = (await e.proponer(beto, "Beto-0")).body;
  assert.equal((await e.unirse(cami, o2.invitacion, "Cami-0")).status, 200);
  assert.ok(e.partidasDb().find((p) => p.apodo === "Cami").mano.some((m) => m.reservadaPor));
  await mesero.post(`/staff/partidas/${idDe(e, "Beto")}/retirar`);
  const c = (await e.verInt(cami, o2.invitacion)).body;
  assert.equal(c.estado, "cancelado");
  assert.equal(c.motivo, "retirado");
  assert.ok(e.partidasDb().find((p) => p.apodo === "Cami").mano.every((m) => !m.reservadaPor));
  assert.equal((await e.confirmar(cami, o2.invitacion)).status, 409, "no puede confirmar un intercambio cancelado");
  assert.deepEqual(e.partidasDb().find((p) => p.apodo === "Cami").mano.map((m) => m.colorId), Array(6).fill("rojo"), "su mano no cambió");
}));

test("si ya estaban las dos confirmaciones (caída a mitad del cambio), retirar a uno no deja la mano de la otra persona a medias", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "verde" });
  const beto = await e.jugador("Beto", { colorId: "cafe" });
  const o = (await e.proponer(ana, "Ana-0")).body;
  assert.equal((await e.unirse(beto, o.invitacion, "Beto-0")).status, 200);
  e.docs("intercambio")[0].payload.doc.conf = { a: true, b: true }; // las dos confirmaron pero el cambio no llegó a aplicarse
  await e.cliente({ user: "mesero" }).post(`/staff/partidas/${idDe(e, "Ana")}/retirar`);
  const v = (await e.verInt(beto, o.invitacion)).body;
  assert.equal(v.estado, "completado", "el cambio que ya estaba confirmado se termina");
  assert.ok(e.partidasDb().find((p) => p.apodo === "Beto").mano.some((m) => m.colorId === "verde"), "Beto recibió su pieza");
  assert.ok(e.partidasDb().find((p) => p.apodo === "Ana").mano.some((m) => m.colorId === "cafe"), "y la mano de Ana también quedó coherente");
}));

test("retirar anula los premios pendientes y respeta los ya entregados; repetirlo no hace daño", con(async (e) => {
  const mesero = e.cliente({ user: "mesero" });
  const ana = await e.jugador("Ana", { colores: ["verde", "cafe", "rojo", "verde", "cafe", "rojo"] });
  const p3 = (await ana.cli.post(`${P}/premios`, { premioId: "p3" })).body;
  const beto = await e.jugador("Beto", { colores: ["verde", "cafe", "rojo", "amarillo", "naranja", "rojo"] });
  const b3 = (await beto.cli.post(`${P}/premios`, { premioId: "p3" })).body;
  const b5 = (await beto.cli.post(`${P}/premios`, { premioId: "p5" })).body;
  assert.equal((await mesero.post(`/staff/premios/${b3.codigoCanje}/entregar`)).status, 200);

  const r = await mesero.post(`/staff/partidas/${idDe(e, "Ana")}/retirar`);
  assert.equal(r.body.premiosAnulados, 1);
  assert.equal((await mesero.get(`/staff/premios/${p3.codigoCanje}`)).body.estado, "anulado");
  assert.equal((await mesero.post(`/staff/premios/${p3.codigoCanje}/entregar`)).status, 409, "un código anulado no se puede entregar");
  assert.equal((await mesero.post(`/staff/partidas/${idDe(e, "Ana")}/retirar`)).body.premiosAnulados, 0, "la segunda vez no anula nada más");

  const rb = await mesero.post(`/staff/partidas/${idDe(e, "Beto")}/retirar`);
  assert.equal(rb.body.premiosAnulados, 1, "solo el p5 que seguía pendiente");
  assert.equal((await mesero.get(`/staff/premios/${b3.codigoCanje}`)).body.estado, "entregado", "lo ya entregado se queda");
  assert.equal((await mesero.get(`/staff/premios/${b5.codigoCanje}`)).body.estado, "anulado");
}));

test("retirar anula también un premio cuyo documento todavía no se había creado", con(async (e) => {
  const mesero = e.cliente({ user: "mesero" });
  const ana = await e.jugador("Ana", { colores: ["verde", "cafe", "rojo", "verde", "cafe", "rojo"] });
  const pr = (await ana.cli.post(`${P}/premios`, { premioId: "p3" })).body;
  const reg = e.premiosDb()[0];
  assert.ok(reg.prCode);
  // Se simula una caída entre «registrar el premio» y «crear su documento»: sin documento todavía.
  const docs = e.base.datos.get("documentos");
  docs.splice(docs.findIndex((d) => d.code === reg.prCode), 1);
  reg.prCode = null;
  reg.creandoTs = null;
  assert.equal((await mesero.post(`/staff/partidas/${idDe(e, "Ana")}/retirar`)).body.premiosAnulados, 1);
  assert.equal((await mesero.get(`/staff/premios/${pr.codigoCanje}`)).body.estado, "anulado", "el código no queda vivo");
}));

test("el mesero ve el identificador de su empresa", con(async (e) => {
  const r = await e.cliente({ user: "mesero" }).get("/staff/empresa");
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, "gecko");
  assert.equal((await e.cliente().get("/staff/empresa")).status, 401);
}));

// ───────────── reinicio programado ─────────────
test("sin reinicio programado las partidas no caducan nunca", con(async (e) => {
  const ana = await e.jugador("Ana");
  const volver = adelantarReloj(400 * 86_400_000);
  try {
    assert.equal((await ana.cli.get(`${P}/partida`)).status, 200);
    assert.equal((await e.cliente({ user: "mesero" }).get("/staff/partidas")).body.partidas.length, 1);
  } finally {
    volver();
  }
}));

test("reinicio diario: pasado el límite la partida vieja ya no vale, desaparece de la lista y se puede empezar otra", con(async (e) => {
  const ahora = Date.now();
  // El reinicio cae dentro de 90 minutos (hora de Lima).
  assert.equal((await e.admin.put("/config", { reinicio: { modo: "diario", hora: hhmmLima(ahora + 90 * 60_000), zona: "America/Lima" } })).status, 200);
  const ana = await e.jugador("Ana");
  const mesero = e.cliente({ user: "mesero" });
  assert.equal((await ana.cli.get(`${P}/partida`)).status, 200);

  let volver = adelantarReloj(60 * 60_000); // +1 h: todavía no
  try {
    assert.equal((await ana.cli.get(`${P}/partida`)).status, 200, "una hora después sigue valiendo");
  } finally {
    volver();
  }
  volver = adelantarReloj(120 * 60_000); // +2 h: ya pasó el límite
  try {
    const v = await ana.cli.get(`${P}/partida`);
    assert.equal(v.status, 401);
    assert.equal(v.body.error, "PARTIDA_REINICIADA");
    assert.match(v.body.mensaje, /reinició/);
    assert.equal((await e.proponer(ana, "x")).status, 401);
    assert.equal((await mesero.get("/staff/partidas")).body.partidas.length, 0, "ya no está en la lista de jugadores");
    const nueva = await ana.cli.post(`${P}/partida`, { apodo: "Ana" });
    assert.equal(nueva.status, 201, "empieza una partida nueva, incluso con el mismo apodo");
    assert.equal((await ana.cli.get(`${P}/partida`)).status, 200);
    assert.equal((await mesero.get("/staff/partidas")).body.partidas.length, 1);
  } finally {
    volver();
  }
}));

test("reinicio: un premio sin canjear de antes del reinicio sigue siendo canjeable por el mesero", con(async (e) => {
  const ahora = Date.now();
  await e.admin.put("/config", { reinicio: { modo: "diario", hora: hhmmLima(ahora + 90 * 60_000) } });
  const ana = await e.jugador("Ana", { colores: ["verde", "cafe", "rojo", "verde", "cafe", "rojo"] });
  const pr = (await ana.cli.post(`${P}/premios`, { premioId: "p3" })).body;
  const volver = adelantarReloj(120 * 60_000);
  try {
    assert.equal((await ana.cli.get(`${P}/partida`)).status, 401);
    const mesero = e.cliente({ user: "mesero" });
    assert.equal((await mesero.get("/staff/premios")).body.premios.length, 1, "sigue en pendientes");
    const c = await mesero.get(`/staff/premios/${pr.codigoCanje}`);
    assert.equal(c.body.jugador, "Ana");
    assert.equal((await mesero.post(`/staff/premios/${pr.codigoCanje}/entregar`)).status, 200);
  } finally {
    volver();
  }
}));

test("reinicio: una oferta abierta de antes del límite se cancela con motivo «reinicio» y nadie la toma", con(async (e) => {
  const ahora = Date.now();
  await e.admin.put("/config", { reinicio: { modo: "diario", hora: hhmmLima(ahora + 90 * 60_000) } });
  const ana = await e.jugador("Ana", { colorId: "verde" });
  const oferta = (await e.proponer(ana, "Ana-0")).body;
  const volver = adelantarReloj(120 * 60_000);
  try {
    // Beto entra después del reinicio e intenta tomar la oferta de Ana (que ya es de la partida anterior)
    const beto = await e.jugador("Beto", { colorId: "cafe" });
    assert.equal((await e.unirse(beto, oferta.invitacion, "Beto-0")).status, 409);
    assert.ok(e.partidasDb().find((p) => p.apodo === "Beto").mano.every((m) => !m.reservadaPor));
    const ia = e.docs("intercambio")[0];
    assert.equal(ia.estado, "cancelado");
    assert.equal(ia.historial.at(-1).motivo.codigo, "reinicio");
  } finally {
    volver();
  }
}));

test("reinicio semanal: sobrevive a los días de la semana y cae en el día elegido", con(async (e) => {
  const ahora = Date.now();
  const hoy = new Date(new Date(ahora - 5 * 3600_000).toISOString().slice(0, 10) + "T00:00:00Z").getUTCDay(); // día de la semana en Lima
  // Reinicio mañana a las 00:00 (de Lima) → hoy no caduca; pasado mañana sí.
  await e.admin.put("/config", { reinicio: { modo: "semanal", hora: "00:00", diaSemana: (hoy + 1) % 7 } });
  const ana = await e.jugador("Ana");
  let volver = adelantarReloj(26 * 3600_000);
  try { assert.equal((await ana.cli.get(`${P}/partida`)).status, 401, "ya pasó la medianoche del día elegido"); } finally { volver(); }
  volver = adelantarReloj(5 * 86_400_000);
  try { assert.equal((await e.jugador("Beto").then((j) => j.cli.get(`${P}/partida`))).status, 200, "una partida nueva dura hasta el siguiente"); } finally { volver(); }
}));

test("las partidas de antes de 5.83 (sin estado ni creadaTs) siguen valiendo y se rigen por su fecha de creación", con(async (e) => {
  const ana = await e.jugador("Ana");
  const doc = e.partidasDb().find((p) => p.apodo === "Ana");
  delete doc.estado;
  delete doc.creadaTs;
  assert.equal((await ana.cli.get(`${P}/partida`)).status, 200);
  assert.equal((await e.cliente({ user: "mesero" }).get("/staff/partidas")).body.partidas.length, 1);
  // Con reinicio y una fecha de creación vieja, la partida antigua queda fuera.
  doc.createdAt = new Date(Date.now() - 3 * 86_400_000);
  await e.admin.put("/config", { reinicio: { modo: "diario", hora: "00:00" } });
  assert.equal((await ana.cli.get(`${P}/partida`)).body.error, "PARTIDA_REINICIADA");
}));

test("/info publica el reinicio para que el jugador sepa cuándo se reinicia", con(async (e) => {
  assert.equal((await e.cliente().get(`${P}/info`)).body.reinicio.modo, "nunca");
  await e.admin.put("/config", { reinicio: { modo: "semanal", diaSemana: 0, hora: "06:00" } });
  const r = (await e.cliente().get(`${P}/info`)).body.reinicio;
  assert.deepEqual({ modo: r.modo, diaSemana: r.diaSemana, hora: r.hora }, { modo: "semanal", diaSemana: 0, hora: "06:00" });
}));
