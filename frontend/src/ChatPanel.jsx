import { useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:8000";

export default function ChatPanel({ onEventsUpdate, accessToken, userLocation }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "¡Hola! Preguntame por eventos de música electrónica — por género, DJ, venue, fecha o lo que se te ocurra.",
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

  return (
    <div className="w-96 h-full flex flex-col bg-white border-r border-slate-200">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                msg.role === "user"
                  ? "bg-violet-600 text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-800 rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
            {msg.role === "assistant" && msg.events && msg.events.length > 0 && (
              <button
                onClick={() => onEventsUpdate(msg.events)}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-600 text-xs font-medium rounded-full transition-colors"
              >
                <span>📍</span>
                Ver {msg.events.length} evento{msg.events.length !== 1 ? "s" : ""} en el mapa
              </button>
            )}
          </div>
        ))}
        {sending && (
          <div className="bg-slate-100 text-slate-400 text-sm px-3 py-2 rounded-2xl rounded-bl-sm max-w-[85%]">
            Pensando...
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ej: techno este finde en Palermo"
          disabled={sending}
          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-full focus:outline-none focus:border-violet-500 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-4 py-2 bg-violet-600 text-white text-sm rounded-full disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}