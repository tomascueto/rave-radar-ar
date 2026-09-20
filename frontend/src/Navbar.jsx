function AuthBar({ currentUser, onOpenAuth, onOpenPreferences, onLogout }) {
  if (currentUser) {
    return (
      <div className="flex items-center gap-2">
        {currentUser.avatar_url && (
          <img
            src={currentUser.avatar_url}
            alt=""
            className="w-8 h-8 rounded-full border"
            style={{ borderColor: "rgba(124, 58, 237, 0.5)" }}
            referrerPolicy="no-referrer"
          />
        )}
        <span className="flyer-sans flyer-text-muted text-sm font-medium hidden sm:inline">
          {currentUser.display_name}
        </span>
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

export default function Navbar({ currentUser, onOpenAuth, onOpenPreferences, onLogout }) {
  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-4 flyer-navbar">
      <h1 className="flyer-title text-xl uppercase" style={{ letterSpacing: "-0.02em" }}>
        Rave Radar AR
      </h1>
      <AuthBar
        currentUser={currentUser}
        onOpenAuth={onOpenAuth}
        onOpenPreferences={onOpenPreferences}
        onLogout={onLogout}
      />
    </header>
  );
}