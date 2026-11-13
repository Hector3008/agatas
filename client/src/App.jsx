import { useCallback, useEffect, useMemo, useState } from "react";
import { crearApi } from "./api.js";
import { Aviso } from "./componentes.jsx";
import Entrada from "./pantallas/Entrada.jsx";
import Mano from "./pantallas/Mano.jsx";
import Intercambio from "./pantallas/Intercambio.jsx";
import Mesero from "./pantallas/Mesero.jsx";
import { contraste, esMesero, leerParametros, mensajeError } from "./lib/util.js";
import { textoReinicio } from "./lib/reinicio.js";

function fijarInvitacion(inv) {
  const u = new URL(window.location.href);
  if (inv) u.searchParams.set("i", inv);
  else u.searchParams.delete("i");
  window.history.replaceState(null, "", u);
}

export default function App() {
  if (esMesero(window.location.search)) return <Mesero />;
  return <Juego />;
}

function Juego() {
  const { slug, invitacion } = useMemo(() => leerParametros(window.location.search), []);
  const [info, setInfo] = useState(null);
  const [partida, setPartida] = useState(undefined); // undefined = cargando; null = todavía no juega
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null); // por qué volvió a la entrada (la retiraron, se reinició el juego)
  const [pantalla, setPantalla] = useState(invitacion ? { tipo: "intercambio", inv: invitacion } : { tipo: "mano" });
  const api = useMemo(
    () =>
      slug
        ? crearApi(slug, {
            alPerder: (codigo, mensaje) => {
              setPartida(null);
              setPantalla({ tipo: "mano" });
              if (codigo !== "SIN_PARTIDA") setAviso(mensaje);
            },
          })
        : null,
    [slug],
  );

  const recargar = useCallback(async () => {
    try {
      setPartida(await api.partida());
    } catch (e) {
      if (e.codigo === "SIN_PARTIDA") setPartida(null);
      else if (!e.red) setError(mensajeError(e));
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        setInfo(await api.info());
      } catch (e) {
        setError(e.status === 404 ? "Este juego no está disponible." : mensajeError(e));
        return;
      }
      await recargar();
    })();
  }, [api, recargar]);

  const ir = useCallback((p) => {
    fijarInvitacion(p.tipo === "intercambio" ? p.inv : null);
    setPantalla(p);
    window.scrollTo?.({ top: 0 });
  }, []);

  if (!slug) {
    return (
      <main className="app">
        <section className="tarjeta">
          <h1>Juego de agatas</h1>
          <p className="suave">Falta el enlace del juego. Escanea el código QR que hay en el local para entrar.</p>
        </section>
      </main>
    );
  }
  if (error && !info) {
    return (
      <main className="app">
        <section className="tarjeta">
          <h1>Juego de agatas</h1>
          <Aviso>{error}</Aviso>
        </section>
      </main>
    );
  }
  if (!info || partida === undefined) {
    return (
      <main className="app">
        <p className="cargando" role="status">Cargando…</p>
      </main>
    );
  }

  const acento = partida?.color?.hex ?? "#c4622d";
  const estilo = { "--acento": acento, "--acento-texto": contraste(acento) };

  return (
    <main className="app" style={estilo}>
      <header className="marca">
        <span className="marca-nombre">{slug}</span>
        {partida && <span className="marca-jugador">{partida.apodo}</span>}
      </header>
      {error && <Aviso>{error}</Aviso>}
      {partida === null ? (
        <Entrada
          info={info}
          api={api}
          invitacion={invitacion}
          aviso={aviso}
          onPartida={(p) => {
            setAviso(null);
            setPartida(p);
          }}
        />
      ) : pantalla.tipo === "intercambio" ? (
        <Intercambio
          info={info}
          partida={partida}
          api={api}
          slug={slug}
          inv={pantalla.inv}
          onCambio={recargar}
          onSalir={() => ir({ tipo: "mano" })}
        />
      ) : (
        <Mano info={info} partida={partida} api={api} onCambio={recargar} onIr={ir} />
      )}
      {textoReinicio(info.reinicio) && <p className="pie-reinicio">{textoReinicio(info.reinicio)}</p>}
    </main>
  );
}
