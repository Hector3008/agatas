import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_POR_DEFECTO, validarConfig, aplicarCambios, agatasDe, faltantes,
  vistaPublica, ErrorConfig,
} from "../src/config.js";
import { TIPO_INTERCAMBIO, TIPO_PREMIO } from "../src/tipos.js";

const base = () => structuredClone(CONFIG_POR_DEFECTO);

test("la configuración por defecto es válida y tiene 36 agatas (6 colores × 6)", () => {
  const c = validarConfig(base());
  assert.equal(agatasDe(c).length, 36);
  assert.equal(c.requiereCuenta, false);
  assert.deepEqual(c.premios.map((p) => p.umbral), [3, 5, 6]);
});

test("el nombre del personaje es configurable", () => {
  const c = aplicarCambios(base(), { personaje: { singular: "gecko", plural: "geckos" } });
  assert.equal(c.personaje.plural, "geckos");
  assert.equal(c.personaje.singular, "gecko");
});

test("cambiar la cantidad de colores y de agatas por color", () => {
  const c = aplicarCambios(base(), {
    colores: base().colores.slice(0, 4),
    agatasPorColor: 8,
    premios: [{ id: "p4", umbral: 4, nombre: "Premio" }],
  });
  assert.equal(agatasDe(c).length, 32);
});

test("rechaza menos de 2 colores, colores repetidos y hex inválido", () => {
  assert.throws(() => aplicarCambios(base(), { colores: base().colores.slice(0, 1) }), ErrorConfig);
  const rep = base().colores; rep[1].id = rep[0].id;
  assert.throws(() => aplicarCambios(base(), { colores: rep }), /repetido/);
  const feo = base().colores; feo[0].hex = "naranja";
  assert.throws(() => aplicarCambios(base(), { colores: feo }), /#rrggbb/);
});

test("la mano no puede superar las agatas por color", () => {
  assert.throws(() => aplicarCambios(base(), { agatasPorColor: 4 }), /manoPorJugador/);
  assert.doesNotThrow(() => aplicarCambios(base(), { agatasPorColor: 4, manoPorJugador: 4 }));
});

test("un premio no puede pedir más colores de los que hay, ni repetir umbral", () => {
  assert.throws(
    () => aplicarCambios(base(), { premios: [{ id: "x", umbral: 7, nombre: "X" }] }),
    /umbral/,
  );
  assert.throws(
    () => aplicarCambios(base(), { premios: [{ id: "a", umbral: 3, nombre: "A" }, { id: "b", umbral: 3, nombre: "B" }] }),
    /umbral 3/,
  );
});

test("los premios salen ordenados por umbral", () => {
  const c = aplicarCambios(base(), {
    premios: [{ id: "b", umbral: 6, nombre: "B" }, { id: "a", umbral: 2, nombre: "A" }],
  });
  assert.deepEqual(c.premios.map((p) => p.id), ["a", "b"]);
});

test("preguntas por agata: se valida el código y se detectan las que faltan", () => {
  const c = aplicarCambios(base(), { preguntas: { "naranja-1": "  ¿Cuál es tu café favorito? " } });
  assert.equal(c.preguntas["naranja-1"], "¿Cuál es tu café favorito?");
  assert.equal(faltantes(c).length, 35);
  assert.equal(faltantes(c).includes("naranja-1"), false);
  assert.throws(() => aplicarCambios(base(), { preguntas: { "naranja-7": "x" } }), /no es una agata/);
  assert.throws(() => aplicarCambios(base(), { preguntas: { "azul-1": "x" } }), ErrorConfig);
});

test("al reducir colores se rechazan las preguntas de los que ya no existen", () => {
  const con = aplicarCambios(base(), { preguntas: { "rojo-1": "¿Algo?" } });
  assert.throws(
    () => aplicarCambios(con, { colores: con.colores.slice(0, 3), premios: [] }),
    /rojo-1/,
  );
});

test("requiereCuenta es configurable y debe ser booleano", () => {
  assert.equal(aplicarCambios(base(), { requiereCuenta: true }).requiereCuenta, true);
  assert.throws(() => aplicarCambios(base(), { requiereCuenta: "si" }), ErrorConfig);
});

test("campos desconocidos, cuerpo vacío y límites de largo", () => {
  assert.throws(() => aplicarCambios(base(), { colorin: 1 }), /desconocido/);
  assert.throws(() => aplicarCambios(base(), {}), /nada que cambiar/);
  assert.throws(() => aplicarCambios(base(), { textos: { reglas: "x".repeat(4001) } }), /máximo/);
});

test("los cambios de textos y personaje se combinan campo a campo", () => {
  const c = aplicarCambios(base(), { textos: { reglas: "Sé amable" } });
  const d = aplicarCambios(c, { textos: { instrucciones: "Busca tu centro de mesa" } });
  assert.equal(d.textos.reglas, "Sé amable");
  assert.equal(d.textos.instrucciones, "Busca tu centro de mesa");
});

test("la vista pública no incluye las preguntas", () => {
  const c = aplicarCambios(base(), { preguntas: { "naranja-1": "¿Secreta?" } });
  assert.equal("preguntas" in vistaPublica(c), false);
});

test("tipos: prefijos propios y estados finales", () => {
  assert.equal(TIPO_INTERCAMBIO.prefijo, "IA");
  assert.equal(TIPO_PREMIO.prefijo, "PR");
  assert.equal(TIPO_INTERCAMBIO.transiciones.completado, undefined);
  assert.equal(TIPO_PREMIO.permisos.entregado, "juego:validar");
  for (const t of [TIPO_INTERCAMBIO, TIPO_PREMIO]) {
    assert.match(t.prefijo, /^[A-Z][A-Z0-9_]{0,11}$/);
    assert.ok(!["PD", "RC", "DOC_ITEM", "DP"].includes(t.prefijo));
  }
});

// ───────────── 5.80: reglas ─────────────
import { advertencias, LIMITES_REGLAS } from "../src/config.js";

test("una configuración guardada en 5.79 (sin reglas) se completa con las reglas por defecto", () => {
  const vieja = base();
  delete vieja.reglas;
  const c = validarConfig(vieja);
  assert.deepEqual(c.reglas, CONFIG_POR_DEFECTO.reglas);
});

test("las reglas se cambian de una en una y se validan", () => {
  const c = aplicarCambios(base(), { reglas: { intercambiosPorHora: 3 } });
  assert.equal(c.reglas.intercambiosPorHora, 3);
  assert.equal(c.reglas.cookieDias, 30, "lo demás se conserva");
  assert.throws(() => aplicarCambios(base(), { reglas: { intercambiosPorHora: 0 } }), ErrorConfig);
  assert.throws(() => aplicarCambios(base(), { reglas: { ofertaVenceSeg: 5 } }), ErrorConfig);
  assert.throws(() => aplicarCambios(base(), { reglas: { inventada: 1 } }), ErrorConfig);
  assert.throws(() => aplicarCambios(base(), { reglas: [] }), ErrorConfig);
  assert.deepEqual(Object.keys(LIMITES_REGLAS).sort(), Object.keys(CONFIG_POR_DEFECTO.reglas).sort());
});

test("avisa de los premios que nadie podrá ganar (umbral mayor que la mano)", () => {
  assert.deepEqual(advertencias(validarConfig(base())), []);
  const c = aplicarCambios(base(), { manoPorJugador: 4 });
  assert.deepEqual(advertencias(c).map((a) => a.premioId), ["p5", "p6"]);
});

test("la vista pública no muestra preguntas ni reglas de antifraude, solo los tiempos", () => {
  const c = aplicarCambios(base(), { preguntas: { "naranja-1": "¿?" } });
  const v = vistaPublica(c);
  assert.equal(v.preguntas, undefined);
  assert.equal(v.reglas, undefined);
  assert.deepEqual(v.tiempos, { ofertaVenceSeg: 180, reservaVenceSeg: 900 });
});
