import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalA11y } from "./useModalA11y";

const API_BASE = "http://localhost:8000";

function ChevronDownIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Reemplaza el <select> nativo -- en mobile (iOS Safari sobre todo, Android
// Chrome en menor medida) el picker de ciudad se dibuja con el sheet/menu
// del propio sistema operativo, que ignora casi todo el CSS que le pongamos
// a <option> (background-color incluido, aunque SI funcione en desktop):
// queda una lista blanca del SO flotando sobre el modal oscuro de la app,
// sin ningun control de estilo posible desde aca -- no es un bug de
// nuestro CSS, es un techo real de la plataforma. Portal a document.body
// (no un dropdown position:absolute adentro del modal) porque
// PreferredCitySection vive dentro del area con overflow-y-auto de
// ProfileSection -- un panel ahi quedaria recortado por ese mismo overflow
// en cuanto el trigger no estuviera pegado arriba del todo (mismo
// problema, mismo motivo, que ya aparecio con EventDetailOverlay en el
// mapa: ver Map.jsx).
function CitySelect({ id, cities, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [panelStyle, setPanelStyle] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  // "Sin preferencia" fija arriba, fuera del orden -- mismo criterio que
  // tenia el <select> nativo que reemplaza. Memoizado: sin esto, un array
  // nuevo en cada render reinstalaba los listeners del efecto de abajo en
  // cada tecla de flecha (options esta en sus deps).
  const options = useMemo(
    () => [
      { id: "", name: "Sin preferencia" },
      ...[...cities].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    ],
    [cities]
  );
  const selectedIndex = Math.max(
    0,
    options.findIndex((c) => (c.id || null) === (value || null))
  );
  const selected = options[selectedIndex];

  function computePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const preferredMaxHeight = 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Se abre para arriba solo si abajo genuinamente no entra Y arriba hay
    // mas lugar -- evita que un trigger a mitad de pantalla abra para
    // arriba sin necesidad solo porque "spaceAbove > spaceBelow" por poco.
    const openUpward = spaceBelow < preferredMaxHeight && spaceAbove > spaceBelow;
    setPanelStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(120, Math.min(preferredMaxHeight, spaceAbove - 8)) }
        : { top: rect.bottom + 4, maxHeight: Math.max(120, Math.min(preferredMaxHeight, spaceBelow - 8)) }),
    });
  }

  useEffect(() => {
    if (!open) return;
    computePosition();

    function handleReposition() {
      computePosition();
    }
    function handleClickOutside(e) {
      if (triggerRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const opt = options[highlighted];
        onChange(opt.id || null);
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    document.addEventListener("mousedown", handleClickOutside);
    // window, no document, y captura -- el modal que envuelve este campo
    // (useModalA11y) tiene su PROPIO listener de Escape en document con
    // captura, montado antes que este (el modal ya esta abierto cuando el
    // usuario recien abre el desplegable). Dos listeners en el MISMO nodo
    // y fase disparan en orden de registro, asi que el del modal ganaba
    // siempre pase lo que pase aca adentro -- Escape cerraba el modal
    // ENTERO en vez de solo el desplegable. En captura el evento baja
    // window -> document -> ... -> el resto, asi que uno en window
    // dispara antes que cualquiera en document sin importar cuando se
    // registro cada uno -- el stopPropagation de aca abajo si alcanza a
    // frenarlo.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
    // highlighted, options, selectedIndex y onChange deliberadamente en
    // las deps -- Enter/Espacio del listener de keydown necesita leer su
    // valor mas reciente en cada uno, y reinstalar el listener en cada
    // cambio es mas simple y mas barato que un ref paralelo por cada uno
    // solo para esto.
  }, [open, highlighted, options, selectedIndex, onChange]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={open ? `city-option-${highlighted}` : undefined}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) setHighlighted(selectedIndex);
        }}
        className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-60 flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">{selected.name}</span>
        <ChevronDownIcon className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Ciudad preferida"
            className="flyer-select-panel flyer-sans rounded-lg overflow-y-auto py-1 z-[3000] fixed"
            style={panelStyle}
          >
            {options.map((c, i) => (
              <li key={c.id || "none"}>
                <button
                  id={`city-option-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === selectedIndex}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => {
                    onChange(c.id || null);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={`flyer-select-option w-full text-left px-3 py-2.5 text-sm transition-colors ${
                    i === highlighted ? "flyer-select-option-active" : ""
                  } ${i === selectedIndex ? "font-semibold" : ""}`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}

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
      <label htmlFor="preferred-city-trigger" className="flyer-sans flyer-text-faint text-xs uppercase tracking-wide block mb-1.5">
        Ciudad preferida
      </label>
      <CitySelect
        id="preferred-city-trigger"
        cities={cities}
        value={cityId}
        onChange={onChange}
        disabled={disabled || loadingCities}
      />
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
  const { dialogRef, dialogProps, backdropProps } = useModalA11y({
    onClose,
    titleId: "user-panel-title",
  });

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      {...backdropProps}
    >
      <div
        ref={dialogRef}
        {...dialogProps}
        className="flyer-modal flyer-pop-enter rounded-2xl max-w-2xl w-full h-[600px] max-h-[85vh] flex flex-col"
      >
        <div className="p-5 flyer-modal-border border-b flex items-center justify-between flex-shrink-0">
          <h2 id="user-panel-title" className="flyer-sans font-bold text-lg" style={{ color: "var(--flyer-paper)" }}>
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
