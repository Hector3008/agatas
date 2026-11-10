import { useEffect, useRef, useState } from "react";
import { Agata, Aviso, Boton, CuentaRegresiva, Ficha, Qr, useSondeo } from "../componentes.jsx";
import { elegibles, enlaceInvitacion, fase, mensajeError, textoMotivo } from "../lib/util.js";

export default function Intercambio({ info, partida, api, inv, slug, onCambio, onSalir }) {
  const [vista, setVista] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [elegida, setElegida] = useState(null);
  const avisado = useRef(false);
  const colorDe = (id) => info.colores.find((c) => c.id === id);
  const f = fase(vista);

  async function cargar() {
    try {
      const v = await api.ver(inv);
      setVista(v);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e);
    }
  }

  useEffect(() => {
    setVista(null);
    setErrorCarga(null);
    avisado.current = false;
    cargar();
  }, [inv]);

  // Mientras el intercambio siga abierto se consulta cada 2,5 segundos.
  useSondeo(cargar, 2500, ["oferta", "esperando", "preguntas"].includes(f));

  // Al terminar (o cerrarse) se refresca la mano una vez para que refleje el resultado.
  useEffect(() => {
    if ((f === "listo" || f === "cerrado") && !avisado.current) {
      avisado.current = true;
      onCambio();
    }
  }, [f]);

  async function accion(fn) {
    setError(null);
    setTrabajando(true);
    try {
      const v = await fn();
      if (v) setVista(v);
      await onCambio();
    } catch (e) {
      setError(mensajeError(e));
      await cargar();
    } finally {
      setTrabajando(false);
    }
  }

  const volver = (
    <Boton variante="secundario" onClick={onSalir}>
      Volver a mi mano
    </Boton>
  );

  if (errorCarga && !vista) {
    const noExiste = errorCarga.codigo === "INTERCAMBIO_NO_ENCONTRADO";
    return (
      <section className="tarjeta">
        <h1>{noExiste ? "No encontramos ese intercambio" : "Este intercambio no está disponible"}</h1>
        <p className="suave">
          {noExiste ? "Revisa el código o pídele a la otra persona que lo muestre otra vez." : mensajeError(errorCarga)}
        </p>
        {volver}
      </section>
    );
  }
  if (!vista) return <section className="tarjeta"><p className="suave" aria-live="polite">Cargando intercambio…</p></section>;

  // ───── Un tercero abre la invitación: ve el color ofrecido y elige con qué responder ─────
  if (f === "oferta") {
    const color = colorDe(vista.ofrece.colorId);
    const opciones = elegibles(partida.mano, vista.ofrece.colorId);
    return (
      <section className="tarjeta">
        <p className="sobretitulo">Intercambio</p>
        <h1>{vista.de} te ofrece</h1>
        <div className="oferta">
          <Agata color={color} numero="?" tam="grande" />
        </div>
        <p className="suave">
          Una {info.personaje.singular} de color <Ficha color={color} />. ¿Cuál le das a cambio? Elige una de otro color.
        </p>
        <div className="mano" role="group" aria-label="Elige una para dar">
          {partida.mano.map((a) => {
            const ok = opciones.some((o) => o.aid === a.aid);
            return (
              <div key={a.aid} className={ok ? "" : "apagada"}>
                <Agata
                  color={colorDe(a.colorId)}
                  numero={a.codigo.split("-").pop()}
                  seleccionada={elegida === a.aid}
                  reservada={a.reservada}
                  onClick={ok ? () => setElegida(elegida === a.aid ? null : a.aid) : undefined}
                />
              </div>
            );
          })}
        </div>
        {opciones.length === 0 && <Aviso tipo="info">No tienes ninguna de un color distinto al que te ofrecen, así que este intercambio no te sirve.</Aviso>}
        <Aviso>{error}</Aviso>
        <Boton cargando={trabajando} disabled={!elegida} onClick={() => accion(() => api.unirse(inv, elegida))}>
          Aceptar el intercambio
        </Boton>
        {volver}
      </section>
    );
  }

  const mia = colorDe(vista.entrego?.colorId);
  const suya = colorDe(vista.recibo?.colorId);

  // ───── Yo ofrecí y espero pareja: QR y código ─────
  if (f === "esperando") {
    const enlace = enlaceInvitacion(window.location.href, slug, vista.invitacion);
    return (
      <section className="tarjeta centro">
        <p className="sobretitulo">Tu oferta</p>
        <h1>Que la otra persona escanee esto</h1>
        <Qr texto={enlace} titulo={`Código QR del intercambio ${vista.invitacion}`} />
        <p className="suave">…o que escriba este código:</p>
        <p className="codigo-grande" aria-label={`Código ${vista.invitacion.split("").join(" ")}`}>{vista.invitacion}</p>
        <p className="suave">
          Ofreces <Ficha color={mia} />
        </p>
        <CuentaRegresiva segundos={vista.venceEnSeg} etiqueta="La oferta vence en" />
        <Aviso>{error}</Aviso>
        <Boton variante="peligro" cargando={trabajando} onClick={() => accion(() => api.cancelar(inv))}>
          Cancelar oferta
        </Boton>
        {volver}
      </section>
    );
  }

  // ───── Aceptado: las dos preguntas y la confirmación de cada uno ─────
  if (f === "preguntas") {
    const yaConfirme = vista.confirmaciones.yo;
    return (
      <section className="tarjeta">
        <p className="sobretitulo">Intercambio con {vista.con}</p>
        <h1>Respondan las preguntas</h1>
        <p className="suave">
          Cada {info.personaje.singular} trae una pregunta. Contéstenlas en voz alta y, cuando las dos personas hayan respondido, confirmen.
        </p>
        <article className="pregunta">
          <header>
            <Agata color={suya} numero={vista.recibo.codigo.split("-").pop()} tam="chica" />
            <span>
              Recibes <Ficha color={suya} />
            </span>
          </header>
          <p className="texto-pregunta">{vista.recibo.pregunta}</p>
        </article>
        <article className="pregunta">
          <header>
            <Agata color={mia} numero={vista.entrego.codigo.split("-").pop()} tam="chica" />
            <span>
              Entregas <Ficha color={mia} />
            </span>
          </header>
          <p className="texto-pregunta">{vista.entrego.pregunta}</p>
        </article>
        <ul className="confirmaciones" aria-live="polite">
          <li className={vista.confirmaciones.yo ? "si" : ""}>Tú: {vista.confirmaciones.yo ? "confirmaste ✓" : "falta confirmar"}</li>
          <li className={vista.confirmaciones.otro ? "si" : ""}>
            {vista.con}: {vista.confirmaciones.otro ? "confirmó ✓" : "falta confirmar"}
          </li>
        </ul>
        <CuentaRegresiva segundos={vista.venceEnSeg} etiqueta="Tienen" />
        <Aviso>{error}</Aviso>
        <Boton cargando={trabajando} disabled={yaConfirme} onClick={() => accion(() => api.confirmar(inv))}>
          {yaConfirme ? `Esperando a ${vista.con}…` : "Ya respondimos, confirmar"}
        </Boton>
        {!(vista.confirmaciones.yo && vista.confirmaciones.otro) && (
          <Boton variante="peligro" disabled={trabajando} onClick={() => accion(() => api.cancelar(inv))}>
            Cancelar intercambio
          </Boton>
        )}
      </section>
    );
  }

  // ───── Hecho ─────
  if (f === "listo") {
    return (
      <section className="tarjeta centro">
        <p className="sobretitulo">¡Intercambio hecho!</p>
        <h1>Recibiste una de <Ficha color={suya} /></h1>
        <div className="oferta">
          <Agata color={suya} numero={vista.recibo.codigo.split("-").pop()} tam="grande" />
        </div>
        <p className="suave">
          Le diste una de <Ficha color={mia} /> a {vista.con}.
        </p>
        <Boton onClick={onSalir}>Ver mi mano</Boton>
      </section>
    );
  }

  // ───── Cancelado, vencido o ya tomado por otra persona ─────
  return (
    <section className="tarjeta">
      <h1>Intercambio cerrado</h1>
      <p className="suave">{vista.participa ? textoMotivo(vista.motivo) : "Esta oferta ya no está disponible."}</p>
      {volver}
    </section>
  );
}
