import { useState } from "react";

const API_BASE = "http://localhost:8000";

export default function AuthModal({ onClose, onLoginSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  function resetFeedback() {
    setError(null);
    setSuccessMessage(null);
  }

  function switchMode(newMode) {
    resetFeedback();
    setMode(newMode);
  }

  async function handleLogin(e) {
    e.preventDefault();
    resetFeedback();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "No se pudo iniciar sesión");
        return;
      }
      onLoginSuccess(data.access_token);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    resetFeedback();
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, display_name: displayName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "No se pudo crear la cuenta");
        return;
      }
      setSuccessMessage(data.message);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    resetFeedback();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setSuccessMessage(data.message);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleLogin() {
    window.location.href = `${API_BASE}/api/auth/google/login`;
  }

  const titles = {
    login: "Iniciar sesión",
    register: "Crear cuenta",
    forgot: "Recuperar contraseña",
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="flyer-modal flyer-pop-enter rounded-2xl max-w-sm w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flyer-text-muted hover:opacity-100 text-xl leading-none transition-opacity"
          style={{ color: "var(--flyer-paper)", opacity: 0.55 }}
        >
          ×
        </button>

        <h2 className="flyer-sans font-bold text-lg mb-4" style={{ color: "var(--flyer-paper)" }}>
          {titles[mode]}
        </h2>

        {error && (
          <div className="flyer-sans flyer-banner-error mb-3 text-sm rounded-lg px-3 py-2">{error}</div>
        )}
        {successMessage && (
          <div className="flyer-sans flyer-banner-success mb-3 text-sm rounded-lg px-3 py-2">
            {successMessage}
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="flyer-btn-solid flyer-sans w-full text-sm font-semibold py-2 rounded-lg disabled:opacity-40 transition-colors"
            >
              {loading ? "Entrando..." : "Iniciar sesión"}
            </button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="flyer-sans hover:underline"
                style={{ color: "var(--flyer-violet)" }}
              >
                ¿Olvidaste tu contraseña?
              </button>
              <button type="button" onClick={() => switchMode("register")} className="flyer-sans flyer-text-muted hover:underline">
                Crear cuenta
              </button>
            </div>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={handleRegister} className="space-y-3">
            <input
              type="text"
              placeholder="Nombre (opcional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
            />
            <input
              type="password"
              placeholder="Contraseña (mínimo 8 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="flyer-btn-solid flyer-sans w-full text-sm font-semibold py-2 rounded-lg disabled:opacity-40 transition-colors"
            >
              {loading ? "Creando..." : "Crear cuenta"}
            </button>
            <div className="text-center text-xs">
              <button type="button" onClick={() => switchMode("login")} className="flyer-sans flyer-text-muted hover:underline">
                Ya tengo cuenta
              </button>
            </div>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flyer-sans flyer-field w-full px-3 py-2 text-sm rounded-lg transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="flyer-btn-solid flyer-sans w-full text-sm font-semibold py-2 rounded-lg disabled:opacity-40 transition-colors"
            >
              {loading ? "Enviando..." : "Enviar instrucciones"}
            </button>
            <div className="text-center text-xs">
              <button type="button" onClick={() => switchMode("login")} className="flyer-sans flyer-text-muted hover:underline">
                Volver a iniciar sesión
              </button>
            </div>
          </form>
        )}

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px" style={{ background: "rgba(124, 58, 237, 0.25)" }} />
          <span className="flyer-sans flyer-text-faint text-xs">o</span>
          <div className="flex-1 h-px" style={{ background: "rgba(124, 58, 237, 0.25)" }} />
        </div>

        <button
          onClick={handleGoogleLogin}
          className="flyer-ghost-btn flyer-sans w-full text-sm font-semibold py-2 rounded-lg transition-colors"
        >
          Continuar con Google
        </button>
      </div>
    </div>
  );
}
