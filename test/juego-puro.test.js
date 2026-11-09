import test from "node:test";
import assert from "node:assert/strict";
import { armarMano, coloresDistintos, estadoPremios } from "../src/juego.js";
import { CONFIG_POR_DEFECTO, validarConfig } from "../src/config.js";
import { codigoCorto, normalizarCodigo, formatearCodigo, crearContador, leerCookie, serializarCookie, hashToken, generarToken } from "../src/util.js";

const config = validarConfig(structuredClone(CONFIG_POR_DEFECTO));

test("la mano inicial: tantas agatas como la mano, todas del color asignado, numeradas y distintas", () => {
  const m = armarMano(config, "verde");
  assert.equal(m.length, config.manoPorJugador);
  assert.deepEqual(m.map((x) => x.codigo), ["verde-1", "verde-2", "verde-3", "verde-4", "verde-5", "verde-6"]);
  assert.equal(new Set(m.map((x) => x.aid)).size, 6);
  assert.throws(() => armarMano(config, "negro"));
});

test("colores distintos: el color propio cuenta", () => {
  assert.equal(coloresDistintos(armarMano(config, "rojo")).length, 1);
  const m = armarMano(config, "rojo");
  m[0].colorId = "verde";
  m[1].colorId = "cafe";
  assert.deepEqual(coloresDistintos(m).sort(), ["cafe", "rojo", "verde"]);
});

test("estado de cada premio según los colores y lo ya reclamado", () => {
  const m = armarMano(config, "rojo");
  ["verde", "cafe"].forEach((c, i) => { m[i].colorId = c; });
  const e = estadoPremios(config, m, new Set(["p3"]));
  assert.deepEqual(e.map((p) => [p.id, p.estado]), [["p3", "reclamado"], ["p5", "bloqueado"], ["p6", "bloqueado"]]);
  assert.equal(estadoPremios(config, m, new Set())[0].estado, "disponible");
});

test("códigos cortos: sin caracteres confusos, normalizables y formateables", () => {
  for (let i = 0; i < 200; i++) assert.match(codigoCorto(8), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(normalizarCodigo(" abcd-efgh "), "ABCDEFGH");
  assert.equal(normalizarCodigo(null), "");
  assert.equal(formatearCodigo("ABCDEFGH"), "ABCD-EFGH");
});

test("tokens: aleatorios, largos y solo se compara su hash", () => {
  const a = generarToken();
  assert.notEqual(a, generarToken());
  assert.ok(a.length >= 40);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
});

test("contador de ventana fija", () => {
  let t = 0;
  const c = crearContador({ ventanaMs: 1000, ahora: () => t });
  assert.ok(c.golpe("x", 2));
  assert.ok(c.golpe("x", 2));
  assert.equal(c.golpe("x", 2), false);
  assert.equal(c.cuenta("x"), 2);
  assert.ok(c.golpe("y", 2), "otra clave no se ve afectada");
  t = 1000;
  assert.ok(c.golpe("x", 2), "pasada la ventana se reinicia");
  assert.equal(c.cuenta("x"), 1);
});

test("cookies: se lee la correcta y se serializa HttpOnly y SameSite", () => {
  assert.equal(leerCookie("a=1; ag_x=hola%20mundo; b=2", "ag_x"), "hola mundo");
  assert.equal(leerCookie("a=1", "ag_x"), null);
  assert.equal(leerCookie(undefined, "ag_x"), null);
  const c = serializarCookie("ag_x", "t", { maxAgeSeg: 60, secure: true });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.match(c, /Max-Age=60/);
});
