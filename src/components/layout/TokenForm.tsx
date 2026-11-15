// Token entry form. Shown when localStorage has no mc.token, or after any 401.
// The candidate token is validated against /api/agents before it is stored.
import { Box, CircleExclamationPoint, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, apiGet, setToken } from "../../api/client";

export function TokenForm({ expired = false }: { expired?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) { setError("Enter the API token."); return; }
    setBusy(true);
    setError(null);
    try {
      await apiGet("/api/agents", { token });
      setToken(token);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : -1;
      setError(
        status === 401 ? "Token rejected by the API (401). Check MISSION_CONTROL_V2_API_TOKEN in .env."
          : status === 0 ? "Can't reach Mission Control API on :8742."
          : `Unexpected response: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="token-page">
      <form className="token-card" onSubmit={submit} noValidate>
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark"><Box size={16} /></span>
          <span className="brand-name">Mission Control</span>
          <span className="brand-tag">v2</span>
        </div>
        <div>
          <div className="lg semibold row"><KeyRound size={18} className="muted" /> API token required</div>
          <p className="sm secondary" style={{ marginTop: 4 }}>
            {expired
              ? "The stored token was rejected (401) and has been cleared. Enter the current token to continue."
              : "Every /api request needs the bearer token from this project's .env file."}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="mc-token">MISSION_CONTROL_V2_API_TOKEN</label>
          <input
            id="mc-token"
            className="token-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={value}
            aria-invalid={!!error}
            aria-describedby={error ? "mc-token-err" : "mc-token-hint"}
            onChange={(e) => setValue(e.target.value)}
          />
          {error ? (
            <div id="mc-token-err" className="field-error" role="alert"><CircleExclamationPoint size={12} /> {error}</div>
          ) : (
            <div id="mc-token-hint" className="xs muted">
              Stored in this browser only (localStorage <code className="inline-code">mc.token</code>).
            </div>
          )}
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: "center", height: 36 }}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
