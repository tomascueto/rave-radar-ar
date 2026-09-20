import { useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:8000";

// Íconos dibujados -- reemplazan los emoji (💬, 📍) que tenía esta pieza
// desde el arranque del proyecto, mismo criterio que el resto del sistema
// (RadarIcon en Map.jsx, el ícono de ubicación del botón "centrar").
function ChatIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H9l-4 3.5v-3.5H5.5C4.67 17 4 16.33 4 15.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function ChatPanel({ onEventsUpdate, accessToken, userLocation, isOpen, onToggle }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hola! Preguntame por eventos de música electrónica — por género, DJ, venue, fecha o lo que se te ocurra.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    const query = input.trim();
    if (!query || sending) return;

    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setSending(true);

    try {
      const headers = { "Content-Type": "application/json" };
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          ...(userLocation && { user_lat: userLocation.lat, user_lng: userLocation.lng }),
        }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.response_text, events: data.events },
      ]);
      onEventsUpdate(data.events);
    } catch (err) {
      console.error("Error en /api/chat:", err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Uy, no pude conectarme al servidor. Fijate que el backend esté corriendo." },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        title="Abrir chat"
        className="fixed bottom-6 left-4 z-[1500] w-14 h-14 rounded-full flex items-center justify-center flyer-chat-fab transition-colors"
      >
        <ChatIcon className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 left-4 z-[1500] w-96 h-[600px] max-h-[80vh] flex flex-col overflow-hidden rounded-2xl flyer-chat-panel flyer-pop-enter">
      <div className="flex items-center justify-between px-4 py-3 flyer-chat-header">
        <span className="flyer-sans font-bold text-sm" style={{ color: "var(--flyer-paper)" }}>
          Rave Radar AR
        </span>
        <button
          onClick={onToggle}
          title="Cerrar chat"
          className="flyer-text-muted hover:opacity-100 text-xl leading-none transition-opacity"
          style={{ color: "var(--flyer-paper)", opacity: 0.55 }}
        >
          ×
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 flyer-chat-scroll">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`flyer-sans max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                msg.role === "user"
                  ? "flyer-chat-bubble-user rounded-br-sm"
                  : "flyer-chat-bubble-assistant rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
            {msg.role === "assistant" && msg.events && msg.events.length > 0 && (
              <button
                onClick={() => onEventsUpdate(msg.events)}
                className="flyer-chat-action flyer-sans mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
              >
                <PinIcon className="w-3.5 h-3.5" />
                Ver {msg.events.length} evento{msg.events.length !== 1 ? "s" : ""} en el mapa
              </button>
            )}
          </div>
        ))}
        {sending && (
          <div className="flyer-chat-bubble-assistant flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-bl-sm max-w-[85%]">
            <span className="flyer-chat-typing-dot" />
            <span className="flyer-chat-typing-dot" />
            <span className="flyer-chat-typing-dot" />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 flex gap-2 flyer-chat-footer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ej: techno este finde en Palermo"
          disabled={sending}
          className="flyer-sans flyer-field flex-1 px-3 py-2 text-sm rounded-full transition-colors"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flyer-btn-solid flyer-sans px-4 py-2 text-sm font-semibold rounded-full transition-colors disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
