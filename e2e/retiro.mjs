import { chromium } from "playwright";
import { preparar, P, adelantarReloj } from "../test/ayudas.js";
const SH = "./capturas";
const e = await preparar();
const base = e.url.replace(/\/agatas$/, "");
const app = `${base}/agatas/app/?e=gecko`;
const hhmmLima = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
const br = await chromium.launch();
const mk = async (extra = {}, scheme = "light") => {
  const c = await br.newContext({ viewport: { width: 390, height: 800 }, colorScheme: scheme, ...extra });
  const p = await c.newPage();
  p.on("pageerror", (x) => console.log("PAGEERR", x.message));
  return p;
};
const entrar = async (p, apodo) => { await p.goto(app); await p.locator("input").first().fill(apodo); await p.getByRole("button").first().click(); await p.getByText("Tu mano").waitFor(); };

// 1) Retirar desde la pantalla del mesero
const ana = await mk(), beto = await mk({}, "dark");
await entrar(ana, "Ana"); await entrar(beto, "Beto");
console.log("CABECERA:", (await ana.locator(".marca-nombre").innerText()).trim());
const m = await mk({ extraHTTPHeaders: { "x-user": "mesero" } });
await m.goto(`${base}/agatas/app/?m=mesero`);
console.log("MESERO:", (await m.locator(".marca-nombre").innerText()).trim());
await m.getByRole("tab", { name: "Jugadores" }).click();
await m.getByText("Ana", { exact: true }).waitFor();
await m.screenshot({ path: `${SH}/Retiro-lista.png` });
await m.getByRole("button", { name: "Retirar a Ana" }).click();
await m.screenshot({ path: `${SH}/Retiro-confirmar.png` });
await m.getByRole("button", { name: "Sí, retirar" }).click();
await m.getByText("Retiraste a Ana.").waitFor();
console.log("QUEDAN:", await m.locator(".lista-simple li").count());
await m.screenshot({ path: `${SH}/Retiro-hecho.png` });
// Ana intenta ofrecer una pieza: vuelve a la entrada con el aviso
await ana.locator(".mano button, .mano [role=button]").first().click();
await ana.getByRole("button", { name: "Ofrecer a otra persona" }).click();
await ana.getByText("El personal retiró tu partida").waitFor();
await ana.screenshot({ path: `${SH}/Retiro-jugador.png` });
await ana.locator("input").first().fill("Ana 2");
await ana.getByRole("button", { name: "Empezar a jugar" }).click();
await ana.getByText("Tu mano").waitFor();
console.log("ANA VUELVE:", await ana.locator(".marca-jugador").innerText());

// 2) Anular un código con motivo
const cami = await e.jugador("Cami", { colores: ["verde","cafe","rojo","verde","cafe","rojo"] });
const pr = (await cami.cli.post(`${P}/premios`, { premioId: "p3" })).body;
await m.getByRole("tab", { name: "Canjear" }).click();
await m.locator("#canje").fill(pr.codigoCanje);
await m.getByRole("button", { name: "Buscar" }).click();
await m.getByRole("button", { name: "Anular código" }).click();
await m.locator("#motivo").selectOption("fraude");
await m.screenshot({ path: `${SH}/Anular-motivo.png` });
await m.getByRole("button", { name: "Sí, anular" }).click();
await m.getByText("Código anulado.").waitFor();
console.log("PREMIO:", e.docs("premio").map((d) => d.estado));

// 3) Reinicio programado: el reinicio cae en 90 min; se adelanta el reloj 2 h
const adm = e.cliente({ user: "admin" });
await adm.put("/config", { reinicio: { modo: "diario", hora: hhmmLima(Date.now() + 90 * 60_000), zona: "America/Lima" } });
await beto.reload();
await beto.getByText("Las partidas se reinician todos los días").waitFor();
await beto.screenshot({ path: `${SH}/Reinicio-aviso-pie.png` });
const volver = adelantarReloj(2 * 3600_000);
try {
  await beto.reload();
  await beto.getByText("¿Cómo te llamamos?").waitFor();
  await beto.screenshot({ path: `${SH}/Reinicio-entrada.png` });
  await beto.locator("input").first().fill("Beto");
  await beto.getByRole("button", { name: "Empezar a jugar" }).click();
  await beto.getByText("Tu mano").waitFor();
  console.log("BETO NUEVA PARTIDA OK");
} finally { volver(); }
console.log("OK");
await br.close(); await e.cerrar();
