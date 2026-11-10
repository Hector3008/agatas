import { useState } from "react";
import { Aviso, Boton } from "../componentes.jsx";
import { faltan, mensajeError } from "../lib/util.js";

const CANJE = {
  pendiente: "Muéstrale este código al mesero.",
  entregado: "Ya recibiste este premio.",
  anulado: "Este código fue anulado. Habla con el personal.",
};

export default function Premios({ partida, api, onCambio }) {
  const [reclamando, setReclamando] = useState(null);
  const [error, setError] = useState(null);

  async function reclamar(id) {
    setError(null);
    setReclamando(id);
    try {
      await api.reclamar(id);
      await onCambio();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setReclamando(null);
    }
  }

  return (
    <section className="premios" aria-labelledby="t-premios">
      <h2 id="t-premios">Premios</h2>
      <Aviso>{error}</Aviso>
      <ul>
        {partida.premios.map((p) => {
          const pct = Math.min(100, Math.round((partida.distintos / p.umbral) * 100));
          return (
            <li key={p.id} className={`premio ${p.estado}`}>
              <div className="premio-cabeza">
                <strong>{p.nombre}</strong>
                <span className="umbral">{p.umbral} colores</span>
              </div>
              {p.descripcion && <p className="suave">{p.descripcion}</p>}
              {p.estado === "bloqueado" && (
                <>
                  <div className="barra" role="progressbar" aria-valuemin={0} aria-valuemax={p.umbral} aria-valuenow={Math.min(partida.distintos, p.umbral)}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <p className="suave">
                    Tienes {partida.distintos}: te {faltan(partida.distintos, p.umbral) === 1 ? "falta 1 color" : `faltan ${faltan(partida.distintos, p.umbral)} colores`}.
                  </p>
                </>
              )}
              {p.estado === "disponible" && (
                <Boton cargando={reclamando === p.id} onClick={() => reclamar(p.id)}>
                  Reclamar premio
                </Boton>
              )}
              {p.estado === "reclamado" && (
                <div className="canje">
                  <span className="codigo-canje" aria-label={`Código ${p.codigoCanjeTexto}`}>{p.codigoCanjeTexto}</span>
                  <p className="suave">{CANJE[p.estadoCanje] ?? CANJE.pendiente}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
