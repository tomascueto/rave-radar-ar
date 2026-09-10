import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useEffect } from "react";
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

function markerStyle(precision) {
  switch (precision) {
    case "exact":
      return { color: "#7C3AED", radius: 9, opacity: 1 };
    case "llm_search":
      return { color: "#2DD4BF", radius: 8, opacity: 1 };
    case "city":
    default:
      return { color: "#94A3B8", radius: 6, opacity: 0.55 };
  }
}

function makeIcon(precision, isActive) {
  const { color, radius, opacity } = markerStyle(precision);
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

function MapController({ activeEvent }) {
  const map = useMap();
  useEffect(() => {
    if (activeEvent) {
      map.flyTo([activeEvent.lat, activeEvent.lng], 15, { duration: 0.8 });
    }
  }, [activeEvent, map]);
  return null;
}

// Tarjeta rediseñada: flyer real como imagen de fondo (con degradado para
// que el contador se lea encima), tags de genero, y el link de compra
// como boton solido en vez de texto subrayado.
function EventCarousel({ events, activeIndex, onNext, onPrev }) {
  if (!events.length) return null;
  const ev = events[activeIndex];

  return (
    <div className="absolute top-20 right-4 z-[1000] w-72 bg-white rounded-2xl shadow-xl overflow-hidden">
      <div className="relative h-32 bg-gradient-to-br from-violet-500 to-violet-700">
        {ev.flyer_url && (
          <img
            src={ev.flyer_url}
            alt={ev.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.target.style.display = "none"; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

        <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 flex justify-between">
          <button
            onClick={onPrev}
            disabled={activeIndex === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 text-slate-700 text-lg disabled:opacity-0 hover:bg-white shadow transition-opacity"
          >
            ‹
          </button>
          <button
            onClick={onNext}
            disabled={activeIndex === events.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 text-slate-700 text-lg disabled:opacity-0 hover:bg-white shadow transition-opacity"
          >
            ›
          </button>
        </div>

        <span className="absolute top-2 right-2 text-[10px] font-medium text-white bg-black/40 px-2 py-0.5 rounded-full">
          {activeIndex + 1} / {events.length}
        </span>
      </div>

      <div className="p-3">
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
            className="mt-3 block text-center bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-full transition-colors"
          >
            Comprar entrada
          </a>
        )}
      </div>
    </div>
  );
}

export default function Map({
  events, loading, error, filter, onFilterChange,
  mode, activeIndex, onNext, onPrev,
}) {
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const isChatMode = mode === "chat" && events.length > 0;
  const activeEvent = isChatMode ? events[activeIndex] : null;

  return (
    <div className="relative h-full w-full">
      <FilterBar active={filter} onChange={onFilterChange} />

      {isChatMode && (
        <EventCarousel events={events} activeIndex={activeIndex} onNext={onNext} onPrev={onPrev} />
      )}

      {loading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 px-3 py-1 rounded-full text-sm text-slate-500 shadow">
          Cargando...
        </div>
      )}

      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={20} />
        <MapController activeEvent={activeEvent} />

        {events.map((ev, idx) => (
          <Marker
            key={ev.id}
            position={[ev.lat, ev.lng]}
            icon={makeIcon(ev.venue_precision, isChatMode && idx === activeIndex)}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">{ev.name}</p>
                <p className="text-slate-600">{ev.venue_name}</p>
                <p className="text-slate-500">
                  {new Date(ev.date_from).toLocaleDateString("es-AR", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                  })}
                </p>
                {ev.venue_precision === "city" && (
                  <p className="text-xs text-amber-600 mt-1">
                    Ubicacion aproximada (centro de la ciudad)
                  </p>
                )}
                {ev.ticket_url && (
                  <a
                    href={ev.ticket_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-600 underline text-xs break-all"
                  >
                    Comprar entrada
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}