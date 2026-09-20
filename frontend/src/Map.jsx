import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export const DEFAULT_CENTER = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 12;

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;
export const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`;
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Ícono de radar -- reusado en el estado de carga (girando, "buscando") y
// en el estado vacío (quieto, con un pulso único: "ya barrió y no encontró
// nada"). Dibujado, no emoji -- mismo criterio que el resto del sistema.
function RadarIcon({ className, style }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3" opacity="0.35" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path d="M12 12L12 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

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

// Leidos de affinityColor en vez de repetir los hex a mano -- un solo lugar
// decide que es "matchea fuerte/parcial/nada", tanto para un pin individual
// como para el color de un cluster (ver dominantClusterColor mas abajo).
const STRONG_MATCH_COLOR = affinityColor(1);
const PARTIAL_MATCH_COLOR = affinityColor(0.25);

function makeIcon(precision, isActive, affinityRatio, isPersonalized, animate = false, delayMs = 0) {
  const color = isPersonalized ? affinityColor(affinityRatio) : NEUTRAL_COLOR;
  // La opacidad, no el color, es lo que ahora comunica precision
  // geografica: un venue sin direccion real (fallback a ciudad) se
  // dibuja casi invisible, en vez de ocupar un color propio.
  const opacity = precision === "city" ? 0.25 : 1;
  const radius = 8;
  const size = isActive ? radius * 2 + 10 : radius * 2;
  const border = isActive ? 3 : 2;

  // Entrada sutil SOLO para pines genuinamente nuevos en el mapa (ver
  // prevEventIdsRef mas abajo) -- nunca se vuelve a disparar por un cambio
  // de seleccion en el carrusel o un recalculo de afinidad sobre un pin
  // que ya estaba en pantalla. El valor final de opacidad es el mismo de
  // siempre; solo cambia si se llega a el con una animacion o de una.
  const opacityStyle = animate
    ? `--pin-final-opacity:${opacity};animation-delay:${delayMs}ms;`
    : `opacity:${opacity};`;

  // Textura -- puramente visual, no toca color ni opacidad: sombra mas
  // marcada + hover (definidas en .flyer-pin, index.css) y un pequeño
  // ecualizador dibujado adentro del circulo, a modo de guiño al genero
  // del evento sin agregar un canal de informacion nuevo (el mismo icono,
  // mismo color base, en todos los pines).
  return L.divIcon({
    className: "",
    html: `<div class="flyer-pin${animate ? " flyer-pin-enter" : ""}" style="
      width:${size}px;height:${size}px;
      background:${color};${opacityStyle}
      border:${border}px solid white;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
    ">
      <svg viewBox="0 0 24 24" fill="none" style="width:48%;height:48%;pointer-events:none;">
        <rect x="6" y="10" width="3" height="8" rx="1" fill="white" fill-opacity="0.85" />
        <rect x="10.5" y="5" width="3" height="13" rx="1" fill="white" fill-opacity="0.85" />
        <rect x="15" y="8" width="3" height="10" rx="1" fill="white" fill-opacity="0.85" />
      </svg>
    </div>`,
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
  // Thumb violeta que se desliza al filtro activo -- se mide contra el
  // ancho real de cada boton (las etiquetas no son todas del mismo largo)
  // en vez de asumir un tamaño fijo. Puramente visual: onChange/active
  // siguen siendo la unica fuente de verdad de cual filtro esta aplicado.
  const containerRef = useRef(null);
  const buttonRefs = useRef({});
  const [thumb, setThumb] = useState(null);

  useLayoutEffect(() => {
    function measure() {
      const btn = buttonRefs.current[active];
      const container = containerRef.current;
      if (!btn || !container) return;
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setThumb({ left: btnRect.left - containerRect.left, width: btnRect.width });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex gap-1 flyer-pill rounded-full p-1"
    >
      {thumb && (
        <div
          className="absolute top-1 bottom-1 rounded-full flyer-filter-thumb"
          style={{ left: thumb.left, width: thumb.width }}
          aria-hidden="true"
        />
      )}
      {FILTERS.map((f) => (
        <button
          key={f.key}
          ref={(el) => { buttonRefs.current[f.key] = el; }}
          onClick={() => onChange(f.key)}
          className={`relative z-10 flyer-sans px-3 py-1.5 text-xs font-medium uppercase tracking-wide rounded-full transition-colors whitespace-nowrap ${
            active === f.key ? "flyer-filter-text-active" : "flyer-pill-text"
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

// Reemplaza el control de zoom nativo de Leaflet (+/-) por un slider
// horizontal que muestra la distancia visible en km -- mas legible que un
// numero de zoom abstracto para alguien decidiendo si "cerca mio" cubre
// todo lo que quiere ver.
function ZoomSlider() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [km, setKm] = useState(0);
  const containerRef = useRef(null);

  // Cualquier control HTML propio puesto adentro del MapContainer hereda
  // los listeners de arrastre/scroll del mapa a menos que se los bloquee
  // explicitamente -- sin esto, arrastrar el slider arrastraba el mapa
  // en vez de mover el thumb. Los controles nativos de Leaflet (el +/-
  // que reemplazamos) hacen esto automaticamente via L.Control; el
  // nuestro, al ser un div de React, tiene que pedirlo a mano.
  useEffect(() => {
    if (!containerRef.current) return;
    L.DomEvent.disableClickPropagation(containerRef.current);
    L.DomEvent.disableScrollPropagation(containerRef.current);
  }, []);

  useEffect(() => {
    function update() {
      const currentZoom = map.getZoom();
      const lat = map.getCenter().lat;
      // Resolucion de Web Mercator: metros por pixel en esta latitud y
      // zoom, multiplicado por el ancho del contenedor en pixels.
      const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, currentZoom);
      const visibleKm = (metersPerPixel * map.getSize().x) / 1000;
      setZoom(currentZoom);
      setKm(visibleKm);
    }

    update();
    map.on("zoomend", update);
    map.on("moveend", update);
    return () => {
      map.off("zoomend", update);
      map.off("moveend", update);
    };
  }, [map]);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flyer-pill rounded-full flex items-center gap-3 px-4 py-2"
    >
      <input
        type="range"
        min={3}
        max={18}
        step={1}
        value={zoom}
        onChange={(e) => map.setZoom(Number(e.target.value))}
        aria-label="Zoom del mapa"
        className="flyer-zoom-range w-40"
      />
      <span className="flyer-sans flyer-text-muted text-xs whitespace-nowrap tabular-nums">
        ~{Math.round(km)} km
      </span>
    </div>
  );
}

// Misma formula que _distance_km en rag/query_executor.py -- necesaria
// aca para decidir en el cliente si un cluster es "un solo lugar" (varios
// eventos en el mismo venue) o "varios lugares cercanos" sin llamar al
// backend por eso.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Agrupa los pines de eventos cuando estan muy cerca entre si. Un click en
// un cluster tiene dos comportamientos distintos segun que tan apretado
// esta:
// - Cluster "ancho" (eventos en lugares distintos, solo cerca en el mapa
//   actual): hace zoom a sus bounds, como el comportamiento default de
//   Leaflet.markercluster -- deja que el usuario los separe visualmente.
// - Cluster "angosto" (< 30m de diagonal -- practicamente el mismo venue,
//   zoom no los va a separar nunca): abre un mini-carrusel con esos
//   eventos, reusando el mismo EventDetailOverlay que ya sirve al chat.
function EventClusterLayer({ events, setClusterCarousel, isPersonalized, genreWeights, children }) {
  const map = useMap();
  const groupRef = useRef(null);

  // Los pines hijos se taggean con su propio color ya calculado (ver el
  // ref en el .map() de Marker, mas abajo en Map) -- pero leaflet.markercluster
  // arma el <div> del cluster UNA vez y no lo vuelve a tocar solo porque
  // cambio un option en sus hijos. refreshClusters() lo fuerza a reconstruir
  // los iconos cada vez que cambia lo que decide el color (login, encuesta
  // de generos editada).
  useEffect(() => {
    groupRef.current?.refreshClusters();
  }, [isPersonalized, genreWeights]);

  function handleClusterClick(e) {
    const cluster = e.layer;
    const bounds = cluster.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const diagonalKm = haversineKm(sw.lat, sw.lng, ne.lat, ne.lng);

    if (diagonalKm < 0.03) {
      const childLatLngs = cluster.getAllChildMarkers().map((m) => m.getLatLng());
      const childEvents = events.filter((ev) =>
        childLatLngs.some(
          (ll) => Math.abs(ll.lat - ev.lat) < 1e-6 && Math.abs(ll.lng - ev.lng) < 1e-6
        )
      );
      setClusterCarousel({ events: childEvents, index: 0 });
    } else {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  return (
    <MarkerClusterGroup
      ref={groupRef}
      spiderfyOnMaxZoom={false}
      zoomToBoundsOnClick={false}
      showCoverageOnHover={false}
      eventHandlers={{ clusterclick: handleClusterClick }}
      iconCreateFunction={makeClusterIcon}
    >
      {children}
    </MarkerClusterGroup>
  );
}

// Color dominante de un cluster -- para no perder de vista un match adentro
// de un grupo de pines violeta. Si predomina (mitad o mas) el match fuerte,
// el cluster se pinta del mismo verde fuerte; si hay match pero es
// minoritario, verde claro; sin ningun match, el color que ya compartan
// todos los hijos (violeta si no esta personalizado, naranja si lo esta
// pero ninguno matchea).
function dominantClusterColor(colors) {
  if (colors.length === 0) return NEUTRAL_COLOR;
  const matchCount = colors.filter(
    (c) => c === STRONG_MATCH_COLOR || c === PARTIAL_MATCH_COLOR
  ).length;
  if (matchCount === 0) return colors[0];
  return matchCount / colors.length >= 0.5 ? STRONG_MATCH_COLOR : PARTIAL_MATCH_COLOR;
}

// Reemplaza el ícono default de leaflet.markercluster (que requiere su
// propio CSS, nunca importado -- ver DESIGN.md) por uno propio en el mismo
// lenguaje visual que .flyer-pin: mismo sistema de color que los pines
// individuales (ver dominantClusterColor), borde blanco, y el conteo de
// eventos agrupados.
function makeClusterIcon(cluster) {
  const children = cluster.getAllChildMarkers();
  const count = children.length;
  const colors = children.map((m) => m.options.flyerColor || NEUTRAL_COLOR);
  const color = dominantClusterColor(colors);
  const size = count >= 20 ? 48 : count >= 10 ? 42 : 36;
  return L.divIcon({
    html: `<div class="flyer-cluster flyer-sans" style="width:${size}px;height:${size}px;font-size:${
      size >= 42 ? 15 : 13
    }px;background:${color};">${count}</div>`,
    className: "",
    iconSize: [size, size],
  });
}

// Ocupa el lugar de la foto cuando el evento no tiene flyer_url -- mismo
// alto que <img>, para que la tarjeta nunca cambie de tamaño segun tenga
// foto o no (ver EventDetailOverlay: eso es lo que descalibraba las
// flechas del carrusel de un evento al siguiente).
function FlyerPlaceholderIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3" opacity="0.5" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.1" opacity="0.35" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

// Contenido de la tarjeta de detalle (foto, generos, boton de compra) --
// usado tanto al explorar el mapa libremente como al navegar resultados
// del chat: un solo componente, sin ninguna version reducida para el
// carrusel. Ya no vive dentro de un popup de Leaflet: es un elemento
// propio, centrado en la pantalla con CSS simple (ver EventDetailOverlay).
function EventCard({ ev, genreWeights }) {
  // Generos del evento que tambien estan entre las preferencias guardadas
  // del usuario -- se resaltan distinto (ver .flyer-chip-match). genres y
  // genre_ids vienen del backend como arrays paralelos (mismo indice).
  const preferredGenreIds = genreWeights ? new Set(Object.keys(genreWeights)) : null;

  return (
    <div className="w-64 flyer-card p-3">
      {ev.flyer_url ? (
        <img
          src={ev.flyer_url}
          alt={ev.name}
          className="w-full h-28 object-cover flyer-card-image mb-2"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      ) : (
        <div className="w-full h-28 flyer-card-image flyer-card-placeholder mb-2 flex items-center justify-center">
          <FlyerPlaceholderIcon className="w-8 h-8" />
        </div>
      )}
      <p className="flyer-sans flyer-card-ink font-bold uppercase tracking-wide text-base leading-snug">
        {ev.name}
      </p>
      <p className="flyer-sans flyer-card-ink-muted text-sm mt-1">{ev.venue_name}</p>
      <p className="flyer-sans flyer-card-ink-muted text-xs mt-1 capitalize">
        {new Date(ev.date_from).toLocaleDateString("es-AR", {
          weekday: "long", day: "2-digit", month: "2-digit",
        })}
      </p>

      {ev.genres && ev.genres.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ev.genres.slice(0, 3).map((g, i) => {
            const gid = ev.genre_ids?.[i];
            const isMatch = preferredGenreIds && gid && preferredGenreIds.has(gid);
            return (
              <span
                key={g}
                className={`flyer-sans text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                  isMatch ? "flyer-chip-match" : "flyer-chip"
                }`}
              >
                {g}
              </span>
            );
          })}
        </div>
      )}

      {ev.venue_precision === "city" && (
        <p className="flyer-sans flyer-warning text-[11px] mt-2">
          Ubicación aproximada (centro de la ciudad)
        </p>
      )}

      {ev.ticket_url && (
        <a
          href={ev.ticket_url}
          target="_blank"
          rel="noreferrer"
          className="flyer-cta flyer-sans mt-3 block text-center uppercase tracking-wide font-bold text-sm py-2.5 transition-colors"
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
  ev, isChatMode, activeIndex, total, onNext, onPrev, onClose, genreWeights,
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
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full flyer-icon-btn text-xl disabled:opacity-30 transition-colors"
          >
            ‹
          </button>
        )}

        <div className="relative">
          <button
            onClick={onClose}
            title="Cerrar"
            className="absolute -top-2.5 -right-2.5 z-10 w-7 h-7 flex items-center justify-center rounded-full flyer-icon-btn text-sm transition-colors"
          >
            ×
          </button>
          {isChatMode && (
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 flyer-badge flyer-sans rounded-full text-[10px] font-medium px-2 py-0.5">
              {activeIndex + 1} / {total}
            </span>
          )}
          <EventCard ev={ev} genreWeights={genreWeights} />
        </div>

        {isChatMode && (
          <button
            onClick={onNext}
            disabled={activeIndex === total - 1}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full flyer-icon-btn text-xl disabled:opacity-30 transition-colors"
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

  // Mini-carrusel de un cluster muy apretado (ver EventClusterLayer). Toma
  // prioridad sobre el carrusel del chat y sobre la selección libre: es
  // siempre la interacción MAS reciente del usuario, así que gana hasta
  // que se cierra explícitamente.
  const [clusterCarousel, setClusterCarousel] = useState(null);

  const baseDisplayedEvent = isChatMode ? activeEvent : selectedEvent;
  const displayedEvent = clusterCarousel
    ? clusterCarousel.events[clusterCarousel.index]
    : baseDisplayedEvent;
  const flyToEvent = displayedEvent;
  const overlayIsCarousel = clusterCarousel ? true : isChatMode;

  function handleOverlayNext() {
    if (clusterCarousel) {
      setClusterCarousel((c) => ({ ...c, index: Math.min(c.index + 1, c.events.length - 1) }));
    } else {
      onNext();
    }
  }

  function handleOverlayPrev() {
    if (clusterCarousel) {
      setClusterCarousel((c) => ({ ...c, index: Math.max(c.index - 1, 0) }));
    } else {
      onPrev();
    }
  }

  function handleOverlayClose() {
    if (clusterCarousel) {
      setClusterCarousel(null);
    } else if (isChatMode) {
      onCloseCarousel();
    } else {
      setSelectedEvent(null);
    }
  }

  // Ids ya vistos en el mapa -- se actualiza DESPUES de cada render donde
  // "events" cambio, nunca durante. Esto es lo que permite distinguir un
  // pin genuinamente nuevo (recien llegado con un cambio de filtro o de
  // resultados del chat) de un re-render por otro motivo (seleccionar en
  // el carrusel, o que lleguen los pesos de afinidad mas tarde) -- ese
  // segundo caso jamas debe repetir la animacion de entrada.
  const prevEventIdsRef = useRef(new Set());
  useEffect(() => {
    prevEventIdsRef.current = new Set(events.map((ev) => ev.id));
  }, [events]);

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
        className="absolute bottom-6 right-4 z-[1000] w-10 h-10 rounded-full flex items-center justify-center flyer-icon-btn transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 2V5M12 19V22M22 12H19M5 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {loading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] flyer-pill flex items-center gap-2 px-3.5 py-1.5 rounded-full">
          <RadarIcon className="w-3.5 h-3.5 flyer-radar-spin" style={{ color: "var(--flyer-violet)" }} />
          <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">
            Escaneando la ciudad…
          </span>
        </div>
      )}

      {!loading && events.length === 0 && (
        <div className="absolute inset-0 z-[900] flex items-center justify-center px-6 pointer-events-none">
          <div className="flyer-pill rounded-2xl px-6 py-5 max-w-[240px] text-center pointer-events-auto">
            <div
              className="relative w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center flyer-radar-ping"
              style={{ background: "rgba(124, 58, 237, 0.15)" }}
            >
              <RadarIcon className="w-6 h-6" style={{ color: "var(--flyer-violet)" }} />
            </div>
            <p className="flyer-sans font-bold text-sm" style={{ color: "var(--flyer-paper)" }}>
              El radar no capta nada
            </p>
            <p className="flyer-sans flyer-text-muted text-xs mt-1.5 leading-relaxed">
              No hay fiestas para este filtro. Probá con otro rango de fechas.
            </p>
          </div>
        </div>
      )}

      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} zoomControl={false} className="h-full w-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={20} />
        <MapController flyToEvent={flyToEvent} userLocation={userLocation} isChatMode={isChatMode} />
        <ZoomSlider />

        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={makeUserLocationIcon()}
            zIndexOffset={1000}
          >
            <Popup>Tu ubicación</Popup>
          </Marker>
        )}

        <EventClusterLayer
          events={events}
          setClusterCarousel={setClusterCarousel}
          isPersonalized={isPersonalized}
          genreWeights={genreWeights}
        >
          {events.map((ev, idx) => {
            const ratio = maxAffinity > 0 ? affinityScoreFor(ev) / maxAffinity : 0;
            // Mismo color que ya decide makeIcon, pero guardado ademas en
            // un option propio del marker -- es lo unico que le permite a
            // un cluster (ver makeClusterIcon) saber si adentro hay un
            // match sin tener que recalcular nada por su cuenta.
            const pinColor = isPersonalized ? affinityColor(ratio) : NEUTRAL_COLOR;
            return (
              <Marker
                key={ev.id}
                position={[ev.lat, ev.lng]}
                ref={(marker) => {
                  if (marker) marker.options.flyerColor = pinColor;
                }}
                icon={makeIcon(
                  ev.venue_precision,
                  isChatMode && idx === activeIndex,
                  ratio,
                  isPersonalized,
                  !prevEventIdsRef.current.has(ev.id),
                  Math.min(idx * 18, 260)
                )}
                eventHandlers={{
                  click: () => {
                    // En modo chat, la navegacion es solo por flechas -- un
                    // click directo en un pin no cambia la seleccion.
                    if (!isChatMode) setSelectedEvent(ev);
                  },
                }}
              />
            );
          })}
        </EventClusterLayer>
      </MapContainer>

      <EventDetailOverlay
        ev={displayedEvent}
        isChatMode={overlayIsCarousel}
        activeIndex={clusterCarousel ? clusterCarousel.index : activeIndex}
        total={clusterCarousel ? clusterCarousel.events.length : events.length}
        onNext={handleOverlayNext}
        onPrev={handleOverlayPrev}
        onClose={handleOverlayClose}
        genreWeights={genreWeights}
      />
    </div>
  );
}