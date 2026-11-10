import { useState } from "react";
import { Agata, Aviso, Boton, Ficha, useSondeo } from "../componentes.jsx";
import Premios from "./Premios.jsx";
import { capitalizar, extraerInvitacion, mensajeError, resumenColores } from "../lib/util.js";

const ESTADO = { propuesto: "esperando pareja", aceptado: "falta confirmar", creandose: "preparándose" };

export default function Mano({ info, partida, api, onCambio, onIr }) {
  const [elegida, setElegida] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [verCodigo, setVerCodigo] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const colorDe = (id) => info.colores.find((c) => c.id === id);
  const totalColores = info.colores.length;
  const abiertos = partida.intercambios ?? [];

  // Con intercambios abiertos se consulta cada pocos segundos por si la otra persona se unió o confirmó.
  useSondeo(onCambio, 4000, abiertos.length > 0);

  const libre = partida.mano.find((a) => a.aid === elegida && !a.reservada);

  async function ofrecer() {
    setError(null);
    setCargando(true);
    try {
      const v = await api.proponer(libre.aid);
      setElegida(null);
      await onCambio();
      onIr({ tipo: "intercambio", inv: v.invitacion });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(false);
    }
  }

  function irPorCodigo(e) {
    e.preventDefault();
    const inv = extraerInvitacion(codigo);
    if (!inv) {
      setError("El código tiene 8 letras y números, por ejemplo K7MQ2XTA.");
      return;
    }
    setError(null);
    onIr({ tipo: "intercambio", inv });
  }

  return (
    <>
      <section className="tarjeta resumen">
        <p className="sobretitulo">Hola, {partida.apodo}</p>
        <h1>{totalColores > 0 ? `${partida.distintos} de ${totalColores} colores` : "Tu mano"}</h1>
        <div className="progreso-colores" aria-label="Colores que tienes">
          {info.colores.map((c) => {
            const tiene = partida.colores.includes(c.id);
            return (
              <span key={c.id} className={`gota${tiene ? " tiene" : ""}`} style={{ "--piedra": c.hex }} title={`${c.nombre}${tiene ? "" : " (te falta)"}`}>
                <span className="sr">{c.nombre} {tiene ? "(lo tienes)" : "(te falta)"}</span>
              </span>
            );
          })}
        </div>
        <p className="suave">
          Tu color: <Ficha color={partida.color} />. Cambia {info.personaje.plural} con otras personas para juntar más colores.
        </p>
      </section>

      <section className="tarjeta" aria-labelledby="t-mano">
        <h2 id="t-mano">Tu mano</h2>
        <div className="mano">
          {partida.mano.map((a, i) => (
            <Agata
              key={a.aid}
              color={colorDe(a.colorId)}
              numero={a.codigo.split("-").pop()}
              seleccionada={elegida === a.aid}
              reservada={a.reservada}
              onClick={() => (a.reservada ? onIr({ tipo: "intercambio", inv: a.invitacion }) : setElegida(elegida === a.aid ? null : a.aid))}
              etiqueta={colorDe(a.colorId)?.nombre}
            />
          ))}
        </div>
        <p className="suave resumen-colores">
          {resumenColores(partida.mano).map((r) => `${colorDe(r.colorId)?.nombre ?? r.colorId} ×${r.n}`).join(" · ")}
        </p>
        <Aviso>{error}</Aviso>
        {libre ? (
          <div className="acciones" aria-live="polite">
            <p>
              Elegiste <strong>{colorDe(libre.colorId)?.nombre}</strong>. La reservamos mientras dura el intercambio.
            </p>
            <Boton cargando={cargando} onClick={ofrecer}>
              Ofrecer a otra persona
            </Boton>
          </div>
        ) : (
          <p className="suave">Toca {info.personaje.singular === "agata" ? "una agata" : `un ${info.personaje.singular}`} para ofrecerla en un intercambio.</p>
        )}
      </section>

      {abiertos.length > 0 && (
        <section className="tarjeta" aria-labelledby="t-abiertos">
          <h2 id="t-abiertos">Intercambios abiertos</h2>
          <ul className="abiertos">
            {abiertos.map((x) => (
              <li key={x.invitacion}>
                <button type="button" className="enlace-fila" onClick={() => onIr({ tipo: "intercambio", inv: x.invitacion })}>
                  <span>{x.invitacion}</span>
                  <span className="suave">{ESTADO[x.estado] ?? x.estado}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tarjeta" aria-labelledby="t-unirme">
        <h2 id="t-unirme">¿Te invitaron a un intercambio?</h2>
        <p className="suave">Escanea el QR de la otra persona con la cámara del celular, o escribe su código.</p>
        {!verCodigo ? (
          <Boton variante="secundario" onClick={() => setVerCodigo(true)}>
            Tengo un código
          </Boton>
        ) : (
          <form onSubmit={irPorCodigo} className="fila-codigo">
            <label htmlFor="codigo" className="sr">Código del intercambio</label>
            <input
              id="codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="K7MQ2XTA"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
              autoFocus
            />
            <Boton type="submit" disabled={codigo.trim().length < 8}>
              Ver
            </Boton>
          </form>
        )}
      </section>

      <Premios partida={partida} api={api} onCambio={onCambio} />

      {(info.textos?.instrucciones || info.textos?.reglas) && (
        <details className="como tarjeta">
          <summary>Cómo se juega</summary>
          {info.textos.instrucciones && <p>{info.textos.instrucciones}</p>}
          {info.textos.reglas && <p>{info.textos.reglas}</p>}
        </details>
      )}
      <p className="pie">
        {capitalizar(info.personaje.plural)} · Cupo de intercambios esta hora: {partida.cupo.usados} de {partida.cupo.max}
      </p>
    </>
  );
}
