import { useEffect, useState } from "react";

const API_BASE = "http://localhost:8000";

export default function GenreSurvey({ accessToken, onDone }) {
  const [genres, setGenres] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/users/genres/catalog`)
      .then((res) => res.json())
      .then((data) => {
        setGenres(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Precarga las preferencias ya guardadas -- para un usuario nuevo
    // (encuesta inicial) esto simplemente devuelve una lista vacía, sin
    // efecto distinto al comportamiento anterior. Para alguien que abre
    // esto para EDITAR, deja lo ya elegido marcado en vez de arrancar
    // en blanco.
    if (!accessToken) return;
    fetch(`${API_BASE}/api/users/me/genres`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((ids) => setSelected(new Set(ids)))
      .catch(() => {});
  }, [accessToken]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/users/me/genres`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ genre_ids: Array.from(selected) }),
      });
      onDone();
    } catch (err) {
      console.error("Error guardando preferencias:", err);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="flyer-modal flyer-pop-enter rounded-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="p-5 flyer-modal-border border-b">
          <h2 className="flyer-sans font-bold text-lg" style={{ color: "var(--flyer-paper)" }}>
            ¿Qué onda te gusta?
          </h2>
          <p className="flyer-sans flyer-text-muted text-sm mt-1">
            Elegí los géneros que más te copen — los vamos a usar para recomendarte mejor.
          </p>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <p className="flyer-sans flyer-text-faint text-sm">Cargando géneros...</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {genres.map((g) => (
                <button
                  key={g.id}
                  onClick={() => toggle(g.id)}
                  className={`flyer-sans px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                    selected.has(g.id) ? "flyer-toggle-chip-active" : "flyer-toggle-chip"
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 flyer-modal-border border-t flex items-center justify-between">
          <span className="flyer-sans flyer-text-faint text-xs">{selected.size} seleccionados</span>
          <div className="flex gap-2">
            <button
              onClick={onDone}
              className="flyer-sans flyer-text-muted hover:opacity-100 text-sm px-3 py-2 transition-opacity"
            >
              Cerrar
            </button>
            <button
              onClick={handleSave}
              disabled={selected.size === 0 || saving}
              className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}