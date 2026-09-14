function AuthBar({ currentUser, onLogin, onLogout }) {
  if (currentUser) {
    return (
      <div className="flex items-center gap-2">
        {currentUser.avatar_url && (
          <img
            src={currentUser.avatar_url}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="text-sm text-slate-600 hidden sm:inline">
          {currentUser.display_name}
        </span>
        <button
          onClick={onLogout}
          className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-full px-3 py-1.5 transition-colors"
        >
          Salir
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onLogin}
      className="text-sm font-medium text-violet-600 hover:text-violet-700 border border-violet-200 rounded-full px-4 py-1.5 transition-colors"
    >
      Iniciar sesión
    </button>
  );
}

export default function Navbar({ currentUser, onLogin, onLogout }) {
  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-4 border-b border-slate-200 bg-white">
      <h1 className="font-semibold text-slate-800">Rave Radar AR</h1>
      <AuthBar currentUser={currentUser} onLogin={onLogin} onLogout={onLogout} />
    </header>
  );
}