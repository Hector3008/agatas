import test from "node:test";
import assert from "node:assert/strict";
import {
  contraste, extraerInvitacion, leerParametros, enlaceInvitacion, enlaceJuego, restante, reloj,
  capitalizar, fase, textoMotivo, mensajeError, faltan, elegibles, resumenColores,
} from "../src/lib/util.js";
import { crearApi, ErrorApi } from "../src/api.js";

test("contraste: texto blanco sobre colores oscuros y oscuro sobre claros", () => {
  assert.equal(contraste("#d6402b"), "#ffffff");
  assert.equal(contraste("#e8dcb5"), "#1b1410");
  assert.equal(contraste("#e8b923"), "#1b1410");
  assert.equal(contraste("#8b5a2b"), "#ffffff");
  assert.equal(contraste("no es color"), "#1b1410");
});

test("extraerInvitacion: código suelto, con guion, en minúsculas o dentro de un enlace", () => {
  assert.equal(extraerInvitacion("SPPAENGL"), "SPPAENGL");
  assert.equal(extraerInvitacion(" sppa-engl "), "SPPAENGL");
  assert.equal(extraerInvitacion("https://x.com/agatas/app/?e=cafe&i=sppaengl"), "SPPAENGL");
  assert.equal(extraerInvitacion("https://x.com/agatas/app/?e=cafe&i=SPPA%2DENGL"), "SPPAENGL");
  assert.equal(extraerInvitacion("corto"), null);
  assert.equal(extraerInvitacion("SPPAENGL9"), null);
  assert.equal(extraerInvitacion("SPPAENG0"), null, "el 0 no existe en el alfabeto");
  assert.equal(extraerInvitacion(undefined), null);
});

test("leerParametros: empresa e invitación del enlace, ignorando lo inválido", () => {
  assert.deepEqual(leerParametros("?e=Cafe-Prueba&i=SPPAENGL"), { slug: "cafe-prueba", invitacion: "SPPAENGL" });
  assert.deepEqual(leerParametros("?e=cafe"), { slug: "cafe", invitacion: null });
  assert.deepEqual(leerParametros(""), { slug: null, invitacion: null });
  assert.deepEqual(leerParametros("?e=../etc"), { slug: null, invitacion: null });
});

test("los enlaces conservan la ruta y no arrastran parámetros viejos", () => {
  const base = "https://ilnapo.com/agatas/app/?e=viejo&i=XXXXXXXX#algo";
  assert.equal(enlaceInvitacion(base, "cafe-prueba", "SPPAENGL"), "https://ilnapo.com/agatas/app/?e=cafe-prueba&i=SPPAENGL");
  assert.equal(enlaceJuego(base, "cafe-prueba"), "https://ilnapo.com/agatas/app/?e=cafe-prueba");
});

test("cuenta regresiva", () => {
  assert.equal(restante(10_500, 10_000), 1);
  assert.equal(restante(9_000, 10_000), 0);
  assert.equal(reloj(125), "2:05");
  assert.equal(reloj(9), "0:09");
  assert.equal(reloj(-4), "0:00");
  assert.equal(capitalizar("agata"), "Agata");
  assert.equal(capitalizar(""), "");
});

test("fase del intercambio según el servidor", () => {
  assert.equal(fase(null), "cargando");
  assert.equal(fase({ participa: false, estado: "propuesto" }), "oferta");
  assert.equal(fase({ participa: false, estado: "aceptado" }), "cerrado");
  assert.equal(fase({ participa: true, estado: "propuesto" }), "esperando");
  assert.equal(fase({ participa: true, estado: "aceptado" }), "preguntas");
  assert.equal(fase({ participa: true, estado: "completado" }), "listo");
  assert.equal(fase({ participa: true, estado: "cancelado" }), "cerrado");
  assert.equal(fase({ participa: true, estado: "vencido" }), "cerrado");
});

test("textos de motivo, errores y faltantes", () => {
  assert.match(textoMotivo("sin_respuesta"), /tiempo/);
  assert.match(textoMotivo("raro"), /ya no está disponible/);
  assert.match(mensajeError({ red: true }), /conexión/);
  assert.equal(mensajeError({ mensaje: "Ese código no existe" }), "Ese código no existe");
  assert.match(mensajeError(null), /inesperado/);
  assert.equal(faltan(2, 5), 3);
  assert.equal(faltan(6, 5), 0);
});

test("elegibles: solo agatas libres y de otro color que el ofrecido", () => {
  const mano = [
    { aid: "1", colorId: "rojo", reservada: false },
    { aid: "2", colorId: "crema", reservada: false },
    { aid: "3", colorId: "crema", reservada: true },
    { aid: "4", colorId: "verde", reservada: false },
  ];
  assert.deepEqual(elegibles(mano, "rojo").map((a) => a.aid), ["2", "4"]);
  assert.deepEqual(resumenColores(mano), [{ colorId: "rojo", n: 1 }, { colorId: "crema", n: 2 }, { colorId: "verde", n: 1 }]);
});

test("api: arma las rutas relativas a la página, manda CSRF solo al escribir y traduce errores", async () => {
  const llamadas = [];
  const respuestas = [
    { ok: true, json: async () => ({ ok: 1 }) },
    { ok: true, json: async () => ({ ok: 2 }) },
    { ok: false, status: 409, json: async () => ({ error: "NO_DISPONIBLE", mensaje: "Ya no está" }) },
    { ok: false, status: 502, json: async () => { throw new Error("html"); } },
  ];
  const fetchFn = async (url, init) => {
    llamadas.push([url, init]);
    return respuestas.shift();
  };
  const api = crearApi("cafe-prueba", { href: "https://ilnapo.com/agatas/app/?e=cafe-prueba", fetchFn });
  assert.deepEqual(await api.info(), { ok: 1 });
  assert.deepEqual(await api.proponer("abc"), { ok: 2 });
  assert.equal(llamadas[0][0], "https://ilnapo.com/agatas/p/cafe-prueba/info");
  assert.equal(llamadas[0][1].headers["x-requested-with"], undefined);
  assert.equal(llamadas[1][0], "https://ilnapo.com/agatas/p/cafe-prueba/intercambios");
  assert.equal(llamadas[1][1].headers["x-requested-with"], "fetch");
  assert.equal(llamadas[1][1].body, '{"aid":"abc"}');
  await assert.rejects(() => api.confirmar("SPPAENGL"), (e) => e instanceof ErrorApi && e.codigo === "NO_DISPONIBLE" && e.status === 409 && e.mensaje === "Ya no está");
  await assert.rejects(() => api.ver("SPPAENGL"), (e) => e.codigo === "ERROR" && e.status === 502);
  const caida = crearApi("x", { href: "https://a/b/", fetchFn: async () => { throw new TypeError("fail"); } });
  await assert.rejects(() => caida.partida(), (e) => e.red === true);
});

// ───── Mesero (5.82) ─────
import { normalizarCanje, formatearCanje, mensajeStaff, fechaCorta, sinSesion, sinPermiso } from "../src/lib/mesero.js";
import { esMesero } from "../src/lib/util.js";
import { crearApiStaff } from "../src/api-staff.js";

test("normalizarCanje acepta guion, minúsculas y espacios, y exige 8 caracteres", () => {
  assert.equal(normalizarCanje("8x56-9xpl"), "8X569XPL");
  assert.equal(normalizarCanje(" 8X56 9XPL "), "8X569XPL");
  assert.equal(normalizarCanje("8X56-9XP"), null);
  assert.equal(normalizarCanje("8X56-9XPLA"), null);
  assert.equal(normalizarCanje(null), null);
});

test("formatearCanje pone el guion al escribir y corta a 8", () => {
  assert.equal(formatearCanje("8x5"), "8X5");
  assert.equal(formatearCanje("8x569"), "8X56-9");
  assert.equal(formatearCanje("8x569xplzz"), "8X56-9XPL");
});

test("mensajeStaff traduce los casos del mesero", () => {
  assert.match(mensajeStaff({ status: 401 }), /sesión caducó/);
  assert.match(mensajeStaff({ status: 403 }), /permiso/);
  assert.match(mensajeStaff({ status: 404, codigo: "CODIGO_NO_ENCONTRADO" }), /no existe/);
  assert.equal(mensajeStaff({ status: 409, codigo: "YA_PROCESADO", mensaje: "Ese código ya está «entregado»" }), "Ese código ya está «entregado»");
  assert.match(mensajeStaff({ red: true, status: 0 }), /Sin conexión/);
  assert.ok(sinSesion({ status: 401 }) && sinPermiso({ status: 403 }) && !sinSesion({ status: 403 }));
});

test("fechaCorta: hoy con hora, otro día con fecha, inválida vacía", () => {
  const ahora = new Date(2026, 10, 9, 20, 0);
  assert.equal(fechaCorta(new Date(2026, 10, 9, 14, 5).toISOString(), ahora), "hoy 14:05");
  assert.equal(fechaCorta(new Date(2026, 10, 8, 9, 3).toISOString(), ahora), "8 nov 09:03");
  assert.equal(fechaCorta("nada", ahora), "");
});

test("esMesero solo con m=mesero", () => {
  assert.equal(esMesero("?m=mesero"), true);
  assert.equal(esMesero("?e=gecko"), false);
  assert.equal(esMesero(""), false);
});

test("api-staff: URL relativa a la página, CSRF solo en POST y errores del núcleo y de agatas", async () => {
  const llamadas = [];
  const respuestas = [
    { ok: true, json: async () => ({ premios: [] }) },
    { ok: false, status: 401, json: async () => ({ error: "no autenticado", codigo: "SIN_SESION" }) },
    { ok: false, status: 404, json: async () => ({ error: "CODIGO_NO_ENCONTRADO", mensaje: "Ese código no existe" }) },
    { ok: true, json: async () => ({ estado: "entregado" }) },
  ];
  const api = crearApiStaff({ href: "https://x.com/base/agatas/app/?m=mesero", fetchFn: async (url, init) => { llamadas.push([url, init]); return respuestas.shift(); } });
  await api.premios("pendiente");
  await assert.rejects(api.partidas(), (e) => e.status === 401 && e.codigo === "SIN_SESION");
  await assert.rejects(api.consultar("8X569XPL"), (e) => e.codigo === "CODIGO_NO_ENCONTRADO" && e.mensaje === "Ese código no existe");
  await api.entregar("8X569XPL");
  assert.equal(llamadas[0][0], "https://x.com/base/agatas/staff/premios?estado=pendiente");
  assert.equal(llamadas[0][1].headers["x-requested-with"], undefined);
  assert.equal(llamadas[3][0], "https://x.com/base/agatas/staff/premios/8X569XPL/entregar");
  assert.equal(llamadas[3][1].method, "POST");
  assert.equal(llamadas[3][1].headers["x-requested-with"], "fetch");
  assert.equal(llamadas[0][1].credentials, "same-origin");
});

// ───── 5.83: reinicio y retiro ─────
import { textoReinicio as textoCliente } from "../src/lib/reinicio.js";
import { textoReinicio as textoServidor } from "../../src/reinicio.js";
import { MOTIVOS_ANULACION } from "../src/lib/mesero.js";
import { MOTIVOS_ANULACION_PREMIO, MOTIVOS_CANCELACION } from "../../src/tipos.js";

test("el texto del reinicio del jugador coincide con el del servidor", () => {
  for (let dia = 0; dia < 7; dia++) {
    for (const modo of ["nunca", "diario", "semanal"]) {
      const r = { modo, hora: "06:30", diaSemana: dia, zona: "America/Lima" };
      assert.equal(textoCliente(r), textoServidor(r), `${modo} ${dia}`);
    }
  }
  assert.equal(textoCliente(undefined), null);
});

test("los motivos de anulación del mesero son exactamente los que acepta el servidor", () => {
  assert.deepEqual(MOTIVOS_ANULACION.map(([id]) => id).sort(), [...MOTIVOS_ANULACION_PREMIO].sort());
});

test("todos los motivos de cancelación de un intercambio tienen texto propio", () => {
  for (const m of MOTIVOS_CANCELACION) {
    assert.notEqual(textoMotivo(m), textoMotivo("no-existe"), `falta texto para «${m}»`);
  }
});
