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
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flyer-pill rounded-full flex items-center gap-3 px-4 py-2"
    >
      <input
        type="range"
        min={3}
        max={18}
        step={0.05}
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
function buildClusterDivIcon(count, color) {
  const size = count >= 20 ? 48 : count >= 10 ? 42 : 36;
  return L.divIcon({
    html: `<div class="flyer-cluster flyer-sans" style="width:${size}px;height:${size}px;font-size:${
      size >= 42 ? 15 : 13
    }px;background:${color};">${count}</div>`,
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
  if (activeClusterOverride && children.some((m) => activeClusterOverride.eventIds.has(m.options.flyerId))) {
    return buildClusterDivIcon(count, activeClusterOverride.color);
  }
  const colors = children.map((m) => m.options.flyerColor || NEUTRAL_COLOR);
  const color = dominantClusterColor(colors);
  return buildClusterDivIcon(count, color);
}

// Dibujado, no emoji -- mismo criterio que RadarIcon/ChevronIcon. Relleno
// (currentColor) cuando el evento esta guardado, solo contorno si no.
function HeartIcon({ filled, className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
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

// Contenido de la tarjeta de detalle (foto, generos, boton de compra) --
// usado tanto al explorar el mapa libremente como al navegar resultados
// del chat: un solo componente, sin ninguna version reducida para el
// carrusel. Ya no vive dentro de un popup de Leaflet: es un elemento
// propio, centrado en la pantalla con CSS simple (ver EventDetailOverlay).
// Exportado para reusarse tal cual en la lista de "Eventos guardados" del
// panel de usuario -- onRemove es opcional a proposito: solo esa lista lo
// pasa, así que en el mapa/chat (que nunca lo pasan) el boton ni existe.
// isSaved/onToggleSave manejan el corazon: onToggleSave llega undefined
// cuando no hay sesion iniciada (el corazon se muestra pero deshabilitado,
// con tooltip), nunca por eleccion de quien renderiza la tarjeta.
export function EventCard({ ev, genreWeights, onRemove, isSaved, onToggleSave }) {
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

  return (
    <div className="w-64 h-full flyer-card p-3 flex flex-col">
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
          title={
            !onToggleSave
              ? "Iniciá sesión para guardar eventos"
              : isSaved
              ? "Sacar de guardados"
              : "Guardar evento"
          }
          className={`flyer-heart-btn absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
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
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
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
function EventDetailOverlay({
  ev, isChatMode, dismissOnOutsideClick, activeIndex, total, onNext, onPrev, onClose, genreWeights,
  isSaved, onToggleSave,
}) {
  if (!ev) return null;

  return (
    <div
      className={`absolute inset-0 z-[1500] flex items-center justify-center ${
        dismissOnOutsideClick ? "" : "pointer-events-none"
      }`}
      onClick={dismissOnOutsideClick ? onClose : undefined}
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
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full flyer-icon-btn disabled:opacity-30 transition-colors"
          >
            <ChevronIcon direction="left" className="w-4 h-4" />
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
          <EventCard ev={ev} genreWeights={genreWeights} isSaved={isSaved} onToggleSave={onToggleSave} />
        </div>

        {isChatMode && (
          <button
            onClick={onNext}
            disabled={activeIndex === total - 1}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full flyer-icon-btn disabled:opacity-30 transition-colors"
          >
            <ChevronIcon direction="right" className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function Map({
  events, loading, error, filter, onFilterChange,
  mode, activeIndex, onNext, onPrev, userLocation, onLocateMe, genreWeights,
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
          events={events}
          setClusterCarousel={setClusterCarousel}
          clusterCarousel={clusterCarousel}
          isPersonalized={isPersonalized}
          genreWeights={genreWeights}
        >
          {events.map((ev, idx) => {
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
        isSaved={!!(savedEventIds && displayedEvent && savedEventIds.has(displayedEvent.id))}
        onToggleSave={
          savedEventIds && displayedEvent ? () => onToggleSaved(displayedEvent.id) : undefined
        }
      />
    </div>
  );
}