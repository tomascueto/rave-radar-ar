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

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("todos");

  const [mode, setMode] = useState("browse");
  const [activeIndex, setActiveIndex] = useState(0);

  const [accessToken, setAccessToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showSurvey, setShowSurvey] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

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

  useEffect(() => {
    setMode("browse");
    setLoading(true);
    fetch(buildMapApiUrl(filter))
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
  }, [filter]);

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

  // Pagina dedicada para el link de recuperacion de contrasena que llega
  // por mail -- se chequea despues de declarar todos los hooks (para no
  // violar las Reglas de los Hooks), asi que algunos fetches de arriba
  // corren de mas en esta ruta puntual. Aceptable: es una pagina de
  // acceso raro, sin impacto real.
  if (window.location.pathname === "/reset-password") {
    return <ResetPasswordPage />;
  }

  return (
    <div className="flex flex-col h-screen w-screen">
      <Navbar
        currentUser={currentUser}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={handleLogout}
      />
      <div className="flex flex-1 overflow-hidden">
        <ChatPanel onEventsUpdate={handleChatEvents} accessToken={accessToken} />
        <div className="flex-1 relative">
          <Map
            events={events}
            loading={loading}
            error={error}
            filter={filter}
            onFilterChange={setFilter}
            mode={mode}
            activeIndex={activeIndex}
            onNext={handleNext}
            onPrev={handlePrev}
          />
        </div>
      </div>

      {showSurvey && (
        <GenreSurvey accessToken={accessToken} onDone={() => setShowSurvey(false)} />
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onLoginSuccess={handleAuthSuccess} />
      )}
    </div>
  );
}

export default App;