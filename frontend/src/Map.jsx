import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect} from "react";

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

const NEUTRAL_COLOR = "#7C3AED";


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

function MapController({ activeEvent, userLocation }) {
  const map = useMap();

  useEffect(() => {
    if (activeEvent) {
      map.closePopup();
      map.flyTo([activeEvent.lat, activeEvent.lng], 15, { duration: 0.8 });
    }
  }, [activeEvent, map]);

  useEffect(() => {
    // Vuela a la ubicacion del usuario cada vez que cambia -- al cargar
    // la app, y tambien cada vez que se pide de nuevo con el boton de
    // "centrar en mi ubicacion". Solo si no hay un evento del chat ya
    // centrado, para no sacarle el foco a algo que el usuario esta
    // mirando. Cierra cualquier popup abierto antes de volar -- un
    // popup abierto puede interferir con el movimiento programatico del
    // mapa en Leaflet.
    if (userLocation && !activeEvent) {
      map.closePopup();
      map.flyTo([userLocation.lat, userLocation.lng], 13, { duration: 1 });
    }
  }, [userLocation, activeEvent, map]);

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

// Mismo lenguaje visual que la tarjeta del carrusel (flyer, tags de genero,
// boton solido), adaptado al espacio mas chico de un popup de Leaflet: sin
// bleed de la imagen a los bordes, tipografia mas compacta.
function PopupContent({ ev }) {
  return (
    <div className="w-56">
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
          className="mt-2 block text-center bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium py-1.5 rounded-full transition-colors"
        >
          Comprar entrada
        </a>
      )}
    </div>
  );
}


export default function Map({
  events, loading, error, filter, onFilterChange,
  mode, activeIndex, onNext, onPrev,userLocation, onLocateMe, isPersonalized
}) {
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const isChatMode = mode === "chat" && events.length > 0;
  const activeEvent = isChatMode ? events[activeIndex] : null;

  // Normaliza cada score de afinidad contra el maximo actualmente
  // visible en el mapa -- asi el anillo siempre se ve proporcional, sin
  // depender de valores absolutos fijos que van a cambiar a medida que
  // se agreguen pesos reales por genero.
  const maxAffinity = Math.max(0, ...events.map((ev) => ev.affinity_score || 0));

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
        <MapController activeEvent={activeEvent} userLocation={userLocation} />
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
              maxAffinity > 0 ? (ev.affinity_score || 0) / maxAffinity : 0,
              isPersonalized
            )}
          >
            <Popup maxWidth={260}>
              <PopupContent ev={ev} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}