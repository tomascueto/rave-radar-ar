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
    <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-xl leading-none"
        >
          ×
        </button>

        <h2 className="font-semibold text-lg text-slate-800 mb-4">{titles[mode]}</h2>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
        )}
        {successMessage && (
          <div className="mb-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
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
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg disabled:bg-slate-300 transition-colors"
            >
              {loading ? "Entrando..." : "Iniciar sesión"}
            </button>
            <div className="flex justify-between text-xs">
              <button type="button" onClick={() => switchMode("forgot")} className="text-violet-600 hover:underline">
                ¿Olvidaste tu contraseña?
              </button>
              <button type="button" onClick={() => switchMode("register")} className="text-slate-500 hover:underline">
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
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <input
              type="password"
              placeholder="Contraseña (mínimo 8 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg disabled:bg-slate-300 transition-colors"
            >
              {loading ? "Creando..." : "Crear cuenta"}
            </button>
            <div className="text-center text-xs">
              <button type="button" onClick={() => switchMode("login")} className="text-slate-500 hover:underline">
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
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg disabled:bg-slate-300 transition-colors"
            >
              {loading ? "Enviando..." : "Enviar instrucciones"}
            </button>
            <div className="text-center text-xs">
              <button type="button" onClick={() => switchMode("login")} className="text-slate-500 hover:underline">
                Volver a iniciar sesión
              </button>
            </div>
          </form>
        )}

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400">o</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <button
          onClick={handleGoogleLogin}
          className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Continuar con Google
        </button>
      </div>
    </div>
  );
}