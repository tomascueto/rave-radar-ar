import { useCallback, useEffect, useRef, useState } from "react";
import { useModalA11y } from "./useModalA11y";
import AdminLocationPicker from "./AdminLocationPicker";

const API_BASE = "http://localhost:8000";
const PAGE_SIZE = 20;

// Wrapper fino sobre fetch para todas las llamadas a /api/admin/* --
// agrega el Bearer token y homogeiniza el manejo de error (el backend ya
// manda {"detail": "..."} en los 4xx/5xx, ver admin/router.py y
// get_current_admin_user) en un solo lugar en vez de repetirlo en cada
// llamada.
async function adminFetch(path, accessToken, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      // sin body JSON -- se queda con el "Error {status}" generico
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Etiqueta + color por precision de venue -- mismo criterio que
// affinityColor en Map.jsx (un solo lugar decide el color, reusado tanto
// en la barra como en la leyenda). "manual" es la que agrega este panel
// (ver PUT /api/admin/venues/{id}/coordinates); el resto ya existia en
// el scraper (ver scraper/geocode_venues.py).
const PRECISION_META = {
  exact: { label: "Exacta", color: "var(--flyer-violet)" },
  manual: { label: "Verificada a mano", color: "var(--flyer-pink)" },
  llm_search: { label: "Búsqueda por IA", color: "#f59e0b" },
  city: { label: "Centro de la ciudad", color: "rgba(245, 241, 230, 0.4)" },
  unknown: { label: "Desconocida", color: "#ef4444" },
};
const PRECISION_ORDER = ["exact", "manual", "llm_search", "city", "unknown"];

// Radar quieto -- mismo glifo que RadarIcon en Map.jsx (dibujado, no
// emoji), reproducido aca en vez de importado: Map.jsx no lo exporta (es
// una funcion interna de ese archivo) y esta pantalla de carga es
// puramente decorativa, no vale la pena tocar la superficie publica de
// Map.jsx solo por este glifo.
function RadarIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3" opacity="0.35" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path d="M12 12L12 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

function FullScreenState({ children }) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-3"
      style={{ background: "var(--flyer-ink)" }}
    >
      {children}
    </div>
  );
}

function StatCard({ label, value, sublabel }) {
  return (
    <div className="flyer-admin-card rounded-2xl p-4 flex flex-col gap-1 min-w-0">
      <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide leading-snug">{label}</span>
      <span className="flyer-title text-3xl" style={{ color: "var(--flyer-paper)" }}>
        {value}
      </span>
      {sublabel && <span className="flyer-sans flyer-text-faint text-xs">{sublabel}</span>}
    </div>
  );
}

// Distribucion de venue_precision sobre eventos activos (ver /api/admin/stats)
// -- barra apilada + leyenda, mismo patron visual de "una franja por
// categoria" que cualquier dashboard real, pero con los tokens de color
// de la app en vez de una paleta generica de plantilla.
function PrecisionBar({ distribution }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  const knownKeys = PRECISION_ORDER.filter((k) => distribution[k]);
  const extraKeys = Object.keys(distribution).filter((k) => !PRECISION_ORDER.includes(k) && distribution[k]);
  const keys = [...knownKeys, ...extraKeys];

  return (
    <div className="flyer-admin-card rounded-2xl p-4">
      <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">
        Precisión de ubicación (eventos activos)
      </span>
      {total === 0 ? (
        <p className="flyer-sans flyer-text-faint text-sm mt-3">Sin eventos activos todavía.</p>
      ) : (
        <>
          <div
            className="mt-3 flex h-2.5 rounded-full overflow-hidden"
            style={{ background: "rgba(255, 255, 255, 0.08)" }}
            role="img"
            aria-label={keys
              .map((k) => `${PRECISION_META[k]?.label || k}: ${distribution[k]} de ${total}`)
              .join(", ")}
          >
            {keys.map((k) => (
              <div
                key={k}
                style={{
                  width: `${(distribution[k] / total) * 100}%`,
                  background: PRECISION_META[k]?.color || "rgba(255,255,255,0.5)",
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {keys.map((k) => (
              <span
                key={k}
                className="flyer-sans text-xs flex items-center gap-1.5"
                style={{ color: "var(--flyer-paper)" }}
              >
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                  style={{ background: PRECISION_META[k]?.color || "rgba(255,255,255,0.5)" }}
                />
                {PRECISION_META[k]?.label || k}: {distribution[k]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Dashboard({ stats }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flyer-admin-card rounded-2xl p-4 h-24 flyer-admin-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Eventos activos" value={stats.eventos_activos} />
        <StatCard label="Eventos pasados" value={stats.eventos_pasados} />
        <StatCard label="Eventos totales" value={stats.eventos_totales} />
        <StatCard
          label="Cobertura de precio"
          value={`${stats.cobertura_precio.porcentaje}%`}
          sublabel={`${stats.cobertura_precio.con_precio} de ${stats.eventos_totales} eventos`}
        />
      </div>
      {stats.venue_precision && <PrecisionBar distribution={stats.venue_precision} />}
    </div>
  );
}

function EditIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.83l-1.17-1.17a2 2 0 0 0-2.83 0L4 15.5V20z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7h12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Dialogo de confirmacion generico -- usado tanto por el soft-delete de
// un evento como (mas adelante) por la advertencia de "esto mueve N
// eventos" antes de corregir un venue. Un solo componente en vez de un
// window.confirm() nativo: en un panel con identidad visual propia, el
// confirm() del navegador desentona (fuente/estilo del SO, no de la app)
// y en mobile Safari ni siquiera respeta saltos de linea.
function ConfirmDialog({ title, description, confirmLabel, danger, onConfirm, onCancel, busy, error }) {
  const { dialogRef, dialogProps, backdropProps } = useModalA11y({
    onClose: onCancel,
    titleId: "admin-confirm-title",
  });
  return (
    <div className="fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropProps}>
      <div
        ref={dialogRef}
        {...dialogProps}
        className="flyer-modal flyer-pop-enter rounded-2xl max-w-sm w-full p-5 flex flex-col gap-4"
      >
        <h2 id="admin-confirm-title" className="flyer-sans font-bold text-lg" style={{ color: "var(--flyer-paper)" }}>
          {title}
        </h2>
        <p className="flyer-sans flyer-text-muted text-sm leading-relaxed">{description}</p>
        {error && (
          <div className="flyer-banner-error rounded-xl px-3 py-2 flyer-sans text-xs" role="alert">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flyer-ghost-btn flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors ${
              danger ? "flyer-btn-danger" : "flyer-btn-solid"
            }`}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ isActive }) {
  return (
    <span
      className={`flyer-sans inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
        isActive ? "flyer-admin-badge-active" : "flyer-admin-badge-inactive"
      }`}
    >
      {isActive ? "Activo" : "Inactivo"}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(min, max, currency) {
  if (min == null && max == null) return "—";
  const fmt = (n) => new Intl.NumberFormat("es-AR").format(n);
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)} ${currency || ""}`;
  return `${fmt(min ?? max)} ${currency || ""}`;
}

function EventsTable({ accessToken, onEdit, refreshToken, onRequestDelete }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive"
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter === "active") params.set("is_active", "true");
    if (statusFilter === "inactive") params.set("is_active", "false");
    adminFetch(`/api/admin/events?${params}`, accessToken)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [accessToken, page, search, statusFilter]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Cualquier cambio de filtro vuelve a la pagina 1 -- quedarse en, por
  // ejemplo, la pagina 5 de "todos" al pasar a "inactivos" (que puede
  // tener muchas menos paginas) dejaria la tabla vacia sin que sea obvio
  // por que.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
        <div className="flex items-center gap-1.5">
          {[
            { key: "all", label: "Todos" },
            { key: "active", label: "Activos" },
            { key: "inactive", label: "Inactivos" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setStatusFilter(opt.key)}
              aria-pressed={statusFilter === opt.key}
              className={`flyer-sans px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === opt.key ? "flyer-toggle-chip-active" : "flyer-toggle-chip"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre…"
          aria-label="Buscar eventos por nombre"
          className="flyer-field flyer-sans rounded-full px-4 py-2 text-sm w-full sm:w-64"
        />
      </div>

      {error && (
        <div className="flyer-banner-error rounded-xl px-4 py-3 flyer-sans text-sm" role="alert">
          No se pudieron cargar los eventos: {error}
        </div>
      )}

      {!data && !error && (
        <div className="flyer-admin-card rounded-2xl p-4 h-64 flyer-admin-skeleton" />
      )}

      {data && data.items.length === 0 && (
        <div className="flyer-admin-card rounded-2xl p-6 text-center">
          <p className="flyer-sans flyer-text-muted text-sm">No hay eventos para este filtro.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="flyer-admin-card rounded-2xl overflow-hidden">
          <div className="flex flex-col divide-y" style={{ borderColor: "rgba(124, 58, 237, 0.2)" }}>
            {/* Header solo en sm+: en mobile cada fila se apila y ya lleva
                su propia etiqueta por campo (ver spans "sm:hidden" abajo),
                asi que un encabezado de columnas ahi no tendria con que
                alinear. */}
            <div
              className="hidden sm:grid gap-3 px-4 py-2 text-[11px] uppercase tracking-wide flyer-sans flyer-text-faint"
              style={{ gridTemplateColumns: "2.2fr 1.3fr 1fr 0.8fr 5.5rem" }}
            >
              <span>Evento</span>
              <span>Venue</span>
              <span>Precio</span>
              <span>Estado</span>
              <span className="text-right">Acciones</span>
            </div>
            {data.items.map((ev) => (
              <div
                key={ev.id}
                className="flyer-admin-table-row flex flex-col sm:grid gap-2 sm:gap-3 px-4 py-3 transition-colors"
                style={{ gridTemplateColumns: "2.2fr 1.3fr 1fr 0.8fr 5.5rem" }}
              >
                <div className="min-w-0">
                  <p className="flyer-sans font-semibold text-sm truncate" style={{ color: "var(--flyer-paper)" }}>
                    {ev.name}
                  </p>
                  <p className="flyer-sans flyer-text-faint text-xs">{formatDate(ev.date_from)}</p>
                </div>
                <div className="min-w-0 flex items-center gap-1.5">
                  <span className="sm:hidden flyer-text-faint text-xs">Venue:</span>
                  <span className="flyer-sans text-sm truncate" style={{ color: "var(--flyer-paper)" }}>
                    {ev.venue_name || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="sm:hidden flyer-text-faint text-xs">Precio:</span>
                  <span className="flyer-sans text-sm tabular-nums" style={{ color: "var(--flyer-paper)" }}>
                    {formatPrice(ev.min_price, ev.max_price, ev.currency)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="sm:hidden flyer-text-faint text-xs">Estado:</span>
                  <StatusBadge isActive={ev.is_active} />
                </div>
                <div className="flex items-center gap-1.5 sm:justify-end">
                  <button
                    onClick={() => onEdit(ev)}
                    aria-label={`Editar ${ev.name}`}
                    title="Editar"
                    className="flyer-icon-btn w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  >
                    <EditIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRequestDelete(ev)}
                    disabled={!ev.is_active}
                    aria-label={`Dar de baja ${ev.name}`}
                    title={ev.is_active ? "Dar de baja" : "Ya está inactivo"}
                    className="flyer-icon-btn w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="flyer-sans flyer-text-faint text-xs">
            {data.total} evento{data.total === 1 ? "" : "s"} · página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flyer-ghost-btn flyer-sans text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-30 transition-colors"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flyer-ghost-btn flyer-sans text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-30 transition-colors"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// El <input type="datetime-local"> no lleva timezone -- su valor se
// interpreta siempre en la hora LOCAL del navegador, tanto al leerlo (ver
// toLocalInputValue arriba, con getters locales, no UTC) como al armar un
// Date nuevo a partir de el aca. Eso es lo que hace que el viaje de ida y
// vuelta funcione sin importar en que zona horaria este el admin.
function fromLocalInputValue(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function ErrorBanner({ children }) {
  return (
    <div className="flyer-banner-error rounded-xl px-4 py-3 flyer-sans text-sm" role="alert">
      {children}
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flyer-sans flyer-text-muted hover:opacity-100 text-xs font-medium self-start transition-opacity"
    >
      ← Volver
    </button>
  );
}

// Parte 4a -- "el venue esta bien identificado, solo mal geocodificado".
// Muestra el impacto real (cuantos eventos activos comparten este venue)
// ANTES de dejar tocar nada, y solo despues de una confirmacion explicita
// aparece el mapa -- nunca guarda en cada click, solo cuando el admin
// aprieta "Guardar coordenadas" con una candidata ya elegida.
function FixVenueLocationFlow({ event, accessToken, onCancel, onDone }) {
  const [venueInfo, setVenueInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [confirmedImpact, setConfirmedImpact] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    adminFetch(`/api/admin/venues?search=${encodeURIComponent(event.venue_name || "")}`, accessToken)
      .then((list) => {
        setVenueInfo(list.find((v) => v.id === event.venue_id) || null);
      })
      .catch((err) => setLoadError(err.message));
  }, [event, accessToken]);

  async function handleSave() {
    if (!candidate) return;
    setSaving(true);
    setSaveError(null);
    try {
      await adminFetch(`/api/admin/venues/${event.venue_id}/coordinates`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ lat: candidate.lat, lng: candidate.lng }),
      });
      onDone();
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onCancel} />

      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}

      {!venueInfo && !loadError && <div className="flyer-admin-card rounded-xl h-20 flyer-admin-skeleton" />}

      {venueInfo && !confirmedImpact && (
        <div className="flyer-banner-info rounded-xl p-4 flex flex-col gap-3">
          <p className="flyer-sans text-sm leading-relaxed" style={{ color: "var(--flyer-paper)" }}>
            <strong>{venueInfo.name}</strong> tiene{" "}
            <strong>
              {venueInfo.event_count} evento{venueInfo.event_count === 1 ? "" : "s"} activo
              {venueInfo.event_count === 1 ? "" : "s"}
            </strong>
            . Mover las coordenadas de este venue va a mover TODOS esos eventos a la vez en el mapa público — son
            el mismo lugar físico, así que se corrigen juntos.
          </p>
          <button
            type="button"
            onClick={() => setConfirmedImpact(true)}
            className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-full self-start transition-colors"
          >
            Entiendo, corregir igual
          </button>
        </div>
      )}

      {venueInfo && confirmedImpact && (
        <>
          <p className="flyer-sans flyer-text-muted text-sm">
            Clickeá en el mapa para marcar la ubicación correcta de <strong>{venueInfo.name}</strong>.
          </p>
          <AdminLocationPicker
            initialPosition={venueInfo.lat != null ? { lat: venueInfo.lat, lng: venueInfo.lng } : null}
            onChange={setCandidate}
          />
          {saveError && <ErrorBanner>{saveError}</ErrorBanner>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flyer-ghost-btn flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!candidate || saving}
              className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
            >
              {saving ? "Guardando…" : "Guardar coordenadas"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Parte 4b -- "el venue actual esta bien, el evento ya no esta ahi".
// Buscador contra venues EXISTENTES (nunca toca coordenadas de nada); si
// no aparece el correcto, "crear venue nuevo" abre el mismo
// AdminLocationPicker que la Parte 4a, pero termina en un POST + una
// reasignacion, no en un PUT de coordenadas.
function ReassignVenueFlow({ event, accessToken, onCancel, onDone }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueCandidate, setNewVenueCandidate] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (creatingNew) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      adminFetch(`/api/admin/venues?search=${encodeURIComponent(query)}`, accessToken)
        .then(setResults)
        .catch((err) => setSearchError(err.message));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, accessToken, creatingNew]);

  async function assignVenue(venueId) {
    setAssigning(true);
    setAssignError(null);
    try {
      await adminFetch(`/api/admin/events/${event.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ venue_id: venueId }),
      });
      onDone();
    } catch (err) {
      setAssignError(err.message);
      setAssigning(false);
    }
  }

  async function handleCreateAndAssign() {
    if (!newVenueCandidate || !newVenueName.trim()) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const venue = await adminFetch(`/api/admin/venues`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          name: newVenueName.trim(),
          lat: newVenueCandidate.lat,
          lng: newVenueCandidate.lng,
        }),
      });
      await assignVenue(venue.id);
    } catch (err) {
      setAssignError(err.message);
      setAssigning(false);
    }
  }

  if (creatingNew) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onClick={() => setCreatingNew(false)} />
        <label className="flex flex-col gap-1.5">
          <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Nombre del venue nuevo</span>
          <input
            value={newVenueName}
            onChange={(e) => setNewVenueName(e.target.value)}
            placeholder="Nombre del lugar…"
            className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <p className="flyer-sans flyer-text-muted text-sm">Clickeá en el mapa para ubicarlo.</p>
        <AdminLocationPicker onChange={setNewVenueCandidate} />
        {assignError && <ErrorBanner>{assignError}</ErrorBanner>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={assigning}
            className="flyer-ghost-btn flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCreateAndAssign}
            disabled={!newVenueCandidate || !newVenueName.trim() || assigning}
            className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
          >
            {assigning ? "Creando…" : "Crear y reasignar"}
          </button>
        </div>
      </div>
    );
  }

  const filteredResults = results.filter((v) => v.id !== event.venue_id);

  return (
    <div className="flex flex-col gap-3">
      <BackButton onClick={onCancel} />
      <label className="flex flex-col gap-1.5">
        <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Buscar venue existente</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre del venue…"
          autoFocus
          className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
        />
      </label>

      {searchError && <ErrorBanner>{searchError}</ErrorBanner>}
      {assignError && <ErrorBanner>{assignError}</ErrorBanner>}

      <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
        {filteredResults.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => assignVenue(v.id)}
            disabled={assigning}
            className="flyer-toggle-chip flyer-sans rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2 text-left transition-colors disabled:opacity-40"
          >
            <span className="truncate" style={{ color: "var(--flyer-paper)" }}>
              {v.name}
            </span>
            <span className="flyer-text-faint text-xs flex-shrink-0">
              {v.event_count} evento{v.event_count === 1 ? "" : "s"} activo{v.event_count === 1 ? "" : "s"}
            </span>
          </button>
        ))}
        {filteredResults.length === 0 && (
          <p className="flyer-sans flyer-text-faint text-sm px-1 py-2">
            {query.trim() ? "Sin resultados para esa búsqueda." : "Escribí para buscar un venue."}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCreatingNew(true)}
        className="flyer-ghost-btn flyer-sans text-sm font-semibold px-4 py-2 rounded-full self-start transition-colors"
      >
        + Crear venue nuevo
      </button>
    </div>
  );
}

function EditEventModal({ event, accessToken, onClose, onSaved }) {
  const { dialogRef, dialogProps, backdropProps } = useModalA11y({
    onClose,
    titleId: "admin-edit-event-title",
  });
  // "fields" | "fix-venue" | "reassign-venue" -- las dos correcciones de
  // ubicacion (Parte 4) son pantallas propias adentro del MISMO modal, no
  // dialogos apilados: useModalA11y ya pone un focus-trap por dialogo, y
  // dos trampas de foco activas a la vez (una para este modal, otra para
  // un dialogo hijo) pelean entre si por el manejo de Tab/Escape.
  const [view, setView] = useState("fields");
  const [form, setForm] = useState(() => ({
    name: event.name,
    date_from: toLocalInputValue(event.date_from),
    date_to: toLocalInputValue(event.date_to),
    min_price: event.min_price ?? "",
    max_price: event.max_price ?? "",
    ticket_url: event.ticket_url || "",
    flyer_url: event.flyer_url || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/events/${event.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name,
          date_from: fromLocalInputValue(form.date_from),
          date_to: fromLocalInputValue(form.date_to),
          min_price: form.min_price === "" ? null : Number(form.min_price),
          max_price: form.max_price === "" ? null : Number(form.max_price),
          ticket_url: form.ticket_url || null,
          flyer_url: form.flyer_url || null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropProps}>
      <div
        ref={dialogRef}
        {...dialogProps}
        className="flyer-modal flyer-pop-enter rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col"
      >
        <div className="p-5 flyer-modal-border border-b flex items-center justify-between gap-2">
          <h2 id="admin-edit-event-title" className="flyer-sans font-bold text-lg truncate" style={{ color: "var(--flyer-paper)" }}>
            {view === "fields" && "Editar evento"}
            {view === "fix-venue" && "Corregir la ubicación de este venue"}
            {view === "reassign-venue" && "Este evento cambió de lugar"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            className="flyer-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
          >
            ×
          </button>
        </div>

        {view === "fix-venue" && (
          <div className="p-5 overflow-y-auto flex-1">
            <FixVenueLocationFlow
              event={event}
              accessToken={accessToken}
              onCancel={() => setView("fields")}
              onDone={onSaved}
            />
          </div>
        )}

        {view === "reassign-venue" && (
          <div className="p-5 overflow-y-auto flex-1">
            <ReassignVenueFlow
              event={event}
              accessToken={accessToken}
              onCancel={() => setView("fields")}
              onDone={onSaved}
            />
          </div>
        )}

        {view === "fields" && (
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          {error && (
            <div className="flyer-banner-error rounded-xl px-4 py-3 flyer-sans text-sm" role="alert">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Nombre</span>
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
              className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Desde</span>
              <input
                type="datetime-local"
                value={form.date_from}
                onChange={(e) => update("date_from", e.target.value)}
                required
                className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Hasta (opcional)</span>
              <input
                type="datetime-local"
                value={form.date_to}
                onChange={(e) => update("date_to", e.target.value)}
                className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Precio mínimo</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.min_price}
                onChange={(e) => update("min_price", e.target.value)}
                placeholder="Sin dato…"
                className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Precio máximo</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.max_price}
                onChange={(e) => update("max_price", e.target.value)}
                placeholder="Sin dato…"
                className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Link de entradas</span>
            <input
              type="url"
              value={form.ticket_url}
              onChange={(e) => update("ticket_url", e.target.value)}
              placeholder="https://…"
              className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">Flyer (URL de imagen)</span>
            <input
              type="url"
              value={form.flyer_url}
              onChange={(e) => update("flyer_url", e.target.value)}
              placeholder="https://…"
              className="flyer-field flyer-sans rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <div className="flyer-admin-card rounded-xl p-3 flex flex-col gap-3">
            <div className="min-w-0">
              <span className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide block">Ubicación</span>
              <span className="flyer-sans text-sm truncate block" style={{ color: "var(--flyer-paper)" }}>
                {event.venue_name || "Sin venue"}
              </span>
            </div>
            {/* Dos acciones separadas, nunca un unico boton ambiguo -- a
                pedido explicito: son dos diagnosticos distintos ("el
                venue esta mal geocodificado" vs "el evento se mudo de
                venue") con efectos muy distintos (mover TODOS los
                eventos de un venue vs. mover solo este uno), y mezclarlos
                en un flujo confundiria cual es cual. */}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setView("fix-venue")}
                className="flyer-ghost-btn flyer-sans text-xs font-semibold px-3 py-2 rounded-full transition-colors flex-1"
              >
                Corregir la ubicación de este venue
              </button>
              <button
                type="button"
                onClick={() => setView("reassign-venue")}
                className="flyer-ghost-btn flyer-sans text-xs font-semibold px-3 py-2 rounded-full transition-colors flex-1"
              >
                Este evento cambió de lugar
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flyer-ghost-btn flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flyer-btn-solid flyer-sans text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-40 transition-colors"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

// Gate de acceso -- courtesy de UX, no la proteccion real (esa ya la
// tiene el backend via get_current_admin_user en cada endpoint de
// admin/router.py). Misma sesion de siempre: no arranca ningun fetch de
// auth propio, solo espera a que App.jsx termine de resolver la que ya
// esta en curso (ver authResolved) antes de decidir si mostrar el panel
// o mandar de vuelta al mapa.
export default function AdminPage({ accessToken, currentUser, authResolved }) {
  const isAdmin = !!currentUser?.is_admin;

  useEffect(() => {
    if (authResolved && !isAdmin) {
      window.location.href = "/";
    }
  }, [authResolved, isAdmin]);

  if (!authResolved) {
    return (
      <FullScreenState>
        <RadarIcon className="w-8 h-8 flyer-radar-spin" style={{ color: "var(--flyer-violet)" }} />
        <p className="flyer-sans flyer-text-muted text-sm">Verificando sesión…</p>
      </FullScreenState>
    );
  }

  if (!isAdmin) {
    // A punto de redirigir (ver efecto de arriba) -- no pinta el panel
    // ni un instante para un usuario sin permisos.
    return <FullScreenState />;
  }

  return <AdminShell accessToken={accessToken} />;
}

function AdminShell({ accessToken }) {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // Se incrementa despues de CUALQUIER mutacion (editar, borrar, y mas
  // adelante corregir/reasignar venue) -- tanto Dashboard como
  // EventsTable lo escuchan para refrescarse, porque una edicion puede
  // cambiar los dos a la vez (dar de baja un evento mueve
  // eventos_activos ademas de sacarlo de la tabla filtrada por "Activos").
  const [refreshToken, setRefreshToken] = useState(0);

  const loadStats = useCallback(() => {
    setStatsError(null);
    adminFetch("/api/admin/stats", accessToken)
      .then(setStats)
      .catch((err) => setStatsError(err.message));
  }, [accessToken]);

  useEffect(() => {
    loadStats();
  }, [loadStats, refreshToken]);

  function handleMutated() {
    setRefreshToken((n) => n + 1);
  }

  async function handleConfirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await adminFetch(`/api/admin/events/${deletingEvent.id}`, accessToken, { method: "DELETE" });
      setDeletingEvent(null);
      setDeleteBusy(false);
      handleMutated();
    } catch (err) {
      setDeleteError(err.message);
      setDeleteBusy(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--flyer-ink)" }}>
      <header className="h-14 flex-shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 trial-navbar">
        <h1 className="flyer-title text-base sm:text-xl uppercase shrink-0" style={{ letterSpacing: "-0.02em" }}>
          Panel de administración
        </h1>
        <a
          href="/"
          className="trial-ghost-btn trial-sans text-xs font-medium rounded-full px-3 py-2 transition-colors whitespace-nowrap"
        >
          Volver al mapa
        </a>
      </header>

      <main className="p-4 sm:p-6 flex flex-col gap-6 max-w-6xl mx-auto">
        <section aria-labelledby="admin-dashboard-heading" className="flex flex-col gap-3">
          <h2 id="admin-dashboard-heading" className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">
            Estado del proyecto
          </h2>
          {statsError ? (
            <div className="flyer-banner-error rounded-xl px-4 py-3 flyer-sans text-sm" role="alert">
              No se pudieron cargar las estadísticas: {statsError}
            </div>
          ) : (
            <Dashboard stats={stats} />
          )}
        </section>

        <section aria-labelledby="admin-events-heading" className="flex flex-col gap-3">
          <h2 id="admin-events-heading" className="flyer-sans flyer-text-muted text-xs uppercase tracking-wide">
            Eventos
          </h2>
          <EventsTable
            accessToken={accessToken}
            refreshToken={refreshToken}
            onEdit={setEditingEvent}
            onRequestDelete={(ev) => {
              setDeleteError(null);
              setDeletingEvent(ev);
            }}
          />
        </section>
      </main>

      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          accessToken={accessToken}
          onClose={() => setEditingEvent(null)}
          onSaved={() => {
            setEditingEvent(null);
            handleMutated();
          }}
        />
      )}

      {deletingEvent && (
        <ConfirmDialog
          title="Dar de baja este evento"
          description={`"${deletingEvent.name}" va a dejar de mostrarse en el mapa y en el chat. Sigue disponible acá en el panel, con is_active=false. Esta acción no borra el registro.`}
          confirmLabel="Sí, dar de baja"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingEvent(null)}
        />
      )}
    </div>
  );
}
