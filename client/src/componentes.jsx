import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { contraste, reloj, restante } from "./lib/util.js";

export function Boton({ variante = "primario", cargando = false, children, ...resto }) {
  return (
    <button className={`boton ${variante}`} disabled={cargando || resto.disabled} {...resto}>
      {cargando ? "Un momento…" : children}
    </button>
  );
}

export function Aviso({ tipo = "error", children }) {
  if (!children) return null;
  return (
    <div className={`aviso ${tipo}`} role={tipo === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/** Una ágata: piedra redonda del color, con el número de su código. */
export function Agata({ color, numero, seleccionada, reservada, onClick, etiqueta, tam = "normal" }) {
  const hex = color?.hex ?? "#999999";
  const estilo = { "--piedra": hex, "--sobre": contraste(hex) };
  const contenido = (
    <>
      <span className="piedra" style={estilo} aria-hidden="true">
        <span className="numero">{numero}</span>
      </span>
      <span className="agata-nombre">{etiqueta ?? color?.nombre ?? ""}</span>
      {reservada && <span className="agata-estado">en intercambio</span>}
    </>
  );
  const clase = `agata ${tam}${seleccionada ? " seleccionada" : ""}${reservada ? " reservada" : ""}`;
  if (!onClick) return <div className={clase}>{contenido}</div>;
  return (
    <button type="button" className={clase} onClick={onClick} aria-pressed={seleccionada ?? false}>
      {contenido}
    </button>
  );
}

/** Pastilla de color con su nombre. */
export function Ficha({ color, extra }) {
  const hex = color?.hex ?? "#999999";
  return (
    <span className="ficha">
      <span className="punto" style={{ background: hex }} aria-hidden="true" />
      {color?.nombre ?? "?"}
      {extra ? <span className="ficha-extra">{extra}</span> : null}
    </span>
  );
}

/** Cuenta regresiva a partir de los segundos que dice el servidor en cada respuesta. */
export function CuentaRegresiva({ segundos, etiqueta = "Tiempo restante" }) {
  const fin = useRef(0);
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    fin.current = Date.now() + (segundos ?? 0) * 1000;
    setAhora(Date.now());
  }, [segundos]);
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (segundos == null) return null;
  const quedan = restante(fin.current, ahora);
  return (
    <p className="cuenta" aria-live="off">
      {etiqueta} <strong>{reloj(quedan)}</strong>
    </p>
  );
}

/** QR dibujado como SVG (sin imágenes externas ni innerHTML). */
export function Qr({ texto, titulo }) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const datos = qr.modules.data;
  const margen = 3;
  let ruta = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (datos[y * n + x]) ruta += `M${x + margen} ${y + margen}h1v1h-1z`;
    }
  }
  const lado = n + margen * 2;
  return (
    <svg className="qr" viewBox={`0 0 ${lado} ${lado}`} role="img" aria-label={titulo} shapeRendering="crispEdges">
      <rect width={lado} height={lado} fill="#ffffff" />
      <path d={ruta} fill="#1b1410" />
    </svg>
  );
}

/** Llama a `fn` cada `ms` mientras `activo` y la pestaña esté visible; y al volver a verla. */
export function useSondeo(fn, ms, activo) {
  const ultima = useRef(fn);
  ultima.current = fn;
  useEffect(() => {
    if (!activo) return undefined;
    let ocupado = false;
    const correr = async () => {
      if (ocupado || document.visibilityState !== "visible") return;
      ocupado = true;
      try {
        await ultima.current();
      } finally {
        ocupado = false;
      }
    };
    const t = setInterval(correr, ms);
    document.addEventListener("visibilitychange", correr);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", correr);
    };
  }, [ms, activo]);
}
