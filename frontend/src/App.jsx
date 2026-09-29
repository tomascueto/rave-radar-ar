import { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Map, { getDateRange, TILE_URL, TILE_ATTRIBUTION } from "./Map";
import ChatPanel from "./ChatPanel";
import Navbar from "./Navbar";
import GenreSurvey from "./GenreSurvey";
import AuthModal from "./AuthModal";
import UserPanel from "./UserPanel";
import SavedEvents from "./SavedEvents";
import ResetPasswordPage from "./ResetPasswordPage";
import LandingMore from "./LandingMore";
import { useSavedEvents } from "./useSavedEvents";

const API_BASE = "http://localhost:8000";

function buildMapApiUrl(filterKey) {
  const { from, to } = getDateRange(filterKey);
  const params = new URLSearchParams();
  if (from) params.set("date_from", from.toISOString());
  if (to) params.set("date_to", to.toISOString());
  const query = params.toString();
  return `${API_BASE}/api/events/map${query ? `?${query}` : ""}`;
}

// Centro propio (Palermo) para el mapa decorativo de la landing -- lejos del
// Río de la Plata, que como fill claro y uniforme sobrevivía al blur/duotono
// como una franja brillante encima de la trama de calles. Solo cambia el
// encuadre: el proveedor de tiles sigue siendo el mismo TILE_URL de Map.jsx.
const LANDING_MAP_CENTER = [-34.5951, -58.4436];

// Mismo lenguaje visual que .flyer-pin de Map.jsx (violeta de marca, borde
// blanco, sombra, entrada con flyer-pin-enter) -- el mapa de la landing es
// el mismo mapa real de la app, asi que el pin tiene que sentirse como el
// mismo objeto, no como un ícono decorativo aparte. Va como overlay CSS fijo
// en una esquina, no como Marker de Leaflet centrado en el mapa: el centro
// del mapa cae siempre detras del bloque de texto (centrado en pantalla),
// asi que un pin ahi quedaria tapado -- una esquina es la unica zona que el
// contenido centrado nunca ocupa, en mobile o desktop.
function LandingPin() {
  return (
    <div
      className="absolute top-8 right-6 sm:top-12 sm:right-12"
      aria-hidden="true"
    >
      <div
        className="flyer-pin flyer-pin-enter"
        style={{
          width: 34,
          height: 34,
          "--pin-final-opacity": 1,
          background: "var(--flyer-violet)",
          border: "3px solid white",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animationDelay: "520ms",
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" style={{ width: "48%", height: "48%" }}>
          <rect x="6" y="10" width="3" height="8" rx="1" fill="white" fillOpacity="0.85" />
          <rect x="10.5" y="5" width="3" height="13" rx="1" fill="white" fillOpacity="0.85" />
          <rect x="15" y="8" width="3" height="10" rx="1" fill="white" fillOpacity="0.85" />
        </svg>
      </div>
    </div>
  );
}

function LandingPage({ onEnter }) {
  return (
    <div className="flyer-landing">
      <div className="relative h-screen overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 flyer-map pointer-events-none">
          <MapContainer
            center={LANDING_MAP_CENTER}
            zoom={16}
            zoomControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
            className="h-full w-full flyer-map-layer"
          >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          </MapContainer>
        </div>

        <div className="absolute inset-0 flyer-duotone" aria-hidden="true" />
        <div className="absolute inset-0 flyer-diagonal-cut" aria-hidden="true" />
        <div className="absolute inset-0 flyer-scrim" aria-hidden="true" />
        <div className="absolute inset-0 flyer-content-scrim" aria-hidden="true" />
        <div className="absolute inset-0 flyer-halftone flyer-halftone-live" aria-hidden="true" />
        <div className="flyer-scanbar pointer-events-none" aria-hidden="true" />
        <div className="absolute inset-0 flyer-hero-fade pointer-events-none" aria-hidden="true" />

        <LandingPin />

        <div className="relative z-10 flex flex-col items-center gap-5 px-6 max-w-md text-center">
          <h1
            className="flyer-title uppercase leading-[0.92]"
            style={{ fontSize: "clamp(2.75rem, 9vw, 6rem)", textWrap: "balance" }}
          >
            <span style={{ color: "var(--flyer-pink)" }}>¡</span>
            Bienvenido a Rave Radar AR
            <span style={{ color: "var(--flyer-pink)" }}>!</span>
          </h1>

          <div className="flyer-rule w-24" />

          <p className="flyer-mono flyer-tagline uppercase tracking-[0.08em] text-sm">
            Mapa en vivo + recomendación por IA
          </p>

          <button
            onClick={onEnter}
            className="flyer-cta flyer-cta-bloom mt-2 flyer-mono uppercase tracking-[0.06em] font-bold text-base px-10 py-4 transition-colors"
          >
            Encontrá tu fiesta
            <span className="block flyer-mono normal-case tracking-normal text-[10px] font-normal opacity-90 mt-1">
              Esta noche · Argentina
            </span>
          </button>
        </div>

        <button
          onClick={() => {
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document.getElementById("landing-more")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
          }}
          aria-label="Ver más"
          className="flyer-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 z-10"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div id="landing-more">
        <LandingMore onEnter={onEnter} />
      </div>
    </div>
  );
}

// Umbral de "no mostrar la landing de nuevo" -- cuenta desde la ULTIMA
// actividad, no desde la primera entrada: "hasEnteredAt" se renueva al
// cargar la app (con sesion valida) y ante cualquier interaccion (ver
// touchActivity/useEffect de listeners mas abajo), asi que alguien que
// esta una hora usando la app y aprieta F5 no ve la landing. Es la
// pantalla de bienvenida, no un gate de acceso: tiene sentido que
// reaparezca para alguien inactivo hace rato.
const LANDING_IDLE_MINUTES = 30;

function hasValidEntry() {
  const storedAt = Number(localStorage.getItem("hasEnteredAt"));
  if (!storedAt) return false;
  const elapsedMs = Date.now() - storedAt;
  return elapsedMs < LANDING_IDLE_MINUTES * 60 * 1000;
}

// Unico lugar que escribe "hasEnteredAt" -- tanto el click de "Entrar"
// como el heartbeat de actividad (click/tecla/touch) y los distintos
// desenlaces de login pasan por aca, para que la marca siempre signifique
// lo mismo: "ultima vez que hubo actividad de un usuario ya adentro".
function touchActivity() {
  localStorage.setItem("hasEnteredAt", Date.now().toString());
}

// Overlay de transicion para login/logout -- antes el cambio de sesion
// era instantaneo (token puesto/sacado en el mismo tick), lo que se
// sentia como un salto brusco al mapa. Reusa el mismo lenguaje de puntos
// del indicador de "escribiendo" del chat (ver flyer-chat-typing-dot en
// ChatPanel), a mayor escala, en vez de un spinner nuevo.
function AuthTransitionOverlay({ mode }) {
  return (
    <div className="fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-4 flyer-auth-transition">
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="flyer-auth-transition-dot" />
        <span className="flyer-auth-transition-dot" />
        <span className="flyer-auth-transition-dot" />
      </div>
      <p
        role="status"
        className="flyer-sans uppercase tracking-[0.08em] text-sm font-semibold"
        style={{ color: "var(--flyer-paper)", opacity: 0.85 }}
      >
        {mode === "logout" ? "Cerrando sesión" : "Iniciando sesión"}
      </p>
    </div>
  );
}

// Duracion minima que se ve el overlay de arriba, para que los puntos
// alcancen a animarse aunque el pedido de red sea instantaneo (tipico en
// local) -- ver handleLogout/handleAuthSuccess.
const AUTH_TRANSITION_MS = 650;

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasEntered, setHasEntered] = useState(hasValidEntry);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("todos");
  const [authTransition, setAuthTransition] = useState(null); // null | "login" | "logout"

  const [mode, setMode] = useState("browse");
  const [activeIndex, setActiveIndex] = useState(0);

  const [accessToken, setAccessToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showSurvey, setShowSurvey] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showSavedEvents, setShowSavedEvents] = useState(false);
  const [userPanelInitialTab, setUserPanelInitialTab] = useState("perfil");
  const [googleLinkError, setGoogleLinkError] = useState(null);
  const [googleLinkSuccess, setGoogleLinkSuccess] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const [genreWeights, setGenreWeights] = useState({});
  // Unica fuente de verdad de "eventos guardados" -- funciona con o sin
  // sesion (ver useSavedEvents.js). isBroadView es la vista mas amplia
  // posible del mapa (sin filtro angosto, sin resultados de chat encima):
  // solo ahi es seguro podar del storage de invitado un ID que no aparece
  // en `events`, porque recien ahi la ausencia significa "ya no existe"
  // y no "esta vista no lo incluye".
  const isBroadView = mode === "browse" && filter === "todos";
  const {
    savedIds,
    toggle: toggleSavedEvent,
    savedEvents,
    loading: savedEventsLoading,
    isGuest,
  } = useSavedEvents({ accessToken, events, isBroadView, eventsLoading: loading });


  function handleEnter() {
    touchActivity();
    setHasEntered(true);
  }

  // Heartbeat de "seguis ahi": si ya entraste, cada carga de la app y cada
  // interaccion (click/tecla/touch, con throttle de 1 min para no pegarle a
  // localStorage en cada evento) renuevan la marca -- ver LANDING_IDLE_MINUTES.
  useEffect(() => {
    if (!hasEntered) return;
    touchActivity();

    let lastTouch = Date.now();
    function onActivity() {
      const now = Date.now();
      if (now - lastTouch < 60000) return;
      lastTouch = now;
      touchActivity();
    }
    window.addEventListener("click", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity);
    return () => {
      window.removeEventListener("click", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, [hasEntered]);

  function requestUserLocation() {
    // Silencioso ante rechazo, timeout, o falta de soporte -- la
    // geolocalización es una mejora, nunca un requisito: sin ella, el
    // mapa simplemente usa el centro por defecto y el chat sigue
    // funcionando igual, solo sin poder resolver pedidos tipo "cerca
    // mío". Se llama tanto al arrancar la app como desde el botón de
    // "centrar en mi ubicación".
    if (!navigator.geolocation) return;
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocatingUser(false);
      },
      () => setLocatingUser(false),
      {
        timeout: 8000,
        // 10 minutos (era 1) -- trade-off deliberado: el navegador puede
        // devolver una posicion cacheada de hasta esta antiguedad en vez
        // de pedirle una nueva al GPS/wifi, lo que responde MUCHO mas
        // rapido (a veces al toque). El costo: si el usuario realmente se
        // movio en esos 10 minutos, "centrar en mi ubicacion" lo deja en
        // donde estaba antes, no en donde esta ahora -- hasta que el cache
        // expire y se pida una posicion nueva de verdad. Aceptable aca: es
        // un mapa de eventos para orientarse, no navegacion turn-by-turn.
        maximumAge: 600000,
      }
    );
  }

  useEffect(() => {
    requestUserLocation();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("access_token");
    const linkError = params.get("google_link_error");
    const linkSuccess = params.get("google_linked");

    if (linkError) {
      // Vuelta de /api/auth/google/login?link=true con un error (ej.
      // esa cuenta de Google ya esta vinculada a otro usuario) -- el
      // backend redirige aca con el motivo en vez de mostrar un JSON
      // crudo. Se abre el panel directo en "Cuentas conectadas" para
      // que el usuario vea el aviso sin tener que ir a buscarlo.
      setGoogleLinkError(linkError);
      touchActivity();
      setHasEntered(true);
      setUserPanelInitialTab("cuentas");
      setShowUserPanel(true);
    }

    if (linkSuccess) {
      // Mismo mecanismo que el error, pero para el caso de exito (incluye
      // vincular una cuenta que ya estaba vinculada a si misma) -- sin
      // esto, el link terminaba en silencio: no habia forma de saber que
      // funciono salvo yendo a mirar el panel.
      setGoogleLinkSuccess(true);
      touchActivity();
      setHasEntered(true);
      setUserPanelInitialTab("cuentas");
      setShowUserPanel(true);
    }

    if (tokenFromUrl) {
      touchActivity();
      setHasEntered(true);
      window.history.replaceState({}, "", "/");
      setAuthTransition("login");
      setTimeout(() => {
        setAccessToken(tokenFromUrl);
        setAuthTransition(null);
      }, AUTH_TRANSITION_MS);
      return;
    }

    if (linkError || linkSuccess) {
      window.history.replaceState({}, "", "/");
    }

    fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.access_token) setAccessToken(data.access_token);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setCurrentUser(null);
      return;
    }
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !currentUser) return;
    fetch(`${API_BASE}/api/users/me/genres`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((genreIds) => {
        if (genreIds.length === 0) setShowSurvey(true);
      })
      .catch(() => {});
  }, [accessToken, currentUser]);

  function fetchGenreWeights() {
    if (!accessToken) {
      setGenreWeights({});
      return;
    }
    fetch(`${API_BASE}/api/users/me/genre-weights`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then(setGenreWeights)
      .catch(() => setGenreWeights({}));
  }

  useEffect(() => {
    fetchGenreWeights();
  }, [accessToken]);

  function handleAuthSuccess(token) {
    setAuthTransition("login");
    setTimeout(() => {
      setAccessToken(token);
      setShowAuthModal(false);
      setAuthTransition(null);
    }, AUTH_TRANSITION_MS);
  }

  // Actualiza currentUser directo en memoria (sin esperar un F5 ni
  // volver a pegarle a /api/auth/me) -- lo que se guarde en el panel
  // (por ahora, el nombre) se ve reflejado en el Navbar al toque.
  function handleUserUpdate(patch) {
    setCurrentUser((u) => (u ? { ...u, ...patch } : u));
  }

  function handleLogout() {
    setAuthTransition("logout");
    const minDelay = new Promise((resolve) => setTimeout(resolve, AUTH_TRANSITION_MS));
    const request = fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    Promise.all([request, minDelay]).then(() => {
      setAccessToken(null);
      setCurrentUser(null);
      setShowUserPanel(false);
      setAuthTransition(null);
    });
  }

  function fetchMapEvents() {
    setMode("browse");
    setLoading(true);
    const headers = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    fetch(buildMapApiUrl(filter), { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`API respondio ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchMapEvents();
  }, [filter, accessToken]);

  function handleChatEvents(newEvents) {
    setEvents(newEvents);
    setMode("chat");
    setActiveIndex(0);
  }

  function handleNext() {
    setActiveIndex((i) => Math.min(i + 1, events.length - 1));
  }

  function handlePrev() {
    setActiveIndex((i) => Math.max(i - 1, 0));
  }

  if (window.location.pathname === "/reset-password") {
    return <ResetPasswordPage />;
  }

  if (!hasEntered) {
    return <LandingPage onEnter={handleEnter} />;
  }

  return (
    <>
    <div className="flex flex-col h-screen w-screen" inert={!!authTransition}>
      <Navbar
        currentUser={currentUser}
        savedCount={savedIds.size}
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenPreferences={() => setShowSurvey(true)}
        onOpenUserPanel={() => {
          setUserPanelInitialTab("perfil");
          setShowUserPanel(true);
        }}
        onOpenSavedEvents={() => setShowSavedEvents(true)}
        onLogout={handleLogout}
      />
      <div className="flex-1 relative overflow-hidden">
        <Map
          events={events}
          loading={loading}
          error={error}
          filter={filter}
          onFilterChange={setFilter}
          userLocation={userLocation}
          onLocateMe={requestUserLocation}
          locatingUser={locatingUser}
          genreWeights={genreWeights}
          onCloseCarousel={fetchMapEvents}
          savedEventIds={savedIds}
          onToggleSaved={toggleSavedEvent}
          mode={mode}
          activeIndex={activeIndex}
          onNext={handleNext}
          onPrev={handlePrev}
        />
      </div>

      <ChatPanel
        onEventsUpdate={handleChatEvents}
        accessToken={accessToken}
        userLocation={userLocation}
        isOpen={isChatOpen}
        onToggle={() => setIsChatOpen((v) => !v)}
      />

      {showSurvey && (
        <GenreSurvey
          accessToken={accessToken}
          onDone={() => {
            setShowSurvey(false);
            fetchGenreWeights();
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onLoginSuccess={handleAuthSuccess} />
      )}

      {showUserPanel && currentUser && (
        <UserPanel
          accessToken={accessToken}
          currentUser={currentUser}
          initialTab={userPanelInitialTab}
          linkError={googleLinkError}
          linkSuccess={googleLinkSuccess}
          onUserUpdate={handleUserUpdate}
          onClose={() => {
            setShowUserPanel(false);
            setGoogleLinkError(null);
            setGoogleLinkSuccess(false);
          }}
        />
      )}

      {showSavedEvents && (
        <SavedEvents
          genreWeights={genreWeights}
          savedEvents={savedEvents}
          loading={savedEventsLoading}
          isGuest={isGuest}
          onToggleSaved={toggleSavedEvent}
          onOpenAuth={() => {
            setShowSavedEvents(false);
            setShowAuthModal(true);
          }}
          onClose={() => setShowSavedEvents(false)}
        />
      )}

    </div>
    {authTransition && <AuthTransitionOverlay mode={authTransition} />}
    </>
  );
}

export default App;