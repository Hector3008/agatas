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
