import { useEffect, useState } from "react";
import { EventCard } from "./Map";

const API_BASE = "http://localhost:8000";

// Modal propio para "Eventos guardados" -- antes era una pestaña mas
// adentro de UserPanel ("Tu cuenta"), pero guardar/sacar eventos es una
// accion mucho mas frecuente que editar perfil o seguridad, asi que
// ahora tiene su propio acceso directo (icono de corazon en el Navbar,
// mismo lenguaje que guardar un post en Instagram) en vez de estar
// escondida atras de una pestaña generica.
export default function SavedEvents({ accessToken, genreWeights, savedEventIds, onToggleSaved, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function fetchSaved() {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/users/me/saved-events`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`API respondió ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch(() => {
        setError("No se pudieron cargar los eventos guardados");
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtrado por el Set global (savedEventIds), no por el array local de
  // "events" -- ese Set es el que ya actualiza el corazon al instante
  // (desde esta lista o desde el mapa/chat), asi que sacar un evento de
  // guardados lo saca de aca sin pedirle nada de nuevo al server.
  const visibleEvents = events.filter((ev) => savedEventIds?.has(ev.id));

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="flyer-modal flyer-pop-enter rounded-2xl max-w-2xl w-full h-[600px] max-h-[85vh] flex flex-col">
        <div className="p-5 flyer-modal-border border-b flex items-center justify-between flex-shrink-0">
          <h2 className="flyer-sans font-bold text-lg" style={{ color: "var(--flyer-paper)" }}>
            Eventos guardados
          </h2>
          <button
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
            className="flyer-text-muted hover:opacity-100 text-xl leading-none transition-opacity"
            style={{ color: "var(--flyer-paper)", opacity: 0.55 }}
          >
            ×
          </button>
        </div>

        <div className="p-5 flex-1 min-h-0">
          {loading ? (
            <p className="flyer-sans flyer-text-faint text-sm">Cargando eventos guardados...</p>
          ) : error ? (
            <p className="flyer-sans flyer-banner-error text-sm rounded-lg px-3 py-2 inline-block">{error}</p>
          ) : visibleEvents.length === 0 ? (
            <p className="flyer-sans flyer-text-faint text-sm">
              Todavía no guardaste ningún evento. Los vas a poder guardar desde su tarjeta en el mapa.
            </p>
          ) : (
            <div className="h-full overflow-y-auto p-1 -m-1 flex flex-wrap content-start gap-4">
              {visibleEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  ev={ev}
                  genreWeights={genreWeights}
                  isSaved={true}
                  onToggleSave={() => onToggleSaved(ev.id)}
                  onRemove={() => onToggleSaved(ev.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
