import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 12;

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;
const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`;
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "hoy", label: "Hoy" },
  { key: "finde", label: "Este finde" },
  { key: "semana", label: "Próximos 7 días" },
  { key: "mes", label: "Este mes" },
];

export function getDateRange(filterKey) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filterKey) {
    case "hoy": {
      const to = new Date(startOfToday);
      to.setDate(to.getDate() + 1);
      return { from: startOfToday, to };
    }
    case "finde": {
      const day = now.getDay();
      let daysToFriday;
      if (day === 0) daysToFriday = -2;
      else if (day === 6) daysToFriday = -1;
      else daysToFriday = 5 - day;

      const from = new Date(startOfToday);
      from.setDate(from.getDate() + daysToFriday);
      const to = new Date(from);
      to.setDate(to.getDate() + 3);
      to.setHours(8, 0, 0, 0);
      return { from, to };
    }
    case "semana": {
      const to = new Date(startOfToday);
      to.setDate(to.getDate() + 7);
      return { from: startOfToday, to };
    }
    case "mes": {
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from: startOfToday, to };
    }
    case "todos":
    default:
      return { from: null, to: null };
  }
}

const NEUTRAL_COLOR = "#7C3AED"; // violeta de marca -- sin datos de afinidad (no logueado o sin preferencias)

function affinityColor(ratio) {
  if (ratio >= 0.5) return "#16A34A"; // verde fuerte: entre los que mas coinciden
  if (ratio > 0) return "#86EFAC"; // verde claro: coincide algo, no es de los mejores
  return "#FB923C"; // naranja: no coincide con ningun genero preferido
}

function makeIcon(precision, isActive, affinityRatio, isPersonalized) {
  const color = isPersonalized ? affinityColor(affinityRatio) : NEUTRAL_COLOR;
  // La opacidad, no el color, es lo que ahora comunica precision
  // geografica: un venue sin direccion real (fallback a ciudad) se
  // dibuja casi invisible, en vez de ocupar un color propio.
  const opacity = precision === "city" ? 0.25 : 1;
  const radius = 8;
  const size = isActive ? radius * 2 + 10 : radius * 2;
  const border = isActive ? 3 : 2;

  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};opacity:${opacity};
      border:${border}px solid white;border-radius:50%;
      box-shadow:0 1px 4px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeUserLocationIcon() {
  // Punto azul con pulso animado -- mismo lenguaje visual que Google Maps
  // o Uber para "estás acá", bien diferenciado de los pines de eventos
  // (violeta/verde/gris). El <style> va adentro del propio HTML del
  // icono porque L.divIcon no tiene acceso a una hoja de estilos global.
  return L.divIcon({
    className: "",
    html: `
      <style>
        @keyframes pulse-location {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      </style>
      <div style="position:relative;width:20px;height:20px;">
        <div style="
          position:absolute;top:4px;left:4px;width:12px;height:12px;
          background:#3B82F6;border-radius:50%;
          animation:pulse-location 2s ease-out infinite;
        "></div>
        <div style="
          position:absolute;top:4px;left:4px;width:12px;height:12px;
          background:#3B82F6;border:2px solid white;border-radius:50%;
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
        "></div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function FilterBar({ active, onChange }) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex gap-1 bg-white/95 backdrop-blur-sm rounded-full p-1 shadow-lg">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`px-3 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap ${
            active === f.key
              ? "bg-violet-600 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function MapController({ flyToEvent, userLocation, isChatMode }) {
  const map = useMap();

  // Se lee el valor actual de flyToEvent sin que sea una dependencia del
  // segundo efecto -- si lo fuera, CERRAR una tarjeta (flyToEvent pasando
  // a null) dispararia ese efecto de nuevo, interpretandolo como "ya no
  // hay nada mostrado, volemos a la ubicacion del usuario". Cerrar una
  // tarjeta no deberia mover el mapa para nada.
  const flyToEventRef = useRef(flyToEvent);
  flyToEventRef.current = flyToEvent;

  useEffect(() => {
    if (flyToEvent) {
      // En el carrusel del chat, siempre se lleva a un zoom fijo (15) --
      // asi cada evento se ve con el mismo nivel de detalle. Explorando
      // libremente, en cambio, se respeta el zoom que el usuario ya
      // tenia elegido: un click en un pin centra, no reencuadra.
      const targetZoom = isChatMode ? 15 : map.getZoom();
      map.flyTo([flyToEvent.lat, flyToEvent.lng], targetZoom, { duration: 0.8 });
    }
  }, [flyToEvent, isChatMode, map]);

  useEffect(() => {
    // Reacciona SOLO a cambios reales de userLocation (primera
    // resolucion, o un nuevo click en "centrar en mi ubicacion") -- no a
    // cada cambio de flyToEvent.
    if (userLocation && !flyToEventRef.current) {
      map.flyTo([userLocation.lat, userLocation.lng], 13, { duration: 1 });
    }
  }, [userLocation, map]);

  return null;
}

// Contenido de la tarjeta de detalle (foto, generos, boton de compra) --
// usado tanto al explorar el mapa libremente como al navegar resultados
// del chat. Ya no vive dentro de un popup de Leaflet: es un elemento
// propio, centrado en la pantalla con CSS simple (ver EventDetailOverlay).
function EventCard({ ev }) {
  return (
    <div className="w-56 bg-white rounded-2xl shadow-2xl p-3">
      {ev.flyer_url && (
        <img
          src={ev.flyer_url}
          alt={ev.name}
          className="w-full h-24 object-cover rounded-lg mb-2"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      )}
      <p className="font-semibold text-sm text-slate-800 leading-snug">{ev.name}</p>
      <p className="text-sm text-slate-500 mt-0.5">{ev.venue_name}</p>
      <p className="text-xs text-slate-400 mt-1 capitalize">
        {new Date(ev.date_from).toLocaleDateString("es-AR", {
          weekday: "long", day: "2-digit", month: "2-digit",
        })}
      </p>

      {ev.genres && ev.genres.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ev.genres.slice(0, 3).map((g) => (
            <span
              key={g}
              className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-600 rounded-full font-medium"
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {ev.venue_precision === "city" && (
        <p className="text-[11px] text-amber-600 mt-2">
          Ubicación aproximada (centro de la ciudad)
        </p>
      )}

      {ev.ticket_url && (
        <a
          href={ev.ticket_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "white" }}
          className="mt-3 block text-center bg-violet-600 hover:bg-violet-700 text-sm font-medium py-2 rounded-full transition-colors"
        >
          Comprar entrada
        </a>
      )}
    </div>
  );
}

// Dos modos, dos comportamientos -- no un solo mecanismo tratando de
// servir a los dos:
//
// - Explorando el mapa libremente (isChatMode=false): clickear un pin
//   muestra su tarjeta centrada; clickear afuera la cierra. Perder la
//   tarjeta no cuesta nada -- se vuelve a clickear el mismo pin.
//
// - Navegando resultados del chat (isChatMode=true): la tarjeta se
//   muestra centrada con flechas a los costados, siempre en el mismo
//   lugar (independiente del pin). Clickear afuera NO la cierra -- perder
//   el carrusel entero obligaria a volver al chat y pedir los eventos de
//   nuevo. Solo las flechas, la X, o cambiar de filtro lo cierran.
function EventDetailOverlay({
  ev, isChatMode, activeIndex, total, onNext, onPrev, onClose,
}) {
  if (!ev) return null;

  return (
    <div
      className={`absolute inset-0 z-[1500] flex items-center justify-center ${
        isChatMode ? "pointer-events-none" : ""
      }`}
      onClick={isChatMode ? undefined : onClose}
    >
      <div
        className="relative flex items-center gap-3 pointer-events-auto"
        style={{ transform: "translateY(-170px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {isChatMode && (
          <button
            onClick={onPrev}
            disabled={activeIndex === 0}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-lg text-slate-700 text-xl disabled:opacity-30 hover:bg-slate-50 transition-colors"
          >
            ‹
          </button>
        )}

        <div className="relative">
          <button
            onClick={onClose}
            title="Cerrar"
            className="absolute -top-2.5 -right-2.5 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-white shadow-lg text-slate-400 hover:text-slate-600 text-sm transition-colors"
          >
            ×
          </button>
          {isChatMode && (
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 bg-white shadow-lg rounded-full text-[10px] text-slate-500 font-medium px-2 py-0.5">
              {activeIndex + 1} / {total}
            </span>
          )}
          <EventCard ev={ev} />
        </div>

        {isChatMode && (
          <button
            onClick={onNext}
            disabled={activeIndex === total - 1}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-lg text-slate-700 text-xl disabled:opacity-30 hover:bg-slate-50 transition-colors"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

export default function Map({
  events, loading, error, filter, onFilterChange,
  mode, activeIndex, onNext, onPrev, userLocation, onLocateMe, genreWeights,
  onCloseCarousel,
}) {
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const isChatMode = mode === "chat" && events.length > 0;
  const activeEvent = isChatMode ? events[activeIndex] : null;

  // Selección al explorar libremente (fuera del chat) -- independiente
  // de activeIndex, que es exclusivamente del carrusel del chat.
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Limpia la selección libre en cuanto se entra en modo chat, para que
  // no queden los dos superpuestos.
  useEffect(() => {
    if (isChatMode) setSelectedEvent(null);
  }, [isChatMode]);

  const displayedEvent = isChatMode ? activeEvent : selectedEvent;
  const flyToEvent = displayedEvent;

  // isPersonalized: hay al menos una preferencia real guardada -- no
  // solo "esta logueado", para no pintar todo de naranja a alguien que
  // nunca completo la encuesta (ver mas abajo, affinityColor).
  const isPersonalized = genreWeights && Object.keys(genreWeights).length > 0;

  // Afinidad calculada ACA, en cada render, a partir de los pesos mas
  // recientes -- no viene precalculada del backend. Esto es lo que
  // arregla que un resultado viejo del chat (guardado en memoria desde
  // antes de un cambio de preferencias) siempre se pinte con el color
  // correcto: no importa cuando se trajo el evento, la afinidad se
  // recalcula con los pesos de AHORA cada vez que se dibuja.
  function affinityScoreFor(ev) {
    if (!isPersonalized || !ev.genre_ids) return 0;
    return ev.genre_ids.reduce((sum, gid) => sum + (genreWeights[gid] || 0), 0);
  }

  // Normaliza cada score contra el maximo actualmente visible en el
  // mapa -- asi el gradiente siempre se ve proporcional, sin depender
  // de valores absolutos fijos.
  const maxAffinity = Math.max(0, ...events.map(affinityScoreFor));

  return (
    <div className="relative h-full w-full">
      <FilterBar active={filter} onChange={onFilterChange} />

      <button
        onClick={onLocateMe}
        title="Centrar en mi ubicación"
        className="absolute bottom-6 right-4 z-[1000] w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 2V5M12 19V22M22 12H19M5 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {loading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 px-3 py-1 rounded-full text-sm text-slate-500 shadow">
          Cargando...
        </div>
      )}

      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={20} />
        <MapController flyToEvent={flyToEvent} userLocation={userLocation} isChatMode={isChatMode} />

        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={makeUserLocationIcon()}
            zIndexOffset={1000}
          >
            <Popup>Tu ubicación</Popup>
          </Marker>
        )}

        {events.map((ev, idx) => (
          <Marker
            key={ev.id}
            position={[ev.lat, ev.lng]}
            icon={makeIcon(
              ev.venue_precision,
              isChatMode && idx === activeIndex,
              maxAffinity > 0 ? affinityScoreFor(ev) / maxAffinity : 0,
              isPersonalized
            )}
            eventHandlers={{
              click: () => {
                // En modo chat, la navegacion es solo por flechas -- un
                // click directo en un pin no cambia la seleccion.
                if (!isChatMode) setSelectedEvent(ev);
              },
            }}
          />
        ))}
      </MapContainer>

      <EventDetailOverlay
        ev={displayedEvent}
        isChatMode={isChatMode}
        activeIndex={activeIndex}
        total={events.length}
        onNext={onNext}
        onPrev={onPrev}
        onClose={isChatMode ? onCloseCarousel : () => setSelectedEvent(null)}
      />
    </div>
  );
}