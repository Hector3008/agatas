import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import express from "express";
import { crearFront } from "../src/front.js";

async function montar(dist) {
  const app = express();
  // Igual que en index.js: /app sin barra redirige, con barra sirve el front.
  app.get("/agatas/app", (req, res, next) => {
    const [ruta, consulta] = req.originalUrl.split("?");
    if (ruta.endsWith("/")) return next();
    res.redirect(301, `${ruta}/${consulta ? `?${consulta}` : ""}`);
  });
  app.use("/agatas/app", crearFront({ dist }));
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/agatas/app`, cerrar: () => new Promise((r) => server.close(r)) };
}

test("sirve la página sin caché y con CSP estricta; los assets con caché larga", async (t) => {
  const dist = mkdtempSync(join(tmpdir(), "agatas-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
  const s = await montar(dist);
  t.after(s.cerrar);

  const p = await fetch(`${s.url}/?e=cafe`);
  assert.equal(p.status, 200);
  assert.equal(p.headers.get("cache-control"), "no-cache");
  const csp = p.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.equal(p.headers.get("x-content-type-options"), "nosniff");

  const a = await fetch(`${s.url}/assets/app-abc123.js`);
  assert.equal(a.status, 200);
  assert.match(a.headers.get("cache-control"), /max-age=31536000/);
  assert.match(a.headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(`${s.url}/assets/no-existe.js`)).status, 404);
  assert.equal((await fetch(`${s.url}/otra-cosa`)).status, 404);
});

test("sin barra final redirige conservando los parámetros (sin bucle)", async (t) => {
  const dist = mkdtempSync(join(tmpdir(), "agatas-dist-"));
  writeFileSync(join(dist, "index.html"), "<title>x</title>");
  const s = await montar(dist);
  t.after(s.cerrar);
  const r = await fetch(`${s.url}?e=cafe&i=ABCDEFGH`, { redirect: "manual" });
  assert.equal(r.status, 301);
  assert.equal(new URL(r.headers.get("location"), s.url).pathname + new URL(r.headers.get("location"), s.url).search, "/agatas/app/?e=cafe&i=ABCDEFGH");
  assert.equal((await fetch(`${s.url}/?e=cafe`, { redirect: "manual" })).status, 200);
});

test("sin compilar (falta client/dist) responde 503 con una explicación, no se cae", async (t) => {
  const s = await montar(join(tmpdir(), "no-existe-agatas-dist"));
  t.after(s.cerrar);
  const r = await fetch(`${s.url}/`);
  assert.equal(r.status, 503);
  assert.match(await r.text(), /npm run build/);
});

test("el dist del repo compilado existe y la página apunta a archivos relativos", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { DIST_POR_DEFECTO } = await import("../src/front.js");
  assert.ok(existsSync(`${DIST_POR_DEFECTO}/index.html`), "client/dist debe estar commiteado (npm run build)");
  const html = readFileSync(`${DIST_POR_DEFECTO}/index.html`, "utf8");
  assert.match(html, /src="\.\/assets\/index-[\w-]+\.js"/);
  assert.match(html, /href="\.\/assets\/index-[\w-]+\.css"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/, "no debe haber scripts en línea (la CSP los bloquearía)");
});
