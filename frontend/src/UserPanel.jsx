import { useEffect, useState } from "react";
import { EventCard } from "./Map";

const API_BASE = "http://localhost:8000";

const TABS = [
  { key: "perfil", label: "Perfil" },
  { key: "seguridad", label: "Seguridad" },
  { key: "cuentas", label: "Cuentas conectadas" },
  { key: "guardados", label: "Eventos guardados" },
];

function ProfileSection({ accessToken, currentUser, onUserUpdate }) {
  const [name, setName] = useState(currentUser.display_name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("El nombre no puede estar vacío");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/me/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ display_name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "No se pudo actualizar el nombre");
        return;
      }
      // Actualiza el estado de App inmediatamente -- el Navbar (y
      // cualquier otro lugar que use currentUser) refleja el nombre
      // nuevo sin esperar a un F5.
      onUserUpdate({ display_name: data.display_name });
      setSuccess("Nombre actualizado");
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-1 -m-1 space-y-4">
        {error && (
          <div className="flyer-sans flyer-banner-error text-sm rounded-lg px-3 py-2">{error}</div>
        )}
        {success && (
          <div className="flyer-sans flyer-banner-success text-sm rounded-lg px-3 py-2">{success}</div>
        )}

        <div>
          <label className="flyer-sans flyer-text-faint text-xs uppercase tracking-wide block mb-1.5">
            Nombre
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
          />
        </div>

        <div>
          <label className="flyer-sans flyer-text-faint text-xs uppercase tracking-wide block mb-1.5">
            Email
          </label>
          <p className="flyer-sans flyer-text-muted text-sm">{currentUser.email}</p>
        </div>
      </div>

      <div className="pt-4 mt-2 flyer-modal-border border-t flex-shrink-0 flex justify-end">
        <button
          type="submit"
          disabled={saving || !name.trim() || name.trim() === currentUser.display_name}
          className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 transition-colors"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

function SecuritySection({ accessToken }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError("La contraseña nueva debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas nuevas no coinciden");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          // Si no cargó nada, se manda undefined (JSON.stringify lo
          // omite del body) -- el backend decide solo si hacía falta:
          // cuentas solo-Google todavía sin contraseña no la exigen.
          current_password: currentPassword || undefined,
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "No se pudo cambiar la contraseña");
        return;
      }
      setSuccess(data.message || "Contraseña actualizada");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-1 -m-1 space-y-3">
        <p className="flyer-sans flyer-text-muted text-sm">
          Si tu cuenta todavía no tiene contraseña propia (entraste solo con Google), dejá
          "contraseña actual" vacío -- vas a estar creando una por primera vez.
        </p>

        {error && (
          <div className="flyer-sans flyer-banner-error text-sm rounded-lg px-3 py-2">{error}</div>
        )}
        {success && (
          <div className="flyer-sans flyer-banner-success text-sm rounded-lg px-3 py-2">{success}</div>
        )}

        <input
          type="password"
          placeholder="Contraseña actual (opcional)"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
        />
        <input
          type="password"
          placeholder="Contraseña nueva (mínimo 8 caracteres)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
          className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
        />
        <input
          type="password"
          placeholder="Repetí la contraseña nueva"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
        />
      </div>

      <div className="pt-4 mt-2 flyer-modal-border border-t flex-shrink-0 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 transition-colors"
        >
          {saving ? "Guardando..." : "Cambiar contraseña"}
        </button>
      </div>
    </form>
  );
}

function ConnectedAccountsSection({ currentUser, linkError, linkSuccess }) {
  const googleLinked = !!currentUser.google_linked;

  function handleLinkGoogle() {
    window.location.href = `${API_BASE}/api/auth/google/login?link=true`;
  }

  return (
    <div className="h-full overflow-y-auto p-1 -m-1 space-y-4">
      {linkError && (
        <div className="flyer-sans flyer-banner-error text-sm rounded-lg px-3 py-2">
          No se pudo vincular tu cuenta de Google: {linkError}
        </div>
      )}
      {linkSuccess && (
        <div className="flyer-sans flyer-banner-success text-sm rounded-lg px-3 py-2">
          Tu cuenta de Google quedó vinculada correctamente.
        </div>
      )}

      <div className="flex items-center justify-between gap-3 p-3 rounded-lg flyer-modal-border border">
        <div>
          <p className="flyer-sans font-semibold text-sm" style={{ color: "var(--flyer-paper)" }}>
            Google
          </p>
          <p className="flyer-sans flyer-text-faint text-xs mt-0.5">
            {googleLinked ? "Conectada" : "No conectada"}
          </p>
        </div>
        <button
          onClick={handleLinkGoogle}
          className="flyer-ghost-btn flyer-sans text-xs font-semibold uppercase tracking-wide rounded-full px-4 py-2 transition-colors"
        >
          {googleLinked ? "Reconectar con Google" : "Vincular con Google"}
        </button>
      </div>
    </div>
  );
}

function SavedEventsSection({ accessToken, genreWeights, savedEventIds, onToggleSaved }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function fetchSaved() {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/users/me/saved-events`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`API respondió ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch(() => {
        setError("No se pudieron cargar los eventos guardados");
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <p className="flyer-sans flyer-text-faint text-sm">Cargando eventos guardados...</p>;
  }
  if (error) {
    return <p className="flyer-sans flyer-banner-error text-sm rounded-lg px-3 py-2 inline-block">{error}</p>;
  }

  // Filtrado por el Set global (savedEventIds), no por el array local de
  // "events" -- ese Set es el que ya actualiza el corazon al instante
  // (desde esta lista o desde el mapa/chat), asi que sacar un evento de
  // guardados lo saca de aca sin pedirle nada de nuevo al server.
  const visibleEvents = events.filter((ev) => savedEventIds?.has(ev.id));

  if (visibleEvents.length === 0) {
    return (
      <p className="flyer-sans flyer-text-faint text-sm">
        Todavía no guardaste ningún evento. Los vas a poder guardar desde su tarjeta en el mapa.
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-1 -m-1 flex flex-wrap content-start gap-4">
      {visibleEvents.map((ev) => (
        <EventCard
          key={ev.id}
          ev={ev}
          genreWeights={genreWeights}
          isSaved={true}
          onToggleSave={() => onToggleSaved(ev.id)}
          onRemove={() => onToggleSaved(ev.id)}
        />
      ))}
    </div>
  );
}

export default function UserPanel({
  accessToken, currentUser, genreWeights, initialTab, linkError, linkSuccess,
  savedEventIds, onToggleSaved, onClose, onUserUpdate,
}) {
  const [activeTab, setActiveTab] = useState(initialTab || "perfil");

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="flyer-modal flyer-pop-enter rounded-2xl max-w-2xl w-full h-[600px] max-h-[85vh] flex flex-col">
        <div className="p-5 flyer-modal-border border-b flex items-center justify-between flex-shrink-0">
          <h2 className="flyer-sans font-bold text-lg" style={{ color: "var(--flyer-paper)" }}>
            Tu cuenta
          </h2>
          <button
            onClick={onClose}
            className="flyer-text-muted hover:opacity-100 text-xl leading-none transition-opacity"
            style={{ color: "var(--flyer-paper)", opacity: 0.55 }}
          >
            ×
          </button>
        </div>

        <div className="px-5 pt-3 flyer-modal-border border-b flex flex-wrap gap-2 flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flyer-sans px-3 py-1.5 mb-3 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors ${
                activeTab === tab.key ? "flyer-toggle-chip-active" : "flyer-toggle-chip"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 flex-1 min-h-0">
          {activeTab === "perfil" && (
            <ProfileSection accessToken={accessToken} currentUser={currentUser} onUserUpdate={onUserUpdate} />
          )}
          {activeTab === "seguridad" && <SecuritySection accessToken={accessToken} />}
          {activeTab === "cuentas" && (
            <ConnectedAccountsSection currentUser={currentUser} linkError={linkError} linkSuccess={linkSuccess} />
          )}
          {activeTab === "guardados" && (
            <SavedEventsSection
              accessToken={accessToken}
              genreWeights={genreWeights}
              savedEventIds={savedEventIds}
              onToggleSaved={onToggleSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
