import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";

export const DIST_POR_DEFECTO = fileURLToPath(new URL("../client/dist", import.meta.url));

// El front es una página sin scripts ni recursos externos: todo sale del mismo origen.
// El QR se dibuja como SVG dentro de la página, por eso no hace falta `img-src` de terceros.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Sirve client/dist (commiteado) bajo `/app/`. `index.html` nunca se guarda en caché (para que un
 * despliegue nuevo se vea al instante); los archivos de `assets/` llevan hash en el nombre y se
 * guardan un año. Sin build responde 503 claro en vez de fallar al arrancar.
 */
export function crearFront({ dist = DIST_POR_DEFECTO } = {}) {
  const r = express.Router();
  const hayBuild = () => existsSync(`${dist}/index.html`);

  r.use((req, res, next) => {
    if (!hayBuild()) {
      return res.status(503).type("text/plain; charset=utf-8").send("El front del juego no está compilado (falta client/dist; ejecuta npm run build).");
    }
    next();
  });

  r.get("/", (_req, res) => {
    res.set({
      "Cache-Control": "no-cache",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    res.sendFile(`${dist}/index.html`);
  });

  r.use(
    "/assets",
    express.static(`${dist}/assets`, { index: false, immutable: true, maxAge: "1y", fallthrough: false }),
  );
  // Cualquier otra ruta bajo /app/ es un archivo que no existe, no la página.
  r.use((_req, res) => res.status(404).type("text/plain; charset=utf-8").send("No encontrado"));
  return r;
}
