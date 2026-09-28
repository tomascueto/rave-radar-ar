import { useEffect, useState } from "react";

const API_BASE = "http://localhost:8000";

const TABS = [
  { key: "perfil", label: "Perfil" },
  { key: "seguridad", label: "Seguridad" },
  { key: "cuentas", label: "Cuentas conectadas" },
];

// Controlado por ProfileSection -- solo junta el catalogo de ciudades y
// dispara onChange con la seleccion local. Ya NO guarda solo: el pedido
// original (guardar al toque, sin pasar por "Guardar cambios") confundia
// mas de lo que resolvia -- el usuario cambiaba la ciudad, veia que
// "Guardar cambios" seguia apagado (porque ese boton solo miraba el
// nombre) y asumia que no habia guardado nada, aunque si. Ahora los dos
// campos comparten el mismo ciclo de guardado explicito.
function PreferredCitySection({ cityId, onChange, disabled }) {
  const [cities, setCities] = useState([]);
  const [loadingCities, setLoadingCities] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/users/cities/catalog`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setCities(data);
        setLoadingCities(false);
      })
      .catch(() => setLoadingCities(false));
  }, []);

  return (
    <div>
      <label className="flyer-sans flyer-text-faint text-xs uppercase tracking-wide block mb-1.5">
        Ciudad preferida
      </label>
      <select
        value={cityId || ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || loadingCities}
        className="flyer-sans flyer-field flyer-select w-full px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-60"
      >
        <option value="">Sin preferencia</option>
        {/* "Sin preferencia" queda fija arriba, fuera del orden -- el resto
            se ordena alfabeticamente sin distinguir mayusculas/acentos, no
            por como lo haya mandado el backend. */}
        {[...cities]
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))
          .map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
      </select>
      <p className="flyer-sans flyer-text-faint text-xs mt-1.5">
        Ordena primero los eventos de esa ciudad cuando pedís un género en el chat.
      </p>
    </div>
  );
}

function ProfileSection({ accessToken, currentUser, onUserUpdate }) {
  const [name, setName] = useState(currentUser.display_name || "");
  const [cityId, setCityId] = useState(currentUser.preferred_city_id || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const nameChanged = name.trim() !== (currentUser.display_name || "");
  const cityChanged = (cityId || null) !== (currentUser.preferred_city_id || null);

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
      const patch = {};

      if (nameChanged) {
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
        patch.display_name = data.display_name;
      }

      if (cityChanged) {
        const res = await fetch(`${API_BASE}/api/users/me/preferred-city`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ city_id: cityId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.detail || "No se pudo guardar la ciudad preferida");
          return;
        }
        patch.preferred_city_id = data.preferred_city_id;
      }

      // Actualiza el estado de App inmediatamente -- el Navbar (y
      // cualquier otro lugar que use currentUser) refleja los cambios
      // nuevos sin esperar a un F5.
      onUserUpdate(patch);
      setSuccess("Cambios guardados");
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

        <PreferredCitySection cityId={cityId} onChange={setCityId} disabled={saving} />
      </div>

      <div className="pt-4 mt-2 flyer-modal-border border-t flex-shrink-0 flex justify-end">
        <button
          type="submit"
          disabled={saving || !name.trim() || (!nameChanged && !cityChanged)}
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

export default function UserPanel({
  accessToken, currentUser, initialTab, linkError, linkSuccess, onClose, onUserUpdate,
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
            title="Cerrar"
            aria-label="Cerrar"
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
        </div>
      </div>
    </div>
  );
}
