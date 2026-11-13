import { useState } from "react";
import { Aviso, Boton } from "../componentes.jsx";
import { capitalizar, mensajeError } from "../lib/util.js";

export default function Entrada({ info, api, invitacion, aviso = null, onPartida }) {
  const [apodo, setApodo] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const plural = info.personaje.plural;

  async function entrar(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      onPartida(await api.crearPartida(apodo));
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  if (info.requiereCuenta) {
    return (
      <section className="tarjeta entrada">
        <h1>Juego de {plural}</h1>
        <Aviso tipo="info">Para jugar necesitas iniciar sesión con tu cuenta. Pídele ayuda al personal del local.</Aviso>
      </section>
    );
  }

  return (
    <section className="tarjeta entrada">
      <h1>Juego de {plural}</h1>
      <p className="lead">
        Junta {info.premios[0]?.umbral ?? 3} colores distintos o más intercambiando {plural} con otras personas del
        local. Cada intercambio se hace cara a cara, respondiendo una pregunta.
      </p>
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
      {invitacion && <Aviso tipo="info">Te invitaron a un intercambio. Escribe tu apodo y entra para verlo.</Aviso>}
      <form onSubmit={entrar}>
        <label htmlFor="apodo">¿Cómo te llamamos?</label>
        <input
          id="apodo"
          value={apodo}
          onChange={(e) => setApodo(e.target.value)}
          placeholder="Tu apodo"
          maxLength={24}
          autoComplete="nickname"
          autoFocus
        />
        <Aviso>{error}</Aviso>
        <Boton type="submit" cargando={cargando} disabled={apodo.trim().length < 2}>
          Empezar a jugar
        </Boton>
      </form>
      {(info.textos?.instrucciones || info.textos?.reglas) && (
        <details className="como">
          <summary>Cómo se juega</summary>
          {info.textos.instrucciones && <p>{info.textos.instrucciones}</p>}
          {info.textos.reglas && <p>{info.textos.reglas}</p>}
        </details>
      )}
      <p className="pie">{capitalizar(plural)}: tu partida queda guardada en este celular.</p>
    </section>
  );
}
