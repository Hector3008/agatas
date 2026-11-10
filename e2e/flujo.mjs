import { chromium } from "playwright";
import { preparar } from "../test/ayudas.js";
const SH = "./capturas";
const e = await preparar();
const base = e.url.replace(/\/agatas$/, "");
const app = `${base}/agatas/app/?e=gecko`;
const br = await chromium.launch();
const mk = async (scheme) => { const c = await br.newContext({ viewport:{width:390,height:800}, colorScheme:scheme }); const p = await c.newPage(); p.on("pageerror", x=>console.log("PAGEERR", x.message)); p.on("console", m=>{ if(m.type()==="error") console.log("CONSOLE", m.text()); }); return p; };
const a = await mk("light"), b = await mk("dark");
for (const [p,n] of [[a,"Ana"],[b,"Beto"]]) { await p.goto(app); await p.locator("input").first().fill(n); await p.getByRole("button").first().click(); await p.getByText("Tu mano").waitFor(); }
// Ana ofrece
await a.locator(".mano button, .mano [role=button]").first().click();
await a.getByRole("button",{name:"Ofrecer a otra persona"}).click();
await a.locator(".codigo-grande").waitFor();
const codigo = (await a.locator(".codigo-grande").innerText()).trim();
console.log("CODIGO", codigo, "QR svg:", await a.locator("svg").count());
await a.screenshot({ path: `${SH}/Ana-oferta.png` });
// Beto se une por código
await b.getByRole("button",{name:"Tengo un código"}).click();
await b.locator("input[placeholder=K7MQ2XTA]").fill(codigo);
await b.getByRole("button",{name:/Unirme|Continuar|Buscar|Ir|Entrar/}).last().click().catch(async()=>{ await b.locator("input[placeholder=K7MQ2XTA]").press("Enter"); });
await b.getByRole("button",{name:"Aceptar el intercambio"}).waitFor();
await b.screenshot({ path: `${SH}/Beto-unirse.png` });
await b.locator(".mano button, .mano [role=button]").first().click();
await b.getByRole("button",{name:"Aceptar el intercambio"}).click();
await b.getByRole("button",{name:/confirmar/}).waitFor();
await a.getByRole("button",{name:/confirmar/}).waitFor({timeout:8000});
await a.screenshot({ path: `${SH}/Ana-preguntas.png` });
await b.screenshot({ path: `${SH}/Beto-preguntas.png` });
await a.getByRole("button",{name:/confirmar/}).click();
await b.getByRole("button",{name:/confirmar/}).click();
await a.getByText("¡Intercambio hecho!").waitFor({timeout:8000});
await b.getByText("¡Intercambio hecho!").waitFor({timeout:8000});
await a.screenshot({ path: `${SH}/Ana-hecho.png` });
await a.getByRole("button",{name:"Ver mi mano"}).click();
await a.getByText("Tu mano").waitFor();
console.log("ANA FINAL:", (await a.locator(".progreso-colores").getAttribute("aria-label")), (await a.locator("body").innerText()).split("\n").filter(l=>/×|de 6/.test(l)).join(" | "));
console.log("BETO tras:", (await e.cliente({}) && ""), "");
await br.close(); await e.cerrar();
