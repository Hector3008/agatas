import test from "node:test";
import assert from "node:assert/strict";
import { REINICIO_POR_DEFECTO, minutosDeHora, textoReinicio, ultimoLimite, vigenteDesde, zonaValida } from "../src/reinicio.js";
import { CONFIG_POR_DEFECTO, aplicarCambios, validarConfig } from "../src/config.js";

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
const ms = (s) => Date.parse(s);
const lima = { modo: "diario", hora: "00:00", diaSemana: 1, zona: "America/Lima" }; // Lima = UTC-5 todo el año

test("diario: el límite es la última medianoche de la empresa, no la del servidor", () => {
  assert.equal(iso(ultimoLimite(lima, ms("2026-11-10T13:00:00Z"))), "2026-11-10T05:00:00.000Z");
  assert.equal(iso(ultimoLimite(lima, ms("2026-11-10T05:00:00Z"))), "2026-11-10T05:00:00.000Z", "justo en el límite ya cuenta");
  assert.equal(iso(ultimoLimite(lima, ms("2026-11-10T04:59:59Z"))), "2026-11-09T05:00:00.000Z", "un segundo antes todavía es el día anterior");
  assert.equal(iso(ultimoLimite({ ...lima, hora: "23:30" }, ms("2026-11-10T13:00:00Z"))), "2026-11-10T04:30:00.000Z");
  assert.equal(iso(ultimoLimite({ ...lima, hora: "03:00" }, ms("2026-11-10T07:00:00Z"))), "2026-11-09T08:00:00.000Z", "a las 02:00 de Lima todavía rige el de ayer");
});

test("semanal: el último día de la semana elegido a esa hora", () => {
  const lunes = { ...lima, modo: "semanal", diaSemana: 1 };
  assert.equal(iso(ultimoLimite(lunes, ms("2026-11-10T13:00:00Z"))), "2026-11-09T05:00:00.000Z", "martes → lunes anterior");
  assert.equal(iso(ultimoLimite(lunes, ms("2026-11-09T04:00:00Z"))), "2026-11-02T05:00:00.000Z", "domingo noche → lunes de la semana pasada");
  assert.equal(iso(ultimoLimite(lunes, ms("2026-11-09T05:00:00Z"))), "2026-11-09T05:00:00.000Z");
  assert.equal(iso(ultimoLimite({ ...lunes, diaSemana: 0 }, ms("2026-11-10T13:00:00Z"))), "2026-11-08T05:00:00.000Z", "domingo");
  assert.equal(iso(ultimoLimite({ ...lunes, diaSemana: 2, hora: "09:00" }, ms("2026-11-10T13:00:00Z"))), "2026-11-03T14:00:00.000Z", "martes 09:00 y todavía no llega: el de la semana anterior");
});

test("nunca no caduca, y una configuración rota tampoco rompe nada", () => {
  assert.equal(ultimoLimite({ modo: "nunca" }, Date.now()), null);
  assert.equal(ultimoLimite(undefined, Date.now()), null);
  assert.equal(ultimoLimite({ ...lima, hora: "25:00" }, Date.now()), null);
  assert.equal(ultimoLimite({ ...lima, zona: "Marte/Olimpo" }, Date.now()), null);
  assert.equal(vigenteDesde({ modo: "nunca" }, 0, Date.now()), true);
});

test("zonas con horario de verano: sigue la hora de pared de la empresa", () => {
  const ny = { modo: "diario", hora: "08:00", diaSemana: 1, zona: "America/New_York" };
  assert.equal(iso(ultimoLimite(ny, ms("2026-01-15T20:00:00Z"))), "2026-01-15T13:00:00.000Z", "invierno: UTC-5");
  assert.equal(iso(ultimoLimite(ny, ms("2026-07-15T20:00:00Z"))), "2026-07-15T12:00:00.000Z", "verano: UTC-4");
  // Día en que se adelanta el reloj (8 de marzo de 2026): 02:30 no existe, no debe romperse ni dar un instante absurdo.
  const salto = ultimoLimite({ ...ny, hora: "02:30" }, ms("2026-03-08T12:00:00Z"));
  assert.ok(Math.abs(salto - ms("2026-03-08T07:30:00Z")) <= 3_600_000);
});

test("vigenteDesde: vale lo creado después del último límite", () => {
  const ahora = ms("2026-11-10T13:00:00Z");
  assert.equal(vigenteDesde(lima, ms("2026-11-10T05:00:00Z"), ahora), true);
  assert.equal(vigenteDesde(lima, ms("2026-11-10T04:59:59Z"), ahora), false);
  assert.equal(vigenteDesde(lima, ms("2026-11-09T20:00:00Z"), ahora), false);
});

test("minutosDeHora, zonaValida y textoReinicio", () => {
  assert.equal(minutosDeHora("00:00"), 0);
  assert.equal(minutosDeHora("23:59"), 1439);
  for (const mala of ["24:00", "7:00", "12:60", "", null, "12:5", "ab:cd"]) assert.equal(minutosDeHora(mala), null, String(mala));
  assert.ok(zonaValida("America/Lima") && zonaValida("UTC") && !zonaValida("Lima") && !zonaValida("") && !zonaValida(5));
  assert.equal(textoReinicio({ modo: "nunca" }), null);
  assert.equal(textoReinicio(lima), "Las partidas se reinician todos los días a las 00:00.");
  assert.equal(textoReinicio({ ...lima, modo: "semanal", diaSemana: 0, hora: "06:30" }), "Las partidas se reinician cada domingo a las 06:30.");
});

test("config: por defecto nunca; se valida y se mezcla campo a campo", () => {
  assert.deepEqual(validarConfig(structuredClone(CONFIG_POR_DEFECTO)).reinicio, REINICIO_POR_DEFECTO);
  const sinCampo = structuredClone(CONFIG_POR_DEFECTO);
  delete sinCampo.reinicio; // configuraciones guardadas antes de 5.83
  assert.equal(validarConfig(sinCampo).reinicio.modo, "nunca");
  const c = aplicarCambios(CONFIG_POR_DEFECTO, { reinicio: { modo: "semanal", diaSemana: 3 } });
  assert.deepEqual(c.reinicio, { modo: "semanal", hora: "00:00", diaSemana: 3, zona: "America/Lima" });
  assert.equal(aplicarCambios(c, { reinicio: { hora: "06:15" } }).reinicio.modo, "semanal", "cambiar la hora no pierde el modo");
  for (const mal of [{ modo: "mensual" }, { hora: "24:00" }, { zona: "Marte/Olimpo" }, { diaSemana: 7 }, { diaSemana: 1.5 }, { otro: 1 }]) {
    assert.throws(() => aplicarCambios(CONFIG_POR_DEFECTO, { reinicio: mal }), (e) => e.campo === "reinicio" || e.message.includes("reinicio"), JSON.stringify(mal));
  }
  assert.throws(() => aplicarCambios(CONFIG_POR_DEFECTO, { reinicio: "diario" }));
});
