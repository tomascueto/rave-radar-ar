import { useEffect, useState } from "react";
import Map, { getDateRange } from "./Map";
import ChatPanel from "./ChatPanel";
import Navbar from "./Navbar";
import GenreSurvey from "./GenreSurvey";
import AuthModal from "./AuthModal";
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

function LandingPage({ onEnter }) {
  return (
    <div className="fixed inset-0 z-[3000] bg-white flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold text-slate-900">Bienvenido a Rave Radar AR</h1>
      <button
        onClick={onEnter}
        className="bg-violet-600 hover:bg-violet-700 text-white text-lg font-medium px-8 py-3 rounded-full transition-colors"
      >
        Encontrá tu fiesta
      </button>
    </div>
  );
}

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasEntered, setHasEntered] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("todos");

  const [mode, setMode] = useState("browse");
  const [activeIndex, setActiveIndex] = useState(0);

  const [accessToken, setAccessToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showSurvey, setShowSurvey] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [userLocation, setUserLocation] = useState(null);

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
    if (tokenFromUrl) {
      setAccessToken(tokenFromUrl);
      window.history.replaceState({}, "", "/");
      return;
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

  function handleAuthSuccess(token) {
    setAccessToken(token);
    setShowAuthModal(false);
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
    return <LandingPage onEnter={() => setHasEntered(true)} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen">
      <Navbar
        currentUser={currentUser}
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenPreferences={() => setShowSurvey(true)}
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
          isPersonalized={!!currentUser}
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
            fetchMapEvents();
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onLoginSuccess={handleAuthSuccess} />
      )}
    </div>
  );
}

export default App;