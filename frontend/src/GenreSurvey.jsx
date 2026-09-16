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
    <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-semibold text-lg text-slate-800">¿Qué onda te gusta?</h2>
          <p className="text-sm text-slate-500 mt-1">
            Elegí los géneros que más te copen — los vamos a usar para recomendarte mejor.
          </p>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-slate-400">Cargando géneros...</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {genres.map((g) => (
                <button
                  key={g.id}
                  onClick={() => toggle(g.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selected.has(g.id)
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-400">{selected.size} seleccionados</span>
          <div className="flex gap-2">
            <button
              onClick={onDone}
              className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
            >
              Cerrar
            </button>
            <button
              onClick={handleSave}
              disabled={selected.size === 0 || saving}
              className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-full disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}