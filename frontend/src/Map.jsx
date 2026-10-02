import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export const DEFAULT_CENTER = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 12;

const API_BASE = "http://localhost:8000";

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

function mixHexColors(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const mix = (shift) => {
    const va = (a >> shift) & 255;
    const vb = (b >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `#${[mix(16), mix(8), mix(0)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const STRONG_GREEN = "#16A34A";

// Match parcial: mezcla real de amarillo pastel y el verde fuerte, no un
// verde mas palido -- a pedido explicito del usuario. t=0.3 (mas cerca
// del amarillo que del verde) para que se sienta claramente "mas tibio"
// que un match total sin perder el caracter verde.
const PARTIAL_GREEN_YELLOW = mixHexColors("#FDE68A", STRONG_GREEN, 0.3);

// Naranja de "sin match" mezclado con blanco -- a pedido explicito del
// usuario: el naranja vivo original (#FB923C) se sentia demasiado "de
// alarma" para un evento que igual puede valer la pena. Sigue siendo
// naranja, solo menos agresivo.
const SOFT_ORANGE = mixHexColors("#FB923C", "#FFFFFF", 0.35);

// ratio = proporcion de los PROPIOS generos del evento que coinciden con
// las preferencias guardadas (ver affinityScoreFor mas abajo) -- no
// relativo al mejor puntaje entre los eventos visibles. A pedido
// explicito del usuario: el verde fuerte exige que coincidan TODOS los
// generos del evento, no la mayoria.
function affinityColor(ratio) {
  if (ratio >= 1) return STRONG_GREEN; // coinciden TODOS los generos del evento
  if (ratio > 0) return PARTIAL_GREEN_YELLOW; // coincide alguno, no todos
  return SOFT_ORANGE; // no coincide con ningun genero preferido
}

// Leidos de affinityColor en vez de repetir los hex a mano -- un solo lugar
// decide que es "matchea fuerte/parcial/nada", tanto para un pin individual
// como para el color de un cluster (ver dominantClusterColor mas abajo).
const STRONG_MATCH_COLOR = affinityColor(1);
const PARTIAL_MATCH_COLOR = affinityColor(0.25);
const NO_MATCH_COLOR = affinityColor(0);

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
  // Borde: puramente decorativo, blanco de siempre. El icono interior
  // (ecualizador) SI se queda en ink en vez de volver a blanco -- no es
  // parte de la paleta nueva que se revirtio, es un fix de contraste
  // real independiente (contra el relleno verde-amarillo o naranja el
  // blanco original daba ~1.7:1, muy por debajo del piso; ink llega a
  // 11.5:1+ contra los cuatro colores posibles de afinidad -- mismo
  // motivo que el numero del cluster mas abajo).
  return L.divIcon({
    className: "",
    html: `<div class="flyer-pin${animate ? " flyer-pin-enter" : ""}" style="
      width:${size}px;height:${size}px;
      background:${color};${opacityStyle}
      border:${border}px solid white;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
    ">
      <svg viewBox="0 0 24 24" fill="none" style="width:48%;height:48%;pointer-events:none;">
        <rect x="6" y="10" width="3" height="8" rx="1" fill="#0b0b10" fill-opacity="0.85" />
        <rect x="10.5" y="5" width="3" height="13" rx="1" fill="#0b0b10" fill-opacity="0.85" />
        <rect x="15" y="8" width="3" height="10" rx="1" fill="#0b0b10" fill-opacity="0.85" />
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

// Normaliza para comparar busqueda vs. nombre/venue/genero: minusculas +
// sin diacriticos (NFD separa la letra de su tilde/diéresis como
// caracter combinante aparte, ̀-ͯ los barre) -- asi "cordoba"
// encuentra "Córdoba" en cualquiera de los dos lados de la comparacion.
// Se aplica siempre a ambos lados (nunca solo al query), porque el dato
// que viene del evento tambien puede traer tildes.
function normalizeSearchText(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Coincide si el texto normalizado aparece en el nombre del evento, el
// venue, O CUALQUIERA de sus generos -- basta con uno solo (no los tres a
// la vez). Sobre datos que ya trae el evento del mapa, sin pedir nada
// nuevo al backend.
function eventMatchesSearch(ev, normalizedQuery) {
  if (!normalizedQuery) return true;
  const haystacks = [ev.name, ev.venue_name, ...(ev.genres || [])];
  return haystacks.some((h) => h && normalizeSearchText(h).includes(normalizedQuery));
}

function SearchIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20L15.5 15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Buscador de eventos -- mismo lenguaje visual que FilterBar/GenreFilterMenu
// (trial-pill oscura, texto flyer-sans), ubicado debajo del FilterBar de
// fecha: mismo eje horizontal (centrado), como una segunda fila de chrome
// del mapa en vez de competir por espacio con las 5 píldoras de fecha (que
// ya scrollean horizontal en mobile) o con la columna de género/afinidad a
// la derecha. outline-none en el <input> se reemplaza por un anillo en el
// contenedor entero via :focus-within (ver .flyer-search-pill en
// index.css) -- asi el foco se ve como el borde redondeado de la pildora,
// no como un rectángulo del input recortado por el border-radius del
// padre.
function MapSearchBar({ value, onChange }) {
  return (
    <div className="flyer-search-pill trial-pill absolute top-16 left-1/2 -translate-x-1/2 z-[1000] rounded-full flex items-center gap-2 px-3.5 py-2 w-[min(320px,calc(100vw-32px))]">
      <SearchIcon className="w-4 h-4 flyer-text-muted flex-shrink-0" />
      <label htmlFor="flyer-map-search" className="sr-only">
        Buscar eventos por nombre, lugar o género
      </label>
      <input
        id="flyer-map-search"
        name="map-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Nombre, lugar o género…"
        autoComplete="off"
        className="flyer-sans flyer-search-input bg-transparent border-none text-xs flex-1 min-w-0"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          className="flyer-pill-text flex-shrink-0 rounded-full w-5 h-5 flex items-center justify-center text-sm leading-none transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
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
      if (!btn) return;
      // offsetLeft/offsetWidth, NO getBoundingClientRect: este contenedor
      // scrollea horizontal en mobile, y getBoundingClientRect devuelve
      // coordenadas relativas al VIEWPORT -- contaminadas por el scroll
      // actual en el momento de medir. Eso es lo que desincronizaba el
      // thumb al volver de "Este mes" a otro filtro: al medir, el
      // contenedor todavia estaba scrolleado hacia el final, asi que la
      // resta daba una posicion negativa (el thumb quedaba calculado
      // fuera del area visible, invisible, y ahi se quedaba pegado
      // aunque el scroll despues volviera a 0). offsetLeft es relativo
      // al padre posicionado (este mismo contenedor), nunca cambia con
      // el scroll -- el thumb, al ser un hijo mas del mismo contenedor
      // scrolleable, se mueve solo junto con el scroll sin necesidad de
      // remedirlo.
      setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  useEffect(() => {
    // En mobile la barra completa no entra en el ancho de pantalla (ver
    // overflow-x-auto abajo) -- sin esto, elegir un filtro que cae fuera
    // del recorte inicial lo deja seleccionado pero invisible, sin forma
    // de confirmar que realmente se aplico.
    buttonRefs.current[active]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex gap-1 trial-pill rounded-full p-1 max-w-[calc(100vw-32px)] overflow-x-auto flyer-scroll-hidden"
      style={{ overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch" }}
    >
      {thumb && (
        <div
          className="absolute top-1 left-0 bottom-1 rounded-full flyer-filter-thumb pointer-events-none"
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
          aria-hidden="true"
        />
      )}
      {FILTERS.map((f) => (
        <button
          key={f.key}
          ref={(el) => { buttonRefs.current[f.key] = el; }}
          onClick={() => onChange(f.key)}
          className={`relative z-10 flex-shrink-0 trial-sans px-3 py-2 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
            active === f.key ? "flyer-filter-text-active" : "flyer-pill-text"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function CheckIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12.5L9.5 17L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FunnelIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3.5 4.5h17L14 12.5v6l-4 2v-8L3.5 4.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Filtro por genero -- puramente de frontend: no dispara ningun fetch,
// solo esconde/muestra Markers ya cargados (ver visibleEvents en Map). El
// catalogo se pide una sola vez (misma fuente que alimenta GenreSurvey,
// /api/users/genres/catalog) en vez de derivarlo de "events": derivarlo
// de los eventos visibles cambiaria la lista disponible con cada
// zoom/paneo, lo cual seria inconsistente (a pedido explicito del
// usuario). Colapsado por default -- con ~50 generos en el catalogo, un
// listado siempre abierto al costado del mapa taparia demasiado.
function GenreFilterMenu({ genres, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="flyer-genre-filter-panel"
        aria-label={`Géneros, filtrar por género${selected.size > 0 ? `, ${selected.size} seleccionados` : ""}`}
        className="trial-pill flyer-pill-text flex items-center gap-1.5 rounded-full pl-3 pr-2.5 py-2 transition-colors"
      >
        <FunnelIcon className="w-3.5 h-3.5" />
        <span className="flyer-sans text-xs font-medium">Géneros</span>
        {selected.size > 0 && (
          <span className="flyer-genre-badge flyer-sans" aria-hidden="true">
            {selected.size}
          </span>
        )}
      </button>

      {open && (
        <div
          id="flyer-genre-filter-panel"
          role="group"
          aria-label="Filtrar pines por género"
          className="trial-pill absolute right-full top-0 mr-2 rounded-2xl p-3 w-56"
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="flyer-sans flyer-text-muted text-[11px] uppercase tracking-wide">
              Género
            </span>
            {selected.size > 0 && (
              <button
                onClick={onClear}
                className="flyer-sans flyer-pill-text text-[11px] underline underline-offset-2 transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>
          {/* Lista vertical con alto fijo (no un flex-wrap de píldoras) --
              a pedido explicito: con el catalogo completo (~50 generos) el
              panel tiene que mostrar como maximo 6-7 a la vez y scrollear
              el resto, y con filas de un genero por linea ese numero es
              directo de fijar (max-h calibrado al alto real de una fila +
              gap). Un flex-wrap no permite ese control: cuantos entran por
              fila depende del largo de cada nombre, asi que "6-7 visibles"
              nunca seria consistente. */}
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto flyer-scroll-hidden pr-0.5">
            {genres.map((g) => {
              const isSelected = selected.has(g.id);
              return (
                <button
                  key={g.id}
                  onClick={() => onToggle(g.id)}
                  aria-pressed={isSelected}
                  title={g.name}
                  className={`flyer-sans flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    isSelected ? "flyer-toggle-chip-active" : "flyer-toggle-chip"
                  }`}
                >
                  <span className="truncate text-left min-w-0 flex-1">{g.name}</span>
                  {isSelected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Interruptor "Solo alta afinidad" -- reusa el mismo umbral que ya separa
// el color de coincidencia (verde fuerte/verde-amarillo) del de
// no-coincidencia (naranja) en affinityColor: ratio > 0. No define un
// corte nuevo. El padre (Map) no renderiza este control cuando no hay
// preferencias guardadas, en vez de mostrarlo deshabilitado -- ver
// isPersonalized mas abajo.
function AffinitySwitch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="trial-pill flyer-pill-text flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5 transition-colors"
    >
      <span className="flyer-sans text-xs font-medium">Solo alta afinidad</span>
      <span
        className={`flyer-switch-track ${checked ? "flyer-switch-track-on" : ""}`}
        aria-hidden="true"
      >
        <span className="flyer-switch-thumb" />
      </span>
    </button>
  );
}

// Agrupa los dos filtros puramente de frontend (genero, afinidad) en una
// sola columna a la derecha, centrada verticalmente -- lejos del FilterBar
// de fecha (arriba, centro) y del boton de ubicacion/ZoomSlider (abajo).
// Oculto por completo en modo chat: activeIndex ahi indexa directo sobre
// "events" tal como lo devolvio el chat, y filtrar esa lista rompería esa
// correspondencia -- estos dos filtros son para explorar el mapa, no para
// podar resultados que el chat ya curó.
function MapFiltersPanel({
  genres, selectedGenreIds, onToggleGenre, onClearGenres, showAffinitySwitch, highAffinityOnly, onToggleAffinity,
}) {
  return (
    // top-[42%] en vez de top-1/2 -- un poco mas arriba del centro exacto,
    // a pedido explicito: con el catalogo completo (~50 generos) el panel
    // desplegado de GenreFilterMenu abre hacia abajo (ver top-0 ahi), y
    // centrado en 50% dejaba muy poco margen debajo antes del borde
    // inferior de la pantalla, sobre todo en mobile (navbar + este offset
    // le comen mas proporcion a la altura disponible que en desktop).
    <div className="absolute top-[42%] right-3 sm:right-4 -translate-y-1/2 z-[1000] flex flex-col items-end gap-2">
      {showAffinitySwitch && (
        <AffinitySwitch checked={highAffinityOnly} onChange={onToggleAffinity} />
      )}
      <GenreFilterMenu
        genres={genres}
        selected={selectedGenreIds}
        onToggle={onToggleGenre}
        onClear={onClearGenres}
      />
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

  // Coordenadas del ultimo flyTo realmente disparado -- si el siguiente
  // evento (tipicamente al navegar un mini-carrusel de cluster, ver
  // EventClusterLayer) esta a menos de 30m, es el mismo lugar en la
  // practica: volar igual solo produce un mini salto que va y vuelve al
  // mismo sitio, sin ningun valor informativo.
  const lastFlownCoordsRef = useRef(null);

  useEffect(() => {
    if (flyToEvent) {
      const last = lastFlownCoordsRef.current;
      const samePlace = last && haversineKm(last.lat, last.lng, flyToEvent.lat, flyToEvent.lng) < 0.03;
      if (!samePlace) {
        // En el carrusel del chat, siempre se lleva a un zoom fijo (15) --
        // asi cada evento se ve con el mismo nivel de detalle. Explorando
        // libremente, en cambio, se respeta el zoom que el usuario ya
        // tenia elegido: un click en un pin centra, no reencuadra.
        const targetZoom = isChatMode ? 15 : map.getZoom();
        map.flyTo([flyToEvent.lat, flyToEvent.lng], targetZoom, { duration: 0.8 });
      }
      lastFlownCoordsRef.current = { lat: flyToEvent.lat, lng: flyToEvent.lng };
    } else {
      lastFlownCoordsRef.current = null;
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
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] trial-pill rounded-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2"
    >
      <input
        type="range"
        min={3}
        max={18}
        step={0.05}
        value={zoom}
        onChange={(e) => map.setZoom(Number(e.target.value))}
        aria-label="Zoom del mapa"
        className="trial-zoom-range w-20 sm:w-40"
      />
      <span className="trial-sans flyer-text-muted text-xs whitespace-nowrap tabular-nums">
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
function EventClusterLayer({
  events, setClusterCarousel, clusterCarousel, isPersonalized, genreWeights, children,
}) {
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

  // Mientras el mini-carrusel de un cluster esta abierto, su pin en el
  // mapa se repinta con el color REAL del evento que se esta mostrando en
  // ESE momento (verde fuerte, verde-amarillo, o naranja -- el mismo que
  // ya calculo affinityColor para ese evento puntual) -- no el color
  // "dominante" del cluster entero (ver dominantClusterColor, que solo
  // aplica mientras el cluster esta cerrado). Si adentro de un cluster
  // verde-amarillo hay un evento sin match, navegar hasta el con las
  // flechas del mini-carrusel vuelve a pintar el pin de naranja para ESE
  // evento puntual -- eso es intencional, no un bug: el color dominante y
  // el color del evento activo son dos preguntas distintas.
  // activeClusterOverride (modulo, no React) es la fuente de verdad que
  // lee makeClusterIcon, emparejado por el id de los eventos (NUNCA por
  // identidad del objeto cluster de Leaflet: el cluster que llega en el
  // evento de click puede quedar desprendido del mapa -- _map undefined
  // -- apenas leaflet.markercluster rearma su arbol interno, asi que
  // guardar y despues llamar metodos sobre esa referencia puntual no es
  // confiable). refreshClusters() -- que ya se usa para el color
  // dominante -- es lo que fuerza a reconstruir el icono ya usando el
  // override.
  const clusterOverrideActiveRef = useRef(false);
  useEffect(() => {
    if (clusterCarousel) {
      const { colors, index, events: carouselEvents } = clusterCarousel;
      activeClusterOverride = {
        eventIds: new Set(carouselEvents.map((ev) => ev.id)),
        color: colors[index],
      };
      groupRef.current?.refreshClusters();
      clusterOverrideActiveRef.current = true;
    } else if (clusterOverrideActiveRef.current) {
      activeClusterOverride = null;
      groupRef.current?.refreshClusters();
      clusterOverrideActiveRef.current = false;
    }
  }, [clusterCarousel]);

  function handleClusterClick(e) {
    const cluster = e.layer;
    const bounds = cluster.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const diagonalKm = haversineKm(sw.lat, sw.lng, ne.lat, ne.lng);

    if (diagonalKm < 0.03) {
      // Se arman events y colors juntos, emparejados por indice, para que
      // el efecto de arriba pueda pintar el pin del color exacto del
      // evento activo sin tener que volver a buscar el marker cada vez
      // que cambia el index del carrusel. Se empareja por flyerId (el id
      // del evento, taggeado en el marker igual que flyerColor), NUNCA
      // por coordenadas -- varios eventos de este mismo cluster pueden
      // compartir las coordenadas EXACTAS (fallback "centro de la
      // ciudad"), y matchear por lat/lng ahi siempre devuelve el primer
      // marker encontrado para todos, pintando el pin con el color de un
      // solo evento en vez del que corresponde a cada uno.
      // Objeto plano, no "new Map(...)" -- el default export de este
      // mismo archivo ya se llama Map, y esa colision hace que "new
      // Map(...)" invoque a nuestro propio componente en vez de la clase
      // nativa (rompe con "Invalid hook call").
      const eventsById = {};
      events.forEach((ev) => { eventsById[ev.id] = ev; });
      const children = cluster.getAllChildMarkers();
      const childEvents = [];
      const childColors = [];
      children.forEach((marker) => {
        const ev = eventsById[marker.options.flyerId];
        if (ev) {
          childEvents.push(ev);
          childColors.push(marker.options.flyerColor || NEUTRAL_COLOR);
        }
      });
      setClusterCarousel({ events: childEvents, colors: childColors, index: 0 });
    } else {
      // maxZoom: sin tope, un cluster geograficamente muy apretado (pero
      // igual arriba del umbral de "mismo venue" de 30m) fuerza a
      // fitBounds a acercar hasta el maximo posible para separarlos con
      // el padding pedido -- eso es lo que dejaba los eventos "MUY
      // separados" en pantalla. Con el tope, si un click no alcanza a
      // separarlos del todo a esta distancia, el usuario puede volver a
      // clickear el cluster ya mas cerca -- mejor eso que un acercamiento
      // extremo de una sola vez.
      //
      // 16 se quedaba corto: un cluster de 4 venues a ~140m entre si (caso
      // real: Mandarine Park/The Bow/Rio/Oasis en Punta Carrasco) queda a
      // ~72px de separacion en pantalla a zoom 16 -- por debajo del radio
      // de clustering (80px), asi que nunca se separaba y el cluster
      // quedaba muerto: ni entra en el umbral de 30m (mini-carrusel) ni
      // el zoom llega a soltarlo. 18 le da margen (a esa misma distancia,
      // ~290px a zoom 18) sin acercar tanto como para que clusters recien
      // arriba del umbral de 30m se vean artificialmente estirados por
      // toda la pantalla.
      //
      // PERO 18 fijo tiene un bug propio: para un cluster TODAVIA mas
      // apretado que el caso de arriba (necesita mas de zoom 18 para que
      // sus pines superen el radio de clustering de 80px), el "click de
      // nuevo mas cerca" que promete el comentario de arriba nunca
      // avanza -- una vez que el mapa ya esta en zoom 18, fitBounds con el
      // mismo maxZoom:18 de siempre vuelve a calcular ese mismo 18 (ya
      // satisfecho), asi que no pasa nada visible y el cluster queda
      // pegado ahi para siempre (reportado como "clickeo y no me muestra
      // nada", resuelto solo haciendo zoom a mano). Por eso el piso es 18
      // (mismo comportamiento de siempre en el primer click, sin
      // regresion para el caso de Punta Carrasco) pero si el mapa YA esta
      // en 18 o mas, el tope sube con el -- le da a cada click siguiente
      // una "etapa" real de mas zoom en vez de repetir la misma cuenta,
      // hasta el maximo que ofrece el TileLayer (20).
      const maxZoom = Math.min(Math.max(18, map.getZoom() + 2), 20);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom });
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
// de un grupo de pines violeta. El verde fuerte (STRONG_MATCH_COLOR) se usa
// apenas UN solo evento del cluster matchea al 100% -- no hace falta que
// matcheen todos, basta con que haya al menos uno para que valga la pena
// abrir ese cluster. Si no hay ningun 100% pero SI hay al menos un match
// parcial (mezclado o no con eventos sin match), se usa el verde-amarillo
// de PARTIAL_MATCH_COLOR. Un cluster verde-amarillo entonces SIEMPRE tiene
// adentro al menos un evento con match parcial -- si TODOS sus eventos son
// 0% match, el cluster tiene que ser naranja (NO_MATCH_COLOR), no
// verde-amarillo: no hay nada parcial que justifique el verde ahi. Cuando
// no esta personalizado, colors ya viene todo en NEUTRAL_COLOR (violeta),
// asi que ninguna de las condiciones de match aplica.
function dominantClusterColor(colors) {
  if (colors.length === 0) return NEUTRAL_COLOR;
  if (colors.includes(STRONG_MATCH_COLOR)) return STRONG_MATCH_COLOR;
  if (colors.includes(NEUTRAL_COLOR)) return NEUTRAL_COLOR;
  if (colors.includes(PARTIAL_MATCH_COLOR)) return PARTIAL_MATCH_COLOR;
  return NO_MATCH_COLOR;
}

// Icono de cluster generico -- separado de makeClusterIcon para poder
// pisar el icono de UN cluster puntual con un color especifico (ver
// clusterCarousel.colors mas abajo) sin pasar por dominantClusterColor.
// opacity: misma condicion que un pin individual (ver makeIcon) -- solo
// baja si TODOS los eventos agrupados son de precision "city"; un
// cluster mixto (aunque sea un solo evento con direccion real) se queda
// en opacidad completa, porque ese evento SI tiene una ubicacion
// confiable.
function buildClusterDivIcon(count, color, opacity = 1) {
  const size = count >= 20 ? 48 : count >= 10 ? 42 : 36;
  return L.divIcon({
    html: `<div class="flyer-cluster flyer-sans" style="width:${size}px;height:${size}px;font-size:${
      size >= 42 ? 15 : 13
    }px;background:${color};opacity:${opacity};">${count}</div>`,
    className: "",
    iconSize: [size, size],
  });
}

// Reemplaza el ícono default de leaflet.markercluster (que requiere su
// propio CSS, nunca importado -- ver DESIGN.md) por uno propio en el mismo
// lenguaje visual que .flyer-pin: mismo sistema de color que los pines
// individuales (ver dominantClusterColor), borde blanco, y el conteo de
// eventos agrupados.
// Mutable fuera de React a proposito -- el objeto cluster que llega en el
// evento de click puede quedar desprendido del mapa apenas
// leaflet.markercluster reconstruye su arbol interno (el cluster
// literalmente pierde su icono/posicion), asi que emparejar por
// identidad de ESE objeto puntual no es confiable. Emparejar por el id
// de los eventos (via flyerId, taggeado en cada marker igual que
// flyerColor) funciona sin importar que objeto cluster represente al
// grupo en el momento en que leaflet decide (re)pintarlo.
let activeClusterOverride = null;

function makeClusterIcon(cluster) {
  const children = cluster.getAllChildMarkers();
  const count = children.length;
  const opacity = children.every((m) => m.options.flyerPrecision === "city") ? 0.25 : 1;
  if (activeClusterOverride && children.some((m) => activeClusterOverride.eventIds.has(m.options.flyerId))) {
    return buildClusterDivIcon(count, activeClusterOverride.color, opacity);
  }
  const colors = children.map((m) => m.options.flyerColor || NEUTRAL_COLOR);
  const color = dominantClusterColor(colors);
  return buildClusterDivIcon(count, color, opacity);
}

// Dibujado, no emoji -- mismo criterio que RadarIcon/ChevronIcon. Relleno
// (currentColor) cuando el evento esta guardado, solo contorno si no.
// Exportado para reusarse tal cual en el acceso directo del Navbar.
export function HeartIcon({ filled, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 20.5s-7.5-4.6-9.8-9.1C.6 8.1 1.7 4.8 5 3.7c2.1-.7 4.3.1 5.5 2 .2.3.5.3.7 0 1.2-1.9 3.4-2.7 5.5-2 3.3 1.1 4.4 4.4 2.8 7.7-2.3 4.5-9.8 9.1-9.8 9.1z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
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

// "HH:MM" local del venue a partir del ISO que devuelve Open-Meteo
// (timezone=auto, sin offset) -- se parsea el string a mano, sin pasar por
// new Date() para la hora, porque eso lo reinterpretaria en el huso horario
// del NAVEGADOR, no el del evento. El dia (para el nombre del dia) si usa
// Date, pero solo con la parte de fecha (hora fija a medianoche) para que
// no corra de dia por huso horario.
function formatHourLabel(iso) {
  const [datePart, timePart] = iso.split("T");
  const hhmm = timePart ? timePart.slice(0, 5) : "";
  const weekday = new Date(`${datePart}T00:00:00`).toLocaleDateString("es-AR", { weekday: "short" });
  return `${weekday} ${hhmm}`;
}

// Codigo WMO (el mismo estandar que usa weather_utils.py en el backend,
// ver WMO_CONDITIONS ahi) -> emoji. Un dibujo, no la palabra -- a pedido
// explicito, mas legible de un vistazo que texto en una tarjeta chica.
// "condition" (texto) sigue viajando desde el backend solo para
// accesibilidad (aria-label/title), nunca se muestra como texto visible.
const WMO_EMOJI = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
  45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌦️", 56: "🌧️", 57: "🌧️",
  61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "🌨️", 77: "🌨️", 85: "🌨️", 86: "🌨️",
  80: "🌦️", 81: "🌧️", 82: "⛈️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

function weatherCodeToEmoji(code) {
  return WMO_EMOJI[code] ?? "🌡️";
}

// Clima de un evento guardado -- cada tarjeta de SavedEvents.jsx pide el
// suyo por separado (GET .../saved-events/{id}/weather), no como parte del
// listado general: así cada card resuelve a su propio ritmo en vez de que
// una sola llamada lenta frene a todas. Requiere sesion (el endpoint es
// /api/users/me/..., no hay variante de invitado) -- sin accessToken ni se
// intenta. `enabled` es isSavedListCard: en el carrusel del mapa/chat el
// hook se sigue llamando (regla de hooks), pero no hace ningun fetch.
function useEventWeather(eventId, accessToken, enabled) {
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!enabled || !accessToken) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    fetch(`${API_BASE}/api/users/me/saved-events/${eventId}/weather`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        if (data.available) setState({ status: "available", summary: data.summary, hourly: data.hourly });
        else setState({ status: "unavailable", reason: data.reason });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, accessToken, enabled]);

  return state;
}

// Cuadradito de clima -- vive junto al venue/fecha (ver EventCard), en el
// espacio que ahi quedaba vacio. Cerrado: rango de temperatura (min/max,
// separados por "/") + un emoji con la condicion MAS SEVERA de la ventana
// del evento (ya resuelta asi por el backend, ver
// weather_utils.get_event_weather) -- nunca un promedio, una tormenta
// puntual a las 3am importa mas que horas despejadas antes. Clickeable:
// el mismo cuadrado se expande (w-full fuerza el salto de linea dentro del
// flex-wrap del padre) mostrando el detalle hora por hora.
// Detalle hora por hora -- flota por ENCIMA de la tarjeta via portal
// (createPortal a document.body) en vez de empujar su contenido hacia
// abajo. Necesario porque .flyer-card usa clip-path para el corte de
// esquina (ver index.css): cualquier hijo posicionado que se saliera de la
// caja de la tarjeta quedaria recortado por ese mismo clip-path, como si
// fuera overflow:hidden -- un popover "normal" (absolute dentro de la
// tarjeta) se habria cortado apenas la tarjeta no tuviera mas alto que
// darle. Un portal esquiva eso por completo: ya no es descendiente de la
// tarjeta, asi que ningun clip-path ni overflow de ningun ancestro lo
// afecta. Posicion fixed, calculada desde el boton -- se cierra solo con
// scroll/resize en vez de re-calcularse, total es un solo click volver a
// abrirlo ya en su lugar correcto.
function WeatherHourlyPopover({ anchorRef, hourly, onClose, panelId }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = 224;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 6, left, width });
  }, [anchorRef]);

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    // capture:true -- los eventos de scroll no burbujean, pero SI se
    // escuchan en fase de captura desde un ancestro (como window), asi que
    // esto agarra igual el scroll del contenedor interno del modal de
    // "Eventos guardados" (overflow-y-auto), no solo el de la ventana.
    // PERO el propio popover tambien scrollea adentro (la lista hora por
    // hora, max-h-56 overflow-y-auto) -- sin el chequeo de abajo, scrollear
    // ESA lista disparaba este mismo handler y se cerraba solo, bug
    // reportado como "no me deja scrollear, me saca a la seccion de
    // eventos". Solo cierra si el scroll vino de AFUERA del popover.
    const handleScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      onClose();
    };
    // "focusin" (burbujea, a diferencia de "focus") -- cierra con Tab
    // tambien: nada adentro del popover es enfocable (son divs de solo
    // lectura), asi que Tab con el popover abierto mueve el foco al
    // siguiente control de la tarjeta (ej. "Comprar entrada") dejandolo
    // flotando sin relacion con el foco actual si no se cierra solo.
    const handleFocusIn = (e) => {
      if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    // target window, no document, y con capture -- durante la fase de
    // captura window se visita ANTES que document, asi que esto corre
    // antes que el listener de Escape de useModalA11y (que esta en
    // document) y, con stopPropagation, evita que ese otro handler tambien
    // reaccione: sin esto, Escape con el popover abierto cerraba de un
    // tiro el popover Y el modal entero de "Eventos guardados".
    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="region"
      aria-label="Detalle de clima por hora"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
      className="flyer-weather-hourly flyer-sans z-[2100] rounded-lg overflow-hidden max-h-56 overflow-y-auto"
    >
      {hourly.map((h, i) => (
        <div
          key={h.time}
          className={`flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] ${
            i > 0 ? "flyer-weather-hour-row" : ""
          }`}
        >
          <span className="flyer-card-ink-muted font-semibold flex-shrink-0">{formatHourLabel(h.time)}</span>
          <span className="flyer-card-ink font-semibold flex-shrink-0">{Math.round(h.temperature)}°C</span>
          <span className="text-base leading-none flex-shrink-0" title={h.condition} aria-hidden="true">
            {weatherCodeToEmoji(h.condition_code)}
          </span>
          <span className="sr-only">{h.condition}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

function EventWeatherSquare({ weather, expanded, onToggle, onClose }) {
  const buttonRef = useRef(null);
  const panelId = useId();

  if (weather.status === "loading") {
    return (
      <div
        className="flyer-weather-square flyer-weather-skeleton flex-shrink-0 rounded-lg animate-pulse"
        aria-hidden="true"
      />
    );
  }

  if (weather.status !== "available") return null;

  const { summary, hourly } = weather;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        aria-label={`Clima durante el evento: ${Math.round(summary.temp_min)} a ${Math.round(summary.temp_max)} grados, ${summary.condition}`}
        title={summary.condition}
        className="flyer-weather-square flyer-sans flex-shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors"
      >
        <span>{Math.round(summary.temp_min)}°/{Math.round(summary.temp_max)}°</span>
        <span className="text-base leading-none" aria-hidden="true">{weatherCodeToEmoji(summary.condition_code)}</span>
        <ChevronIcon
          direction="right"
          className={`w-2.5 h-2.5 opacity-50 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <WeatherHourlyPopover anchorRef={buttonRef} hourly={hourly} onClose={onClose} panelId={panelId} />
      )}
    </>
  );
}

// Contenido de la tarjeta de detalle (foto, generos, boton de compra) --
// usado tanto al explorar el mapa libremente como al navegar resultados
// del chat: un solo componente, sin ninguna version reducida para el
// carrusel. Ya no vive dentro de un popup de Leaflet: es un elemento
// propio, centrado en la pantalla con CSS simple (ver EventDetailOverlay).
// Exportado para reusarse tal cual en la lista de "Eventos guardados" del
// panel de usuario -- onRemove es opcional a proposito: solo esa lista lo
// pasa, así que en el mapa/chat (que nunca lo pasan) el boton ni existe.
// isSaved/onToggleSave manejan el corazon -- guardar nunca pide sesion
// (ver useSavedEvents.js: sin cuenta, guarda en localStorage), asi que
// onToggleSave solo llega undefined cuando no hay ni siquiera un evento
// resuelto todavia (ver EventDetailOverlay mas abajo), no por sesion.
export function EventCard({ ev, genreWeights, onRemove, isSaved, onToggleSave, accessToken }) {
  // Generos del evento que tambien estan entre las preferencias guardadas
  // del usuario -- se resaltan distinto (ver .flyer-chip-match). genres y
  // genre_ids vienen del backend como arrays paralelos (mismo indice).
  const preferredGenreIds = genreWeights ? new Set(Object.keys(genreWeights)) : null;

  // Si la imagen falla en cargar (URL rota, no solo ausente), se cae al
  // mismo placeholder que un evento sin flyer_url -- nunca un <img> oculto
  // a mano. Reseteado por ev.id: sin esto, al no tener key el <img> se
  // reutiliza entre eventos del carrusel, y un error de CARGA anterior
  // (display:none puesto por onError, fuera del control de React) quedaba
  // pegado para el siguiente evento aunque su foto cargara bien.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [ev.id]);

  const showPlaceholder = !ev.flyer_url || imgFailed;

  // onRemove solo lo pasa la lista de "Eventos guardados" (ver comentario
  // arriba) -- se reusa esa misma señal para elegir variante de color en
  // vez de sumar una prop nueva: tarjeta clara (.flyer-card, papel) ahi,
  // porque ese modal ya es oscuro y el papel es lo que contrastaba bien;
  // tarjeta oscura (.trial-card) en mapa/chat, porque ahi el fondo es el
  // mapa (tiles claros) y el papel se perdia contra el.
  const isSavedListCard = !!onRemove;

  // Se llama siempre (regla de hooks), pero sin isSavedListCard (mapa/chat)
  // no dispara ningun fetch -- ver useEventWeather.
  const weather = useEventWeather(ev.id, accessToken, isSavedListCard);
  const [weatherExpanded, setWeatherExpanded] = useState(false);

  return (
    // Sin h-full: en el carrusel del mapa/chat no hacia nada (el padre
    // inmediato, el div "relative" que envuelve la tarjeta, no tiene alto
    // explicito -- un 100% contra un alto "auto" no tiene efecto, asi que
    // la tarjeta ya se dimensionaba por su contenido). En la grilla de
    // "Eventos guardados" SI hacia algo, pero mal: esa grilla es un flex-
    // wrap cuyo padre (el modal) tiene alto fijo, asi que 100% resolvia
    // contra ESE alto entero en vez de limitarse a la fila -- la tarjeta
    // quedaba estirada a practicamente el alto completo del modal. El
    // align-items:stretch por defecto del flex-wrap ya iguala la altura
    // entre vecinas de la misma fila sin necesidad de esto.
    <div className={`w-64 ${isSavedListCard ? "flyer-card" : "trial-card"} p-3 flex flex-col`}>
      <div className="relative mb-2">
        {showPlaceholder ? (
          <div className="w-full h-28 flyer-card-image flyer-card-placeholder flex items-center justify-center">
            <FlyerPlaceholderIcon className="w-8 h-8" />
          </div>
        ) : (
          <img
            key={ev.id}
            src={ev.flyer_url}
            alt={ev.name}
            className="w-full h-28 object-cover flyer-card-image"
            onError={() => setImgFailed(true)}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSave?.();
          }}
          disabled={!onToggleSave}
          title={isSaved ? "Sacar de guardados" : "Guardar evento"}
          aria-label={isSaved ? "Sacar de guardados" : "Guardar evento"}
          className={`trial-heart-btn absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            isSaved ? "is-saved" : ""
          }`}
        >
          <HeartIcon filled={!!isSaved} className="w-4 h-4" />
        </button>
      </div>
      {/* min-h + line-clamp reservan siempre el espacio de 2 lineas --
          nombres de 1 sola linea no dejan la tarjeta mas corta que una de
          2, que es lo que desalineaba los botones de abajo entre tarjetas
          vecinas en la grilla de "Eventos guardados". */}
      <p className="flyer-sans flyer-card-ink font-bold uppercase tracking-wide text-base leading-snug line-clamp-2 min-h-[2.75rem]">
        {ev.name}
      </p>

      {/* El cuadradito de clima (EventWeatherSquare) cuelga del espacio
          vacio a la derecha de venue/fecha. Su detalle hora por hora NO
          vive aca adentro -- es un popover flotante (portal a body, ver
          WeatherHourlyPopover) para no estirar esta tarjeta ni desalinear
          las vecinas de la misma fila al abrirse. */}
      <div className="flex items-start justify-between gap-2 mt-1">
        <div className="min-w-0">
          <p className="flyer-sans flyer-card-ink-muted font-bold text-sm">{ev.venue_name}</p>
          <p className="flyer-sans flyer-card-ink-muted font-bold text-xs mt-1 capitalize">
            {new Date(ev.date_from).toLocaleDateString("es-AR", {
              weekday: "long", day: "2-digit", month: "2-digit",
            })}
          </p>
        </div>

        {isSavedListCard && (
          <EventWeatherSquare
            weather={weather}
            expanded={weatherExpanded}
            onToggle={() => setWeatherExpanded((v) => !v)}
            onClose={() => setWeatherExpanded(false)}
          />
        )}
      </div>

      {ev.genres && ev.genres.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ev.genres.slice(0, 3).map((g, i) => {
            const gid = ev.genre_ids?.[i];
            const isMatch = preferredGenreIds && gid && preferredGenreIds.has(gid);
            return (
              <span
                key={g}
                className={`flyer-sans text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                  isSavedListCard
                    ? isMatch ? "flyer-chip-match" : "flyer-chip"
                    : isMatch ? "trial-chip-match" : "trial-chip"
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

      {/* "Fuera de rango": el cuadradito de arriba no se muestra (no hay
          nada que expandir), solo este aviso discreto. "sin_ubicacion" no
          muestra nada en ningun lado -- ver useEventWeather. */}
      {isSavedListCard && weather.status === "unavailable" && weather.reason === "fuera_de_rango" && (
        <p className="flyer-sans flyer-card-ink-muted text-[11px] italic mt-2">
          Pronóstico disponible más cerca de la fecha
        </p>
      )}

      {/* mt-auto empuja este bloque al fondo de la tarjeta -- junto con
          h-full en el contenedor de arriba, hace que "Comprar entrada" y
          "Sacar de guardados" queden a la misma altura entre tarjetas
          vecinas sin importar cuanto contenido tenga cada una arriba
          (genero, aviso de ubicacion, etc.), no solo el nombre. */}
      <div className="mt-auto pt-3">
        {ev.ticket_url && (
          <a
            href={ev.ticket_url}
            target="_blank"
            rel="noreferrer"
            className="flyer-cta flyer-sans block text-center uppercase tracking-wide font-bold text-sm py-2.5 transition-colors"
          >
            Comprar entrada
          </a>
        )}

        {onRemove && (
          <button
            onClick={onRemove}
            className="flyer-card-btn-danger flyer-sans mt-2 w-full text-center uppercase tracking-wide font-semibold text-xs py-2 rounded-lg transition-colors"
          >
            Sacar de guardados
          </button>
        )}
      </div>
    </div>
  );
}

// Flechas del carrusel -- dibujadas, no el caracter tipografico ‹ › que
// usaban antes: ese glifo no queda centrado dentro de un boton circular
// (su caja de texto tiene ascenso/descenso asimetrico segun la fuente),
// un SVG con geometria simetrica si.
function ChevronIcon({ direction = "left", className }) {
  const d = direction === "left" ? "M15 6L9 12L15 18" : "M9 6L15 12L9 18";
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// isChatMode controla el "mueble" del carrusel (flechas + badge X/N), que
// se usa tanto para el carrusel del chat como para el mini-carrusel de un
// cluster -- ambos navegan una lista de eventos igual. dismissOnOutsideClick
// es una decision aparte:
//
// - Explorando el mapa libremente, o con un mini-carrusel de cluster
//   abierto: clickear afuera cierra. Perder la tarjeta no cuesta nada --
//   un cluster se puede volver a clickear, y explorar libre no tenia
//   nada que perder.
//
// - Navegando resultados del chat (sin cluster encima): clickear afuera
//   NO cierra -- perder el carrusel entero obligaria a volver al chat y
//   pedir los eventos de nuevo. Solo las flechas, la X, o cambiar de
//   filtro lo cierran.
// Transform base de la fila (tarjeta + flechas): centrada en el pin/cluster
// (que flyTo ya dejo en el centro exacto del contenedor, ver mas abajo) y
// anclada desde su propio borde inferior hacia arriba, 28px de respiro
// sobre el pin. Vive en JS (no en la clase CSS .flyer-detail-offset que
// tenia antes) porque el clamp de viewport de abajo necesita compoenerse
// con ESTE mismo transform en una sola propiedad -- un transform inline
// pisaria por completo al de una clase CSS separada.
const DETAIL_BASE_TRANSFORM = "translate(-50%, calc(-100% - 28px))";

function EventDetailOverlay({
  ev, isChatMode, dismissOnOutsideClick, activeIndex, total, onNext, onPrev, onClose, genreWeights,
  isSaved, onToggleSave,
}) {
  // El mapa siempre lleva el pin/cluster clickeado al CENTRO del contenedor
  // (ver flyTo en MapController) y esta fila se ancla hacia arriba desde
  // ahi -- una altura de tarjeta razonable en desktop (donde el area de
  // mapa mide varios cientos de px) entra siempre en la mitad superior sin
  // problema. En mobile el area visible del mapa es mucho mas baja (navbar
  // + FilterBar le sacan una porcion fija mucho mayor, proporcionalmente,
  // que en desktop), asi que esa mitad superior puede terminar siendo mas
  // baja que la tarjeta misma -- sin este clamp, el contenedor padre
  // (overflow-hidden, ver App.jsx) recorta el borde superior entero,
  // incluido el boton de cerrar (×), dejandolo inalcanzable. Mismo
  // problema en el eje horizontal si el pin cae cerca del borde izquierdo
  // o derecho con el carrusel (flechas) abierto. Se mide DESPUES de cada
  // render (sin array de dependencias) restando el offset ya aplicado en
  // ESE render para encontrar la posicion "natural" (sin clamp) y corregir
  // desde ahi -- converge solo, sin loop, porque una vez que el offset
  // corregido coincide con el medido no se vuelve a llamar setState.
  const wrapperRef = useRef(null);
  const [clampOffset, setClampOffset] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!ev || !wrapper) return;
    const container = wrapper.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const rect = wrapper.getBoundingClientRect();
    const naturalLeft = rect.left - clampOffset.x;
    const naturalTop = rect.top - clampOffset.y;
    const naturalRight = rect.right - clampOffset.x;
    const naturalBottom = rect.bottom - clampOffset.y;
    const margin = 12;
    let dx = 0;
    let dy = 0;
    if (naturalLeft < containerRect.left + margin) dx = containerRect.left + margin - naturalLeft;
    else if (naturalRight > containerRect.right - margin) dx = containerRect.right - margin - naturalRight;
    if (naturalTop < containerRect.top + margin) dy = containerRect.top + margin - naturalTop;
    else if (naturalBottom > containerRect.bottom - margin) dy = containerRect.bottom - margin - naturalBottom;
    if (dx !== clampOffset.x || dy !== clampOffset.y) setClampOffset({ x: dx, y: dy });
    // ev/activeIndex/total: remedir cuando cambia que se muestra (tamano
    // de tarjeta distinto). clampOffset.x/y: remedir despues de corregir,
    // para confirmar que la correccion alcanzo -- la segunda vez ya no
    // vuelve a llamar setState (ver comentario de arriba) y ahi queda.
  }, [ev, activeIndex, total, clampOffset.x, clampOffset.y]);

  if (!ev) return null;

  return (
    <div
      className={`absolute inset-0 z-[1500] ${
        dismissOnOutsideClick ? "" : "pointer-events-none"
      }`}
      onClick={dismissOnOutsideClick ? onClose : undefined}
    >
      <div
        ref={wrapperRef}
        className="absolute top-1/2 left-1/2 pointer-events-auto"
        style={{ transform: `${DETAIL_BASE_TRANSFORM} translate(${clampOffset.x}px, ${clampOffset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <button
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
            className="absolute -top-2.5 -right-2.5 z-10 w-7 h-7 flex items-center justify-center rounded-full flyer-icon-btn text-sm transition-colors"
          >
            ×
          </button>
          {isChatMode && (
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 flyer-badge flyer-sans rounded-full text-[10px] font-medium px-2 py-0.5">
              {activeIndex + 1} / {total}
            </span>
          )}
          <EventCard ev={ev} genreWeights={genreWeights} isSaved={isSaved} onToggleSave={onToggleSave} />
          {/* Flechas ADENTRO del ancho de la tarjeta (no a los costados,
              como antes) -- a los costados, tarjeta + flechas + gaps
              sumaban ~352px, mas ancho que el viewport de la mayoria de
              los celulares (~360-400px con margen incluido): en el mas
              angosto de los presets estandar (iPhone SE, 375px) ya
              quedaban literalmente cortadas a la mitad en cada borde, y
              el clamp de arriba no puede arreglar eso -- corrige la
              posicion de UN bloque rigido, no achica su ancho. Puestas
              adentro, el ancho total nunca supera el de la tarjeta sola
              (256px), que entra holgado en cualquier telefono real. */}
          {isChatMode && (
            <>
              <button
                onClick={onPrev}
                disabled={activeIndex === 0}
                aria-label="Evento anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full flyer-icon-btn disabled:opacity-30 transition-colors"
              >
                <ChevronIcon direction="left" className="w-4 h-4" />
              </button>
              <button
                onClick={onNext}
                disabled={activeIndex === total - 1}
                aria-label="Evento siguiente"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full flyer-icon-btn disabled:opacity-30 transition-colors"
              >
                <ChevronIcon direction="right" className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Map({
  events, loading, error, filter, onFilterChange,
  mode, activeIndex, onNext, onPrev, userLocation, onLocateMe, locatingUser, genreWeights,
  onCloseCarousel, savedEventIds, onToggleSaved,
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

  // Filtros de genero y afinidad (ver MapFiltersPanel) -- catalogo pedido
  // una sola vez, misma fuente que GenreSurvey, nunca derivado de "events"
  // (ver comentario en GenreFilterMenu).
  const [genreCatalog, setGenreCatalog] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/api/users/genres/catalog`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setGenreCatalog)
      .catch(() => {});
  }, []);

  const [selectedGenreIds, setSelectedGenreIds] = useState(() => new Set());
  function toggleGenre(id) {
    setSelectedGenreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [highAffinityOnly, setHighAffinityOnly] = useState(false);

  // Buscador (ver MapSearchBar) -- normalizado UNA vez por tecla acá,
  // no adentro del .filter() de abajo, para no repetir el normalize()
  // del query en cada evento de la lista en cada render.
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = normalizeSearchText(searchQuery.trim());

  const baseDisplayedEvent = isChatMode ? activeEvent : selectedEvent;
  const displayedEvent = clusterCarousel
    ? clusterCarousel.events[clusterCarousel.index]
    : baseDisplayedEvent;
  const flyToEvent = displayedEvent;
  const overlayIsCarousel = clusterCarousel ? true : isChatMode;

  // Clickear afuera cierra en todos los casos MENOS el carrusel del chat
  // puro (sin un cluster encima) -- un mini-carrusel de cluster se puede
  // volver a abrir con otro click, perderlo no cuesta nada.
  const dismissOnOutsideClick = clusterCarousel ? true : !isChatMode;

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

  // isPersonalized: hay al menos una preferencia real guardada -- no
  // solo "esta logueado", para no pintar todo de naranja a alguien que
  // nunca completo la encuesta (ver mas abajo, affinityColor). Tambien
  // decide si el interruptor de afinidad tiene sentido: sin preferencias
  // guardadas no hay nada que separar en "alta/baja", asi que el
  // interruptor ni se renderiza (ver MapFiltersPanel) y se fuerza apagado
  // aca por si quedo prendido de una sesion anterior con preferencias.
  const isPersonalized = genreWeights && Object.keys(genreWeights).length > 0;
  useEffect(() => {
    if (!isPersonalized && highAffinityOnly) setHighAffinityOnly(false);
  }, [isPersonalized, highAffinityOnly]);

  // Afinidad calculada ACA, en cada render, a partir de los pesos mas
  // recientes -- no viene precalculada del backend. Esto es lo que
  // arregla que un resultado viejo del chat (guardado en memoria desde
  // antes de un cambio de preferencias) siempre se pinte con el color
  // correcto: no importa cuando se trajo el evento, la afinidad se
  // recalcula con los pesos de AHORA cada vez que se dibuja.
  //
  // Devuelve directamente un ratio 0..1 -- la proporcion de los PROPIOS
  // generos del evento que estan entre las preferencias guardadas. Un
  // evento con generos [Progressive House, Techno] donde el usuario solo
  // tiene guardado "Progressive House" matchea al 50%, sin importar
  // cuantas preferencias mas tenga guardadas o que tan bien matcheen
  // otros eventos visibles en el mapa (antes se comparaba contra el
  // mejor puntaje entre los eventos visibles, lo cual con una sola
  // preferencia activa volvia binario el resultado: cualquier evento que
  // matcheara aunque sea un genero quedaba pintado como 100% match).
  function affinityScoreFor(ev) {
    if (!isPersonalized || !ev.genre_ids || ev.genre_ids.length === 0) return 0;
    const matchCount = ev.genre_ids.filter((gid) => genreWeights[gid] !== undefined).length;
    return matchCount / ev.genre_ids.length;
  }

  // Filtros de genero/afinidad/busqueda -- puramente de presentacion,
  // nunca tocan "events" (App.jsx sigue calculando eventos
  // guardados/isBroadView sobre la lista completa que devolvio
  // /api/events/map). Combinados con Y logico: cada evento visible tiene
  // que pasar los tres a la vez, ninguno reemplaza a otro. El corte de
  // "alta afinidad" es el mismo ratio > 0 que ya separa el color de
  // coincidencia (verde fuerte/verde-amarillo) del de no-coincidencia
  // (naranja) en affinityColor -- no un umbral nuevo.
  // No se aplican en modo chat: activeIndex ahi indexa directo sobre
  // "events" tal como los devolvio el chat, y podar esa lista rompería esa
  // correspondencia (ver MapFiltersPanel).
  const filteredEvents = events.filter((ev) => {
    if (selectedGenreIds.size > 0) {
      const matchesGenre = ev.genre_ids?.some((gid) => selectedGenreIds.has(gid));
      if (!matchesGenre) return false;
    }
    if (highAffinityOnly && affinityScoreFor(ev) <= 0) return false;
    if (!eventMatchesSearch(ev, normalizedSearchQuery)) return false;
    return true;
  });
  const visibleEvents = isChatMode ? events : filteredEvents;

  // Ids ya vistos en el mapa -- se actualiza DESPUES de cada render donde
  // "visibleEvents" cambio, nunca durante. Esto es lo que permite
  // distinguir un pin genuinamente nuevo (recien llegado con un cambio de
  // filtro de fecha/genero/afinidad, o de resultados del chat) de un
  // re-render por otro motivo (seleccionar en el carrusel, o que lleguen
  // los pesos de afinidad mas tarde) -- ese segundo caso jamas debe
  // repetir la animacion de entrada.
  const prevEventIdsRef = useRef(new Set());
  useEffect(() => {
    prevEventIdsRef.current = new Set(visibleEvents.map((ev) => ev.id));
  }, [visibleEvents]);

  return (
    <div className="relative h-full w-full">
      <FilterBar active={filter} onChange={onFilterChange} />

      {!isChatMode && <MapSearchBar value={searchQuery} onChange={setSearchQuery} />}

      {!isChatMode && (
        <MapFiltersPanel
          genres={genreCatalog}
          selectedGenreIds={selectedGenreIds}
          onToggleGenre={toggleGenre}
          onClearGenres={() => setSelectedGenreIds(new Set())}
          showAffinitySwitch={isPersonalized}
          highAffinityOnly={highAffinityOnly}
          onToggleAffinity={() => setHighAffinityOnly((v) => !v)}
        />
      )}

      <button
        onClick={onLocateMe}
        disabled={locatingUser}
        title="Centrar en mi ubicación"
        aria-label="Centrar en mi ubicación"
        aria-busy={locatingUser}
        className="absolute bottom-6 right-4 z-[1000] w-10 h-10 rounded-full flex items-center justify-center flyer-icon-btn transition-colors disabled:opacity-70"
      >
        {locatingUser ? (
          <RadarIcon className="w-4 h-4 flyer-radar-spin" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 2V5M12 19V22M22 12H19M5 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {loading && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-[1000] flyer-pill flex items-center gap-2 px-3.5 py-1.5 rounded-full">
          <RadarIcon className="w-3.5 h-3.5 flyer-radar-spin" style={{ color: "var(--flyer-violet)" }} />
          <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">
            Escaneando la ciudad…
          </span>
        </div>
      )}

      {!loading && visibleEvents.length === 0 && (
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

      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        zoomSnap={0.05}
        zoomDelta={0.05}
        className="h-full w-full"
      >
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
          events={visibleEvents}
          setClusterCarousel={setClusterCarousel}
          clusterCarousel={clusterCarousel}
          isPersonalized={isPersonalized}
          genreWeights={genreWeights}
        >
          {visibleEvents.map((ev, idx) => {
            const ratio = affinityScoreFor(ev);
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
                  if (marker) {
                    marker.options.flyerColor = pinColor;
                    // Varios eventos pueden compartir EXACTAMENTE las
                    // mismas coordenadas (fallback "centro de la ciudad",
                    // ver venue_precision) -- el id es lo unico que
                    // distingue de forma inequivoca a que evento
                    // pertenece cada marker (ver handleClusterClick).
                    marker.options.flyerId = ev.id;
                    // Misma logica de opacidad que un pin individual (ver
                    // makeIcon), guardada aca para que el cluster (ver
                    // makeClusterIcon) pueda decidir la suya sin recalcular
                    // nada por su cuenta.
                    marker.options.flyerPrecision = ev.venue_precision;
                  }
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
        dismissOnOutsideClick={dismissOnOutsideClick}
        activeIndex={clusterCarousel ? clusterCarousel.index : activeIndex}
        total={clusterCarousel ? clusterCarousel.events.length : events.length}
        onNext={handleOverlayNext}
        onPrev={handleOverlayPrev}
        onClose={handleOverlayClose}
        genreWeights={genreWeights}
        isSaved={!!(displayedEvent && savedEventIds.has(displayedEvent.id))}
        onToggleSave={displayedEvent ? () => onToggleSaved(displayedEvent.id, displayedEvent) : undefined}
      />
    </div>
  );
}