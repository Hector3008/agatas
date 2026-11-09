import test from "node:test";
import assert from "node:assert/strict";
import { preparar, P, adelantarReloj, colores } from "./ayudas.js";
import { hashToken } from "../src/util.js";

const con = (fn) => async (t) => {
  const e = await preparar();
  t.after(() => e.cerrar());
  await fn(e, t);
};

// ───────────── 5.79 corregida ─────────────
test("GET y PUT /config funcionan con el núcleo real (5.79 tenía conEmpresa y exigirCsrf mal)", con(async (e) => {
  const lector = e.cliente({ user: "nadie" });
  assert.equal((await lector.get("/config")).status, 403);
  const r = await e.admin.get("/config");
  assert.equal(r.status, 200);
  assert.equal(r.body.sinPregunta.length, 0);
  assert.equal(r.body.config.reglas.intercambiosPorHora, 12);
  assert.equal((await e.admin.put("/config", { agatasPorColor: 7 }, { sinCsrf: true })).status, 403);
  const m = await e.admin.put("/config", { manoPorJugador: 2 });
  assert.equal(m.status, 200);
  assert.deepEqual(m.body.advertencias.map((a) => a.premioId), ["p3", "p5", "p6"]);
}));

// ───────────── partida ─────────────
test("crear partida: color al azar, mano completa, cookie opaca y solo el hash en la base", con(async (e) => {
  const cli = e.cliente({ ip: "1.1.1.1" });
  const r = await cli.post(`${P}/partida`, { apodo: "  Ana  " });
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /^ag_gecko=.+HttpOnly/);
  assert.match(r.setCookie, /SameSite=Lax/);
  assert.equal(r.body.apodo, "Ana");
  assert.equal(r.body.mano.length, 6);
  assert.equal(r.body.distintos, 1);
  assert.ok(r.body.mano.every((m) => m.colorId === r.body.colorId));
  assert.deepEqual(r.body.mano.map((m) => m.codigo), [1, 2, 3, 4, 5, 6].map((n) => `${r.body.colorId}-${n}`));
  assert.equal(new Set(r.body.mano.map((m) => m.aid)).size, 6);

  const token = decodeURIComponent(r.setCookie.split(";")[0].split("=")[1]);
  const [p] = e.partidasDb();
  assert.equal(p.tokenHash, hashToken(token));
  assert.ok(!JSON.stringify(p).includes(token), "el token no debe guardarse");

  // Al recargar, la cookie lo reconoce.
  const v = await cli.get(`${P}/partida`);
  assert.equal(v.status, 200);
  assert.equal(v.body.apodo, "Ana");
}));

test("los colores salen de todos los configurados (azar)", con(async (e) => {
  const vistos = new Set();
  for (let i = 0; i < 60; i++) {
    const r = await e.cliente({ ip: `9.9.${i}.1` }).post(`${P}/partida`, { apodo: `J${i}` });
    vistos.add(r.body.colorId);
  }
  assert.ok(vistos.size >= 4, `solo salieron ${[...vistos]}`);
}));

test("sin cookie, con cookie falsa o sin CSRF: no hay partida", con(async (e) => {
  assert.equal((await e.cliente().get(`${P}/partida`)).status, 401);
  const c = e.cliente();
  c.cookie = "ag_gecko=inventado";
  assert.equal((await c.get(`${P}/partida`)).status, 401);
  assert.equal((await e.cliente().post(`${P}/partida`, { apodo: "Ana" }, { sinCsrf: true })).status, 403);
  assert.equal((await e.cliente().post(`${P}/partida`, { apodo: "A" })).status, 400);
  assert.equal((await e.cliente().post(`${P}/partida`, {})).status, 400);
}));

test("empresa inexistente, apagada o sin el servicio: mismo 404", async (t) => {
  const e = await preparar();
  t.after(() => e.cerrar());
  await e.nuevaEmpresa("apagada", { activa: false });
  await e.nuevaEmpresa("sinjuego", { servicios: [{ codigo: "cuenta", activa: true }] });
  await e.nuevaEmpresa("servicioapagado", { servicios: [{ codigo: "agatas", activa: false }] });
  const cuerpos = [];
  for (const slug of ["nada", "apagada", "sinjuego", "servicioapagado", "..%2Fx"]) {
    const r = await e.cliente().get(`/p/${slug}/info`);
    assert.equal(r.status, 404, slug);
    cuerpos.push(JSON.stringify(r.body));
  }
  assert.equal(new Set(cuerpos).size, 1);
});

test("las empresas no se mezclan: la cookie de una no sirve en otra", async (t) => {
  const e = await preparar();
  t.after(() => e.cerrar());
  await e.nuevaEmpresa("otra");
  const a = await e.jugador("Ana");
  const c = e.cliente();
  c.cookie = a.cli.cookie.replace("ag_gecko", "ag_otra");
  assert.equal((await c.get("/p/otra/partida")).status, 401);
});

test("tope de partidas nuevas por IP (configurable) y otra IP sigue pudiendo", async (t) => {
  const e = await preparar({ config: { reglas: { partidasPorIpHora: 2 } } });
  t.after(() => e.cerrar());
  const nueva = (ip, n) => e.cliente({ ip }).post(`${P}/partida`, { apodo: `J${n}` });
  assert.equal((await nueva("5.5.5.5", 1)).status, 201);
  assert.equal((await nueva("5.5.5.5", 2)).status, 201);
  const r = await nueva("5.5.5.5", 3);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "DEMASIADAS_PARTIDAS");
  assert.equal((await nueva("6.6.6.6", 4)).status, 201);
  const restaurar = adelantarReloj(3600_001);
  t.after(restaurar);
  assert.equal((await nueva("5.5.5.5", 5)).status, 201);
});

test("requiereCuenta: sin sesión no se juega; con cuenta hay una sola partida y volver a entrar renueva el token", async (t) => {
  const e = await preparar({ config: { requiereCuenta: true } });
  t.after(() => e.cerrar());
  const anon = e.cliente();
  assert.equal((await anon.post(`${P}/partida`, { apodo: "Ana" })).status, 401);

  const cid = String(e.base.datos.get("empresas")[0]._id); // cualquier ObjectId válido sirve como cliente
  const a = e.cliente({ clienteCuenta: cid });
  const r1 = await a.post(`${P}/partida`, { apodo: "Ana" });
  assert.equal(r1.status, 201);
  const viejo = a.cookie;
  const b = e.cliente({ clienteCuenta: cid }); // otro dispositivo
  const r2 = await b.post(`${P}/partida`, { apodo: "Otro" });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.apodo, "Ana");
  assert.equal(e.partidasDb().length, 1);
  assert.equal((await b.get(`${P}/partida`)).status, 200);
  a.cookie = viejo;
  assert.equal((await a.get(`${P}/partida`)).status, 401, "el token anterior queda sin efecto");
});

// ───────────── intercambio ─────────────
test("intercambio completo: propone, se une, ven las dos preguntas, confirman y se cambian", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  const beto = await e.jugador("Beto", { colorId: "verde" });
  const cami = await e.jugador("Cami", { colorId: "rojo" });

  const p = await e.proponer(ana, "Ana-0");
  assert.equal(p.status, 201);
  const inv = p.body.invitacion;
  assert.equal(p.body.estado, "propuesto");
  assert.equal(p.body.preguntas, undefined, "antes de aceptar nadie ve preguntas");
  assert.equal((await ana.ver()).mano[0].reservada, true);

  // Quien llega solo ve el color que se ofrece.
  const prev = await e.verInt(beto, inv);
  assert.equal(prev.status, 200);
  assert.equal(prev.body.participa, false);
  assert.deepEqual(prev.body.ofrece, { colorId: "naranja" });
  assert.equal(prev.body.recibo, undefined);

  const u = await e.unirse(beto, inv, "Beto-0");
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.estado, "aceptado");
  assert.equal(u.body.entrego.pregunta, "¿Pregunta verde 1?");
  assert.equal(u.body.recibo.pregunta, "¿Pregunta naranja 1?");
  const deAna = await e.verInt(ana, inv);
  assert.equal(deAna.body.entrego.pregunta, "¿Pregunta naranja 1?");
  assert.equal(deAna.body.recibo.pregunta, "¿Pregunta verde 1?");
  assert.equal(deAna.body.con, "Beto");

  // Un tercero ya no puede ni mirar.
  assert.equal((await e.verInt(cami, inv)).status, 409);
  assert.equal((await e.unirse(cami, inv, "Cami-0")).status, 409);
  assert.equal((await cami.ver()).mano.every((m) => !m.reservada), true, "el tercero no queda con nada reservado");

  const c1 = await e.confirmar(ana, inv);
  assert.equal(c1.body.estado, "aceptado");
  assert.deepEqual(c1.body.confirmaciones, { yo: true, otro: false });
  assert.deepEqual(colores(ana), Array(6).fill("naranja"), "con una sola confirmación no cambia nada");

  const c2 = await e.confirmar(beto, inv);
  assert.equal(c2.body.estado, "completado");

  const a = await ana.ver();
  const b = await beto.ver();
  assert.equal(a.mano.length, 6);
  assert.equal(b.mano.length, 6);
  assert.deepEqual(a.mano.map((m) => m.colorId), ["verde", ...Array(5).fill("naranja")], "la agata nueva ocupa el mismo lugar");
  assert.equal(a.mano[0].aid, "Beto-0");
  assert.equal(b.mano[0].aid, "Ana-0");
  assert.equal(a.distintos, 2);
  assert.equal(b.distintos, 2);
  assert.ok(a.mano.every((m) => !m.reservada) && b.mano.every((m) => !m.reservada));
  assert.equal(e.docs("intercambio").length, 1);
  assert.equal(e.docs("intercambio")[0].estado, "completado");

  // Repetir las confirmaciones no cambia nada más.
  assert.equal((await e.confirmar(ana, inv)).body.estado, "completado");
  assert.equal(e.partidasDb().flatMap((p) => p.mano).length, 18);
}));

test("reglas del intercambio: propio, mismo color, agata reservada, pregunta faltante, inexistente", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  const beto = await e.jugador("Beto", { colorId: "naranja" });
  const cami = await e.jugador("Cami", { colorId: "verde" });

  const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
  assert.equal((await e.proponer(ana, "Ana-0")).body.error, "AGATA_NO_DISPONIBLE", "una agata no entra en dos intercambios");
  assert.equal((await e.proponer(ana, "no-existe")).status, 409);
  assert.equal((await e.unirse(ana, inv, "Ana-1")).body.error, "PROPIO");
  assert.equal((await e.unirse(beto, inv, "Beto-0")).body.error, "MISMO_COLOR");
  assert.equal((await e.unirse(cami, "ZZZZZZZZ", "Cami-0")).status, 404);

  // Una agata ya reservada en otro intercambio no se puede ofrecer aquí.
  const inv2 = (await e.proponer(cami, "Cami-1")).body.invitacion;
  assert.equal((await e.unirse(ana, inv2, "Ana-0")).body.error, "AGATA_NO_DISPONIBLE");

  // Falta la pregunta de la agata ofrecida.
  const cfg = (await e.admin.get("/config")).body.config;
  const preguntas = { ...cfg.preguntas };
  delete preguntas["naranja-3"];
  await e.admin.put("/config", { preguntas });
  assert.equal((await e.proponer(ana, "Ana-2")).body.error, "SIN_PREGUNTA");
  assert.equal(ana.doc().mano[2].reservadaPor, null, "no deja reservas colgadas");
}));

test("cancelar libera las agatas; solo participantes; no se puede cancelar un intercambio ya confirmado por ambos", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  const beto = await e.jugador("Beto", { colorId: "verde" });
  const cami = await e.jugador("Cami", { colorId: "rojo" });
  const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
  await e.unirse(beto, inv, "Beto-0");
  assert.equal((await e.cancelar(cami, inv)).status, 404, "un extraño no sabe ni que existe");
  const c = await e.cancelar(beto, inv);
  assert.equal(c.status, 200);
  assert.equal(c.body.estado, "cancelado");
  assert.ok(colores(ana).length === 6 && ana.doc().mano.every((m) => !m.reservadaPor));
  assert.ok(beto.doc().mano.every((m) => !m.reservadaPor));
  assert.equal((await e.confirmar(ana, inv)).status, 409);
  assert.equal((await e.unirse(cami, inv, "Cami-0")).status, 409);
  assert.equal((await e.cancelar(ana, inv)).body.estado, "cancelado", "cancelar dos veces es inofensivo");
  // Quedan libres para otro intercambio.
  assert.equal((await e.proponer(ana, "Ana-0")).status, 201);
}));

test("una oferta sin pareja vence y libera la agata; un aceptado sin confirmar vence también", con(async (e, t) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  const beto = await e.jugador("Beto", { colorId: "verde" });
  const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
  const restaurar = adelantarReloj(181_000);
  t.after(restaurar);
  const v = await ana.ver();
  assert.equal(v.mano[0].reservada, false);
  assert.equal(v.intercambios.length, 0);
  assert.equal((await e.unirse(beto, inv, "Beto-0")).status, 409);
  assert.equal(e.docs("intercambio")[0].estado, "vencido");
  restaurar();

  // Aceptado pero sin confirmar por los dos: vence a los 15 minutos.
  const inv2 = (await e.proponer(ana, "Ana-1")).body.invitacion;
  await e.unirse(beto, inv2, "Beto-1");
  await e.confirmar(ana, inv2);
  const r2 = adelantarReloj(901_000);
  t.after(r2);
  const c = await e.confirmar(beto, inv2);
  assert.equal(c.status, 409);
  assert.equal(e.docs("intercambio")[1].estado, "vencido");
  assert.ok((await beto.ver()).mano.every((m) => !m.reservada));
  assert.deepEqual(colores(ana), Array(6).fill("naranja"));
}));

test("tope de intercambios por hora y jugador", async (t) => {
  const e = await preparar({ config: { reglas: { intercambiosPorHora: 2 } } });
  t.after(() => e.cerrar());
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  assert.equal((await e.proponer(ana, "Ana-0")).status, 201);
  assert.equal((await e.proponer(ana, "Ana-1")).status, 201);
  const r = await e.proponer(ana, "Ana-2");
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "LIMITE_INTERCAMBIOS");
  assert.equal(ana.doc().mano[2].reservadaPor, null);
  assert.equal((await ana.ver()).cupo.usados, 2);
  const restaurar = adelantarReloj(3600_001);
  t.after(restaurar);
  assert.equal((await e.proponer(ana, "Ana-2")).status, 201, "la ventana se reabre pasada la hora");
});

test("adivinar invitaciones: tras 15 fallos el jugador queda bloqueado un rato", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  for (let i = 0; i < 15; i++) assert.equal((await e.verInt(ana, "AAAAAAA" + (i % 8 + 2))).status, 404);
  const r = await e.verInt(ana, "AAAAAAAA");
  assert.equal(r.status, 429);
}));

// ───────────── carreras ─────────────
test("dos personas se unen a la vez a la misma oferta: gana una, la otra no queda con nada reservado", async (t) => {
  for (let ronda = 0; ronda < 15; ronda++) {
    const e = await preparar({ jitter: true });
    const ana = await e.jugador("Ana", { colorId: "naranja" });
    const beto = await e.jugador("Beto", { colorId: "verde" });
    const cami = await e.jugador("Cami", { colorId: "rojo" });
    const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
    const [rb, rc] = await Promise.all([e.unirse(beto, inv, "Beto-0"), e.unirse(cami, inv, "Cami-0")]);
    const ok = [rb, rc].filter((r) => r.status === 200);
    assert.equal(ok.length, 1, `ronda ${ronda}: ${rb.status} ${rc.status}`);
    const perdedor = rb.status === 200 ? cami : beto;
    assert.ok(perdedor.doc().mano.every((m) => !m.reservadaPor), "el que pierde suelta su agata");
    assert.equal(e.partidasDb().flatMap((p) => p.mano).filter((m) => m.reservadaPor).length, 2);
    await e.cerrar();
  }
});

test("la misma agata no puede entrar en dos intercambios aunque lleguen a la vez (doble toque y dos ofertas)", async () => {
  for (let ronda = 0; ronda < 20; ronda++) {
    const e = await preparar({ jitter: true });
    const ana = await e.jugador("Ana", { colorId: "naranja" });
    const beto = await e.jugador("Beto", { colorId: "verde" });
    const cami = await e.jugador("Cami", { colorId: "rojo" });

    // Doble toque: dos propuestas con la misma agata.
    const [p1, p2] = await Promise.all([e.proponer(ana, "Ana-0"), e.proponer(ana, "Ana-0")]);
    assert.deepEqual([p1.status, p2.status].sort(), [201, 409], `ronda ${ronda}`);
    assert.equal(e.docs("intercambio").length, 1);

    // Beto ofrece la misma agata que usa para unirse a la oferta de Cami.
    const invCami = (await e.proponer(cami, "Cami-0")).body.invitacion;
    const [o, u] = await Promise.all([e.proponer(beto, "Beto-0"), e.unirse(beto, invCami, "Beto-0")]);
    assert.equal([o, u].filter((r) => r.status < 300).length, 1, `ronda ${ronda}: ${o.status} ${u.status}`);
    const usos = beto.doc().mano.filter((m) => m.reservadaPor);
    assert.equal(usos.length, 1);
    await e.cerrar();
  }
});

test("si alguien soltó una reserva a mano, el cambio no se hace a ciegas: nadie queda con más ni con menos", con(async (e, t) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  const beto = await e.jugador("Beto", { colorId: "verde" });
  const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
  await e.unirse(beto, inv, "Beto-0");
  await e.confirmar(ana, inv);
  ana.doc().mano[0].reservadaPor = null; // daño externo
  const silenciar = console.error;
  console.error = () => {};
  t.after(() => { console.error = silenciar; });
  const r = await e.confirmar(beto, inv);
  console.error = silenciar;
  assert.equal(r.body.estado, "aceptado");
  assert.deepEqual(colores(ana), Array(6).fill("naranja"));
  assert.equal(beto.doc().mano[0].aid, "Beto-0", "Beto tampoco cambió");
  assert.equal(e.docs("intercambio")[0].estado, "aceptado");
}));

test("las dos confirmaciones a la vez completan el cambio una sola vez", async () => {
  for (let ronda = 0; ronda < 15; ronda++) {
    const e = await preparar({ jitter: true });
    const ana = await e.jugador("Ana", { colorId: "naranja" });
    const beto = await e.jugador("Beto", { colorId: "verde" });
    const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
    await e.unirse(beto, inv, "Beto-0");
    const [r1, r2] = await Promise.all([e.confirmar(ana, inv), e.confirmar(beto, inv)]);
    assert.ok([r1, r2].every((r) => r.status === 200), JSON.stringify([r1.body, r2.body]));
    await ana.ver();
    await beto.ver();
    assert.deepEqual(colores(ana), ["verde", ...Array(5).fill("naranja")]);
    assert.deepEqual(colores(beto), ["naranja", ...Array(5).fill("verde")]);
    assert.equal(e.docs("intercambio")[0].estado, "completado");
    await e.cerrar();
  }
});

test("cancelar y confirmar a la vez: o se cancela o se completa, nunca algo a medias", async () => {
  for (let ronda = 0; ronda < 20; ronda++) {
    const e = await preparar({ jitter: true });
    const ana = await e.jugador("Ana", { colorId: "naranja" });
    const beto = await e.jugador("Beto", { colorId: "verde" });
    const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
    await e.unirse(beto, inv, "Beto-0");
    await e.confirmar(ana, inv);
    await Promise.all([e.confirmar(beto, inv), e.cancelar(ana, inv)]);
    await ana.ver();
    await beto.ver();
    const estado = e.docs("intercambio")[0].estado;
    assert.ok(["completado", "cancelado"].includes(estado), estado);
    if (estado === "completado") {
      assert.deepEqual(colores(ana), ["verde", ...Array(5).fill("naranja")]);
      assert.deepEqual(colores(beto), ["naranja", ...Array(5).fill("verde")]);
    } else {
      assert.deepEqual(colores(ana), Array(6).fill("naranja"));
      assert.deepEqual(colores(beto), Array(6).fill("verde"));
    }
    assert.ok(e.partidasDb().flatMap((p) => p.mano).every((m) => !m.reservadaPor));
    await e.cerrar();
  }
});

test("si el servidor cae a mitad del cambio, se repara solo y nadie queda con más ni con menos", con(async (e) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  const beto = await e.jugador("Beto", { colorId: "verde" });
  const inv = (await e.proponer(ana, "Ana-0")).body.invitacion;
  await e.unirse(beto, inv, "Beto-0");
  await e.confirmar(ana, inv);

  // Cae justo cuando se va a cambiar la mano de Beto (la de Ana ya se cambió).
  let caer = true;
  e.base.hook = async (op, coleccion, filtro, update) => {
    if (caer && coleccion === "agatas_partidas" && update.$set?.["mano.$"] && String(filtro._id) === String(beto.doc()._id)) {
      caer = false;
      throw new Error("caída simulada");
    }
  };
  const r = await e.confirmar(beto, inv);
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, "aceptado", "no se dio por completado");
  assert.equal(ana.doc().mano[0].aid, "Beto-0", "la mitad ya estaba hecha");
  assert.equal(beto.doc().mano[0].aid, "Beto-0", "y la otra mitad todavía no");

  // Al volver a mirar, se termina.
  await beto.ver();
  assert.equal(beto.doc().mano[0].aid, "Ana-0");
  assert.equal(e.docs("intercambio")[0].estado, "completado");
  assert.equal((await beto.ver()).mano.length, 6);
  const todos = e.partidasDb().flatMap((p) => p.mano.map((m) => m.aid));
  assert.equal(new Set(todos).size, todos.length, "ninguna agata repetida");
}));

test("una reserva huérfana (caída entre reservar y crear el intercambio) se libera sola", con(async (e, t) => {
  const ana = await e.jugador("Ana", { colorId: "naranja" });
  ana.doc().mano[0].reservadaPor = "HUERFANA";
  ana.doc().mano[0].reservadaTs = new Date();
  assert.equal((await ana.ver()).mano[0].reservada, true, "al principio puede estar creándose");
  const restaurar = adelantarReloj(3 * 60_000);
  t.after(restaurar);
  assert.equal((await ana.ver()).mano[0].reservada, false);
}));

test("invariantes bajo carga: muchos jugadores, operaciones al azar y en paralelo", async (t) => {
  const e = await preparar({ jitter: true });
  t.after(() => e.cerrar());
  const cols = ["naranja", "crema", "verde", "cafe", "amarillo", "rojo"];
  const js = [];
  for (let i = 0; i < 12; i++) js.push(await e.jugador(`J${i}`, { colorId: cols[i % 6] }));
  const antes = e.partidasDb().flatMap((p) => p.mano.map((m) => `${m.aid}|${m.codigo}`)).sort();

  const azar = (n) => Math.floor(Math.random() * n);
  const invs = [];
  async function paso() {
    const j = js[azar(js.length)];
    const op = azar(5);
    const mano = j.doc().mano;
    if (op === 0) {
      const r = await e.proponer(j, mano[azar(6)].aid);
      if (r.status === 201) invs.push(r.body.invitacion);
    } else if (invs.length) {
      const inv = invs[azar(invs.length)];
      if (op === 1) await e.unirse(j, inv, mano[azar(6)].aid);
      else if (op === 2) await e.confirmar(j, inv);
      else if (op === 3) await e.cancelar(j, inv);
      else await j.ver();
    }
  }
  for (let ola = 0; ola < 25; ola++) await Promise.all(Array.from({ length: 8 }, paso));

  // Todos confirman lo que quede abierto y se pone al día.
  for (let i = 0; i < 3; i++) for (const j of js) await j.ver();
  for (const inv of invs) for (const j of js) await e.confirmar(j, inv);
  for (let i = 0; i < 3; i++) for (const j of js) await j.ver();
  // Las ofertas que nadie tomó vencen solas con el tiempo.
  const restaurar = adelantarReloj(20 * 60_000);
  t.after(restaurar);
  for (let i = 0; i < 2; i++) for (const j of js) await j.ver();

  for (const p of e.partidasDb()) assert.equal(p.mano.length, 6, `${p.apodo} debe conservar 6 agatas`);
  const despues = e.partidasDb().flatMap((p) => p.mano.map((m) => `${m.aid}|${m.codigo}`)).sort();
  assert.deepEqual(despues, antes, "las agatas solo cambian de dueño: ni se crean ni se pierden");
  const reservadas = e.partidasDb().flatMap((p) => p.mano).filter((m) => m.reservadaPor);
  assert.equal(reservadas.length, 0, "nada queda reservado cuando todo terminó");
  for (const d of e.docs("intercambio")) assert.ok(["completado", "cancelado", "vencido"].includes(d.estado), `${d.code} quedó en ${d.estado}`);
});

// ───────────── premios ─────────────
test("premios: hay que tener los colores; se reclama una vez por premio y partida con código de un solo uso", con(async (e) => {
  const ana = await e.jugador("Ana", { colores: ["naranja", "verde", "rojo", "rojo", "rojo", "rojo"] });
  const beto = await e.jugador("Beto", { colores: ["naranja", "verde", "rojo", "cafe", "crema", "amarillo"] });

  const v = await ana.ver();
  assert.deepEqual(v.premios.map((p) => p.estado), ["disponible", "bloqueado", "bloqueado"]);

  const no = await ana.cli.post(`${P}/premios`, { premioId: "p5" });
  assert.equal(no.status, 409);
  assert.equal(no.body.error, "NO_ALCANZA");
  assert.equal((await ana.cli.post(`${P}/premios`, { premioId: "no-hay" })).status, 404);
  assert.equal((await ana.cli.post(`${P}/premios`, { premioId: "p3" }, { sinCsrf: true })).status, 403);

  const r = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
  assert.equal(r.status, 201);
  assert.match(r.body.codigoCanje, /^[A-Z2-9]{8}$/);
  assert.equal(r.body.estado, "pendiente");
  const otra = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
  assert.equal(otra.body.codigoCanje, r.body.codigoCanje, "reclamar otra vez devuelve el mismo código");
  assert.equal(e.docs("premio").length, 1);

  const vv = await ana.ver();
  assert.equal(vv.premios[0].estado, "reclamado");
  assert.equal(vv.premios[0].codigoCanje, r.body.codigoCanje);

  // Beto tiene 6 colores: puede reclamar los tres, cada uno una vez.
  for (const id of ["p3", "p5", "p6"]) assert.equal((await beto.cli.post(`${P}/premios`, { premioId: id })).status, 201);
  assert.equal(e.docs("premio").length, 4);
  assert.equal(new Set(e.premiosDb().map((p) => p.codigoCanje)).size, 4);
}));

test("el mesero valida: consulta, entrega una sola vez y lo ya entregado se rechaza", con(async (e) => {
  const ana = await e.jugador("Ana", { colores: ["naranja", "verde", "rojo", "rojo", "rojo", "rojo"] });
  const { body: pr } = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
  const mesero = e.cliente({ user: "mesero" });
  const texto = `${pr.codigoCanje.slice(0, 4)}-${pr.codigoCanje.slice(4)}`.toLowerCase();

  const c = await mesero.get(`/staff/premios/${texto}`);
  assert.equal(c.status, 200);
  assert.equal(c.body.premio.nombre, "3 stickers");
  assert.equal(c.body.jugador, "Ana");
  assert.equal(c.body.estado, "pendiente");
  assert.equal((await mesero.get("/staff/premios")).body.premios.length, 1);

  assert.equal((await e.cliente({ user: "lector" }).post(`/staff/premios/${texto}/entregar`)).status, 403);
  assert.equal((await e.cliente({ user: "nadie" }).get(`/staff/premios/${texto}`)).status, 403);
  assert.equal((await e.cliente().get(`/staff/premios/${texto}`)).status, 401);
  assert.equal((await mesero.post(`/staff/premios/${texto}/entregar`, {}, { sinCsrf: true })).status, 403);

  const ok = await mesero.post(`/staff/premios/${texto}/entregar`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.estado, "entregado");
  const dos = await mesero.post(`/staff/premios/${texto}/entregar`);
  assert.equal(dos.status, 409);
  assert.equal(dos.body.error, "YA_PROCESADO");
  assert.equal((await mesero.post(`/staff/premios/${texto}/anular`, { motivo: "error" })).status, 409);
  assert.equal((await mesero.get("/staff/premios")).body.premios.length, 0);
  assert.equal((await mesero.get("/staff/premios?estado=entregado")).body.premios.length, 1);

  // El jugador ve que ya se entregó y no puede volver a ganarlo.
  assert.equal((await ana.ver()).premios[0].estadoCanje, "entregado");
  const de_nuevo = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
  assert.equal(de_nuevo.body.codigoCanje, pr.codigoCanje);
  assert.equal(de_nuevo.body.estado, "entregado");
  assert.equal(e.docs("premio").length, 1);
}));

test("anular exige motivo válido; un código que no existe se bloquea tras muchos intentos", con(async (e) => {
  const ana = await e.jugador("Ana", { colores: ["naranja", "verde", "rojo", "rojo", "rojo", "rojo"] });
  const { body: pr } = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
  const mesero = e.cliente({ user: "mesero" });
  assert.equal((await mesero.post(`/staff/premios/${pr.codigoCanje}/anular`, { motivo: "porque sí" })).status, 400);
  assert.equal((await mesero.post(`/staff/premios/${pr.codigoCanje}/anular`, {})).status, 400);
  const ok = await mesero.post(`/staff/premios/${pr.codigoCanje}/anular`, { motivo: "fraude" });
  assert.equal(ok.body.estado, "anulado");
  assert.equal((await mesero.post(`/staff/premios/${pr.codigoCanje}/entregar`)).status, 409);

  for (let i = 0; i < 20; i++) assert.equal((await mesero.get(`/staff/premios/ABCDEFG${i % 8 + 2}`)).status, 404);
  assert.equal((await mesero.get("/staff/premios/ABCDEFGH")).status, 429);
}));

test("reclamos simultáneos del mismo premio: un solo registro y un solo documento", async () => {
  for (let ronda = 0; ronda < 10; ronda++) {
    const e = await preparar({ jitter: true });
    const ana = await e.jugador("Ana", { colores: ["naranja", "verde", "rojo", "rojo", "rojo", "rojo"] });
    const rs = await Promise.all(Array.from({ length: 6 }, () => ana.cli.post(`${P}/premios`, { premioId: "p3" })));
    assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.map((r) => r.body)));
    assert.equal(new Set(rs.map((r) => r.body.codigoCanje)).size, 1);
    assert.equal(e.premiosDb().length, 1);
    assert.equal(e.docs("premio").length, 1, `ronda ${ronda}`);
    await e.cerrar();
  }
});

test("entregas simultáneas del mismo código: solo una gana", async () => {
  for (let ronda = 0; ronda < 10; ronda++) {
    const e = await preparar({ jitter: true });
    const ana = await e.jugador("Ana", { colores: ["naranja", "verde", "rojo", "rojo", "rojo", "rojo"] });
    const { body: pr } = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
    const meseros = Array.from({ length: 4 }, () => e.cliente({ user: "mesero" }));
    const rs = await Promise.all(meseros.map((m) => m.post(`/staff/premios/${pr.codigoCanje}/entregar`)));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.status)));
    assert.ok(rs.filter((r) => r.status !== 200).every((r) => r.status === 409));
    assert.equal(e.docs("premio")[0].estado, "entregado");
    await e.cerrar();
  }
});

test("el premio ya ganado no depende de la mano de después", con(async (e) => {
  const ana = await e.jugador("Ana", { colores: ["naranja", "verde", "rojo", "rojo", "rojo", "rojo"] });
  const { body: pr } = await ana.cli.post(`${P}/premios`, { premioId: "p3" });
  ana.doc().mano.forEach((m) => { m.colorId = "naranja"; });
  const mesero = e.cliente({ user: "mesero" });
  assert.equal((await mesero.post(`/staff/premios/${pr.codigoCanje}/entregar`)).status, 200);
  assert.equal((await ana.cli.post(`${P}/premios`, { premioId: "p5" })).status, 409);
}));

test("partidas para el personal (juego:leer)", con(async (e) => {
  await e.jugador("Ana", { colorId: "naranja" });
  const r = await e.cliente({ user: "lector" }).get("/staff/partidas");
  assert.equal(r.status, 200);
  assert.equal(r.body.partidas[0].apodo, "Ana");
  assert.equal((await e.cliente({ user: "nadie" }).get("/staff/partidas")).status, 403);
}));
