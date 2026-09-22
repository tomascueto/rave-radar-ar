import { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Map, { getDateRange, TILE_URL, TILE_ATTRIBUTION } from "./Map";
import ChatPanel from "./ChatPanel";
import Navbar from "./Navbar";
import GenreSurvey from "./GenreSurvey";
import AuthModal from "./AuthModal";
import UserPanel from "./UserPanel";
import ResetPasswordPage from "./ResetPasswordPage";

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

function LandingPage({ onEnter }) {
  return (
    <div className="fixed inset-0 z-[3000] flyer-landing overflow-hidden flex items-center justify-center">
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
    </div>
  );
}

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasEntered, setHasEntered] = useState(
    () => localStorage.getItem("hasEntered") === "true"
  );
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("todos");

  const [mode, setMode] = useState("browse");
  const [activeIndex, setActiveIndex] = useState(0);

  const [accessToken, setAccessToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showSurvey, setShowSurvey] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [userPanelInitialTab, setUserPanelInitialTab] = useState("perfil");
  const [googleLinkError, setGoogleLinkError] = useState(null);
  const [googleLinkSuccess, setGoogleLinkSuccess] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [genreWeights, setGenreWeights] = useState({});
  // null = sin sesion (el corazon de guardar ni se habilita) -- distinto
  // de un Set vacio, que es "logueado pero sin nada guardado todavia".
  const [savedEventIds, setSavedEventIds] = useState(null);


  function handleEnter() {
    localStorage.setItem("hasEntered", "true");
    setHasEntered(true);
  }

  function requestUserLocation() {
    // Silencioso ante rechazo, timeout, o falta de soporte -- la
    // geolocalización es una mejora, nunca un requisito: sin ella, el
    // mapa simplemente usa el centro por defecto y el chat sigue
    // funcionando igual, solo sin poder resolver pedidos tipo "cerca
    // mío". Se llama tanto al arrancar la app como desde el botón de
    // "centrar en mi ubicación".
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {},
      { timeout: 8000, maximumAge: 60000 }
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
      setHasEntered(true);
      setUserPanelInitialTab("cuentas");
      setShowUserPanel(true);
    }

    if (tokenFromUrl) {
      setAccessToken(tokenFromUrl);
      setHasEntered(true);
      window.history.replaceState({}, "", "/");
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

  useEffect(() => {
    if (!accessToken) {
      setSavedEventIds(null);
      return;
    }
    fetch(`${API_BASE}/api/users/me/saved-events/ids`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((ids) => setSavedEventIds(new Set(ids)))
      .catch(() => setSavedEventIds(new Set()));
  }, [accessToken]);

  // Unico lugar que sabe guardar/sacar un evento -- el corazon de
  // EventCard (mapa, chat, o la lista de guardados del panel) siempre
  // llama a esto mismo, asi el Set queda consistente sin importar desde
  // donde se disparo el click ni hace falta refrescar nada del server.
  // Optimista: cambia el Set al toque, sin esperar la respuesta.
  function toggleSavedEvent(eventId) {
    if (!accessToken) return;
    const wasSaved = savedEventIds?.has(eventId);
    setSavedEventIds((prev) => {
      const next = new Set(prev || []);
      if (wasSaved) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
    fetch(`${API_BASE}/api/users/me/saved-events/${eventId}`, {
      method: wasSaved ? "DELETE" : "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }

  function handleAuthSuccess(token) {
    setAccessToken(token);
    setShowAuthModal(false);
  }

  // Actualiza currentUser directo en memoria (sin esperar un F5 ni
  // volver a pegarle a /api/auth/me) -- lo que se guarde en el panel
  // (por ahora, el nombre) se ve reflejado en el Navbar al toque.
  function handleUserUpdate(patch) {
    setCurrentUser((u) => (u ? { ...u, ...patch } : u));
  }

  function handleLogout() {
    fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).finally(() => {
      setAccessToken(null);
      setCurrentUser(null);
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
    <div className="flex flex-col h-screen w-screen">
      <Navbar
        currentUser={currentUser}
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenPreferences={() => setShowSurvey(true)}
        onOpenUserPanel={() => {
          setUserPanelInitialTab("perfil");
          setShowUserPanel(true);
        }}
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
          genreWeights={genreWeights}
          onCloseCarousel={fetchMapEvents}
          savedEventIds={savedEventIds}
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
          genreWeights={genreWeights}
          initialTab={userPanelInitialTab}
          linkError={googleLinkError}
          linkSuccess={googleLinkSuccess}
          savedEventIds={savedEventIds}
          onToggleSaved={toggleSavedEvent}
          onUserUpdate={handleUserUpdate}
          onClose={() => {
            setShowUserPanel(false);
            setGoogleLinkError(null);
            setGoogleLinkSuccess(false);
          }}
        />
      )}
    </div>
  );
}

export default App;