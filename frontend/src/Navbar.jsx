import { HeartIcon } from "./Map";

// Dibujado, no libreria de iconos ni emoji -- mismo criterio que
// HeartIcon/ChevronIcon/PinIcon en el resto de la app. Puerta + flecha,
// el glifo estandar de "iniciar sesion".
function LoginIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15 3h3.5A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5H15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12h11.5M11 7.5 15.5 12 11 16.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AuthBar({ currentUser, onOpenAuth, onOpenPreferences, onOpenUserPanel, onOpenSavedEvents, onLogout }) {
  if (currentUser) {
    const initial = (currentUser.display_name || currentUser.email || "?").trim().charAt(0).toUpperCase();
    return (
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          onClick={onOpenSavedEvents}
          title="Eventos guardados"
          aria-label="Eventos guardados"
          className="trial-ghost-btn w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        >
          <HeartIcon filled={false} className="w-4 h-4" />
        </button>
        <button
          onClick={onOpenUserPanel}
          title="Tu cuenta"
          className="flex items-center gap-2 rounded-full transition-opacity hover:opacity-80"
        >
          {currentUser.avatar_url ? (
            <img
              src={currentUser.avatar_url}
              alt=""
              className="w-9 h-9 rounded-full border"
              style={{ borderColor: "rgba(124, 58, 237, 0.5)" }}
              referrerPolicy="no-referrer"
            />
          ) : (
            // Sin foto vinculada (ni de Google ni de ningun otro lado):
            // avatar generico con la inicial del nombre, en vez de dejar
            // el boton sin ninguna senal visual de "esto es tu cuenta".
            <span
              className="flyer-sans w-9 h-9 rounded-full border flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                borderColor: "rgba(124, 58, 237, 0.5)",
                background: "var(--flyer-violet)",
                color: "var(--flyer-paper)",
              }}
            >
              {initial}
            </span>
          )}
          <span className="trial-sans flyer-text-muted text-sm font-medium hidden sm:inline">
            {currentUser.display_name}
          </span>
        </button>
        <button
          onClick={onOpenPreferences}
          title="Preferencias"
          className="trial-ghost-btn trial-sans text-xs font-medium rounded-full px-2 sm:px-3 py-2 transition-colors whitespace-nowrap"
        >
          <span className="hidden sm:inline">Preferencias</span>
          <span className="sm:hidden">Prefs.</span>
        </button>
        <button
          onClick={onLogout}
          className="trial-ghost-btn trial-sans text-xs font-medium rounded-full px-2 sm:px-3 py-2 transition-colors whitespace-nowrap"
        >
          Salir
        </button>
      </div>
    );
  }
  return (
    // Reusa .flyer-cta (el mismo botón que "Comprar entrada" en EventCard,
    // ver Map.jsx) en vez de duplicar sus valores -- mismo corte de
    // esquina, color, tipografia y estados hover/active/focus. Solo el
    // padding se ajusta (mas chico) para que entre bien en el navbar.
    <button
      onClick={onOpenAuth}
      className="flyer-cta flyer-sans inline-flex items-center gap-2 uppercase tracking-wide text-sm font-bold px-4 py-2.5 transition-colors"
    >
      <LoginIcon className="w-4 h-4" />
      Iniciar sesión
    </button>
  );
}

export default function Navbar({
  currentUser, onOpenAuth, onOpenPreferences, onOpenUserPanel, onOpenSavedEvents, onLogout,
}) {
  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 trial-navbar">
      <h1 className="flyer-title text-base sm:text-xl uppercase shrink-0" style={{ letterSpacing: "-0.02em" }}>
        Rave Radar AR
      </h1>
      <AuthBar
        currentUser={currentUser}
        onOpenAuth={onOpenAuth}
        onOpenPreferences={onOpenPreferences}
        onOpenUserPanel={onOpenUserPanel}
        onOpenSavedEvents={onOpenSavedEvents}
        onLogout={onLogout}
      />
    </header>
  );
}