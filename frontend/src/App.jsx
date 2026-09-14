import { useEffect, useState } from "react";
import Map, { getDateRange } from "./Map";
import ChatPanel from "./ChatPanel";
import Navbar from "./Navbar";

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

  function handleLogin() {
    window.location.href = `${API_BASE}/api/auth/google/login`;
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

  return (
    <div className="flex flex-col h-screen w-screen">
      <Navbar currentUser={currentUser} onLogin={handleLogin} onLogout={handleLogout} />
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
    </div>
  );
}

export default App;