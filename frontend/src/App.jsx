import { useEffect, useState } from "react";
import Map, { getDateRange } from "./Map";
import ChatPanel from "./ChatPanel";

function buildMapApiUrl(filterKey) {
  const { from, to } = getDateRange(filterKey);
  const params = new URLSearchParams();
  if (from) params.set("date_from", from.toISOString());
  if (to) params.set("date_to", to.toISOString());
  const query = params.toString();
  return `http://localhost:8000/api/events/map${query ? `?${query}` : ""}`;
}

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("todos");

  // "browse": el filtro de fecha manda, se ven todos los pines igual.
  // "chat": el chat mando la ultima tanda de eventos, se navega de a uno
  // con el carrusel (flechas + mapa centrado en el activo).
  const [mode, setMode] = useState("browse");
  const [activeIndex, setActiveIndex] = useState(0);

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
    <div className="flex h-screen w-screen">
      <ChatPanel onEventsUpdate={handleChatEvents} />
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
  );
}

export default App;