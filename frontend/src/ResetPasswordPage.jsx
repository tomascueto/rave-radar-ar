import { useEffect, useState } from "react";

const API_BASE = "http://localhost:8000";

export default function ResetPasswordPage() {
  const [token, setToken] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "No se pudo restablecer la contraseña");
        return;
      }
      setDone(true);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center">
          <p className="text-sm text-red-600">
            Este link no es válido. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center">
          <p className="text-sm text-green-700 mb-4">
            Contraseña actualizada. Ya podés iniciar sesión.
          </p>
          <a
            href="/"
            className="inline-block bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Ir a Rave Radar AR
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h2 className="font-semibold text-lg text-slate-800 mb-4">Elegí una nueva contraseña</h2>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            placeholder="Contraseña nueva (mínimo 8 caracteres)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
          />
          <input
            type="password"
            placeholder="Repetí la contraseña"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg disabled:bg-slate-300 transition-colors"
          >
            {loading ? "Guardando..." : "Guardar nueva contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}