import { useCallback, useEffect, useMemo, useState } from "react";
import { crearApiStaff } from "../api-staff.js";
import { Aviso, Boton, useSondeo } from "../componentes.jsx";
import {
  ESTADOS_PREMIO, PESTANAS_LISTA, fechaCorta, formatearCanje, mensajeStaff, normalizarCanje, sinPermiso, sinSesion,
} from "../lib/mesero.js";

// Pantalla del mesero (5.82): /agatas/app/?m=mesero. Valida el código de canje de un premio y lo marca como entregado
// (o lo anula). La sesión es la de `cuenta`; el servidor comprueba juego:validar y juego:leer en cada ruta.
export default function Mesero() {
  const api = useMemo(() => crearApiStaff(), []);
  const [vista, setVista] = useState("canjear");
  const [bloqueo, setBloqueo] = useState(null); // "sesion" | "permiso"

  const revisar = useCallback((e) => {
    if (sinSesion(e)) setBloqueo("sesion");
    return e;
  }, []);

  return (
    <main className="app">
      <header className="marca">
        <span className="marca-nombre">Gecko Café · Mesero</span>
      </header>
      {bloqueo === "sesion" ? (
        <section className="tarjeta">
          <h1>Entra a tu cuenta</h1>
          <p className="suave">Tu sesión no está iniciada o caducó. Entra en Cuenta y vuelve a abrir esta pantalla.</p>
          <a className="boton primario" href="../../cuenta/">Ir a Cuenta</a>
        </section>
      ) : (
        <>
          <nav className="pestanas" role="tablist" aria-label="Secciones">
            {[["canjear", "Canjear"], ["lista", "Premios"], ["jugadores", "Jugadores"]].map(([id, t]) => (
              <button key={id} type="button" role="tab" aria-selected={vista === id} className={vista === id ? "pestana activa" : "pestana"} onClick={() => setVista(id)}>
                {t}
              </button>
            ))}
          </nav>
          {vista === "canjear" && <Canjear api={api} revisar={revisar} onBloqueo={setBloqueo} />}
          {vista === "lista" && <Lista api={api} revisar={revisar} />}
          {vista === "jugadores" && <Jugadores api={api} revisar={revisar} />}
        </>
      )}
    </main>
  );
}

function Canjear({ api, revisar, onBloqueo }) {
  const [texto, setTexto] = useState("");
  const [premio, setPremio] = useState(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const codigo = normalizarCanje(texto);

  function limpiar() {
    setTexto("");
    setPremio(null);
    setAnulando(false);
    setMotivo("");
  }

  async function buscar(e) {
    e?.preventDefault();
    if (!codigo || trabajando) return;
    setTrabajando(true);
    setError("");
    setOk("");
    setPremio(null);
    try {
      setPremio(await api.consultar(codigo));
    } catch (err) {
      revisar(err);
      setError(mensajeStaff(err));
      if (sinPermiso(err)) onBloqueo?.("permiso");
    } finally {
      setTrabajando(false);
    }
  }

  async function cerrar(accion) {
    setTrabajando(true);
    setError("");
    try {
      const r = accion === "entregar" ? await api.entregar(codigo) : await api.anular(codigo, motivo.trim());
      setPremio(r);
      setAnulando(false);
      setOk(accion === "entregar" ? "Listo: premio entregado." : "Código anulado.");
    } catch (err) {
      revisar(err);
      setError(mensajeStaff(err));
      // Si otra persona lo cerró antes, se muestra cómo quedó.
      if (err.codigo === "YA_PROCESADO") {
        try {
          setPremio(await api.consultar(codigo));
        } catch {
          /* se queda el aviso */
        }
      }
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <section className="tarjeta" aria-labelledby="t-canjear">
      <h1 id="t-canjear">Canjear un premio</h1>
      <form onSubmit={buscar} className="form-canje">
        <label htmlFor="canje">Código que te muestra la persona</label>
        <input
          id="canje"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="8X56-9XPL"
          value={texto}
          onChange={(e) => setTexto(formatearCanje(e.target.value))}
        />
        <Boton type="submit" cargando={trabajando && !premio} disabled={!codigo}>Buscar</Boton>
      </form>
      <Aviso>{error}</Aviso>
      <Aviso tipo="info">{ok}</Aviso>

      {premio && (
        <article className="resultado-canje" aria-live="polite">
          <p className="sobretitulo">{ESTADOS_PREMIO[premio.estado] ?? premio.estado}</p>
          <h2>{premio.premio?.nombre}</h2>
          {premio.premio?.descripcion && <p className="suave">{premio.premio.descripcion}</p>}
          <p>
            Jugador: <strong>{premio.jugador ?? "—"}</strong>
          </p>
          <p className="codigo-canje" aria-label={`Código ${premio.codigoCanje}`}>{premio.codigoCanje}</p>
          {premio.estado === "pendiente" && !anulando && (
            <div className="acciones">
              <Boton cargando={trabajando} onClick={() => cerrar("entregar")}>Entregar premio</Boton>
              <Boton variante="peligro" disabled={trabajando} onClick={() => setAnulando(true)}>Anular código</Boton>
            </div>
          )}
          {premio.estado === "pendiente" && anulando && (
            <div className="acciones">
              <label htmlFor="motivo">Motivo (opcional)</label>
              <input id="motivo" maxLength={120} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la persona no jugó limpio" />
              <Boton variante="peligro" cargando={trabajando} onClick={() => cerrar("anular")}>Sí, anular</Boton>
              <Boton variante="secundario" disabled={trabajando} onClick={() => setAnulando(false)}>Volver</Boton>
            </div>
          )}
          {premio.estado !== "pendiente" && <Boton variante="secundario" onClick={limpiar}>Canjear otro código</Boton>}
        </article>
      )}
    </section>
  );
}

function Lista({ api, revisar }) {
  const [estado, setEstado] = useState("pendiente");
  const [lista, setLista] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await api.premios(estado);
      setLista(r.premios ?? []);
      setError("");
    } catch (err) {
      revisar(err);
      setError(mensajeStaff(err));
    }
  }, [api, estado, revisar]);

  useEffect(() => {
    setLista(null);
    cargar();
  }, [cargar]);
  useSondeo(cargar, 10000, estado === "pendiente");

  return (
    <section className="tarjeta" aria-labelledby="t-lista">
      <h1 id="t-lista">Premios</h1>
      <div className="chips" role="group" aria-label="Estado">
        {PESTANAS_LISTA.map(([id, t]) => (
          <button key={id} type="button" aria-pressed={estado === id} className={estado === id ? "chip activo" : "chip"} onClick={() => setEstado(id)}>
            {t}
          </button>
        ))}
      </div>
      <Aviso>{error}</Aviso>
      {lista === null && !error && <p className="cargando" role="status">Cargando…</p>}
      {lista?.length === 0 && <p className="suave">No hay premios {estado === "pendiente" ? "pendientes" : estado === "entregado" ? "entregados" : "anulados"}.</p>}
      <ul className="lista-simple">
        {lista?.map((p) => (
          <li key={p.prCode}>
            <div>
              <strong>{p.premio}</strong>
              <span className="suave"> · {p.jugador}</span>
              <div className="suave">{fechaCorta(p.creado)}</div>
            </div>
            <span className="codigo-canje" aria-label={`Código ${p.codigoCanje}`}>{p.codigoCanje}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Jugadores({ api, revisar }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    try {
      setLista((await api.partidas()).partidas ?? []);
      setError("");
    } catch (err) {
      revisar(err);
      setError(mensajeStaff(err));
    }
  }, [api, revisar]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useSondeo(cargar, 15000, true);

  return (
    <section className="tarjeta" aria-labelledby="t-jug">
      <h1 id="t-jug">Jugadores</h1>
      <Aviso>{error}</Aviso>
      {lista === null && !error && <p className="cargando" role="status">Cargando…</p>}
      {lista?.length === 0 && <p className="suave">Todavía nadie ha empezado a jugar.</p>}
      <ul className="lista-simple">
        {lista?.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.apodo}</strong>
              <div className="suave">{fechaCorta(p.creada)}</div>
            </div>
            <span>{p.distintos} {p.distintos === 1 ? "color" : "colores"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
