function AuthBar({ currentUser, onOpenAuth, onOpenPreferences, onOpenUserPanel, onLogout }) {
  if (currentUser) {
    const initial = (currentUser.display_name || currentUser.email || "?").trim().charAt(0).toUpperCase();
    return (
      <div className="flex items-center gap-2">
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
          <span className="flyer-sans flyer-text-muted text-sm font-medium hidden sm:inline">
            {currentUser.display_name}
          </span>
        </button>
        <button
          onClick={onOpenPreferences}
          className="flyer-ghost-btn flyer-sans text-xs font-semibold uppercase tracking-wide rounded-full px-3 py-1.5 transition-colors"
        >
          Preferencias
        </button>
        <button
          onClick={onLogout}
          className="flyer-ghost-btn flyer-sans text-xs font-semibold uppercase tracking-wide rounded-full px-3 py-1.5 transition-colors"
        >
          Salir
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onOpenAuth}
      className="flyer-navbar-cta flyer-sans text-sm font-bold rounded-full px-6 py-2.5"
    >
      Iniciar sesión
    </button>
  );
}

export default function Navbar({ currentUser, onOpenAuth, onOpenPreferences, onOpenUserPanel, onLogout }) {
  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-4 flyer-navbar">
      <h1 className="flyer-title text-xl uppercase" style={{ letterSpacing: "-0.02em" }}>
        Rave Radar AR
      </h1>
      <AuthBar
        currentUser={currentUser}
        onOpenAuth={onOpenAuth}
        onOpenPreferences={onOpenPreferences}
        onOpenUserPanel={onOpenUserPanel}
        onLogout={onLogout}
      />
    </header>
  );
}