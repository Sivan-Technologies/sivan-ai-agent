import { AuthIdentity, AuthStats, AuthAuditEvent, AuthSessionRecord } from "../types";
import { formatTime } from "../utils";

interface AuthTabProps {
  adminKey: string;
  isJwtToken: (value: string) => boolean;
  decodeJwtPayload: (token: string) => any;
  authIdentity: AuthIdentity | null;
  requestTelegramToken: () => Promise<void>;
  clearAdminKey: () => void;
  authError: string | null;
  authLoading: boolean;
  loadAuthServiceInfo: () => Promise<void>;
  authStats: AuthStats | null;
  authAuditEvents: AuthAuditEvent[];
  authSessions: AuthSessionRecord[];
  revokeAuthSession: (sessionId: string) => Promise<void>;
  adminAuthBase: string;
}

export function AuthTab({
  adminKey,
  isJwtToken,
  decodeJwtPayload,
  authIdentity,
  requestTelegramToken,
  clearAdminKey,
  authError,
  authLoading,
  loadAuthServiceInfo,
  authStats,
  authAuditEvents,
  authSessions,
  revokeAuthSession,
  adminAuthBase,
}: AuthTabProps) {
  return (
    <section className="surface auth-surface">
      <div className="section-head">
        <h2>Admin Auth</h2>
        <span>Telegram session and activity</span>
      </div>
      <div className="auth-grid">
        <div className="surface auth-card">
          <h3>Authentication Status</h3>
          <div className="detail-row"><span>Backend auth base</span><strong>{adminAuthBase.replace(/^https?:\/\//, "")}</strong></div>
          <div className="detail-row"><span>Logged in</span><strong>{adminKey ? "Yes" : "No"}</strong></div>
          <div className="detail-row"><span>Auth method</span><strong>{adminKey ? (isJwtToken(adminKey) ? "Telegram JWT" : "Legacy static key") : "Not authenticated"}</strong></div>
          {adminKey && isJwtToken(adminKey) ? (
            (() => {
              const payload = decodeJwtPayload(adminKey);
              return payload ? (
                <>
                  <div className="detail-row"><span>Admin</span><strong>{authIdentity?.adminUsername || payload.adminUsername || payload.adminIdentifier || payload.sub || "admin"}</strong></div>
                  <div className="detail-row"><span>Expires</span><strong>{payload.exp ? new Date(payload.exp * 1000).toLocaleString() : "unknown"}</strong></div>
                </>
              ) : null;
            })()
          ) : null}
          <div className="button-group">
            <button className="button primary full" onClick={requestTelegramToken} disabled={authLoading}>
              Request Telegram token
            </button>
            <button className="button secondary full" onClick={clearAdminKey}>
              Logout / Clear session
            </button>
          </div>
        </div>

        <div className="surface auth-card">
          <h3>Activity & metrics</h3>
          {authError && <div className="error-banner">{authError}</div>}
          {!adminKey ? (
            <p className="muted">Sign in with Telegram first to view activity.</p>
          ) : !isJwtToken(adminKey) ? (
            <p className="muted">Admin metrics require a Telegram JWT. Legacy admin key mode has limited visibility.</p>
          ) : authLoading ? (
            <p className="muted">Loading session activity…</p>
          ) : (
            <>
              <button className="button secondary full" onClick={loadAuthServiceInfo} disabled={authLoading}>
                Refresh auth activity
              </button>
              {authStats ? (
                <div className="preview-list" style={{ marginTop: 16 }}>
                  <div className="preview-row"><span>Current admin</span><strong>{authIdentity?.adminUsername || "-"}</strong></div>
                  <div className="preview-row"><span>Total requests</span><strong>{authStats.total_requests ?? "-"}</strong></div>
                  <div className="preview-row"><span>Successful verifications</span><strong>{authStats.successful_verifications ?? "-"}</strong></div>
                  <div className="preview-row"><span>Failed verifications</span><strong>{authStats.failed_verifications ?? "-"}</strong></div>
                  <div className="preview-row"><span>Telegram errors</span><strong>{authStats.telegram_errors ?? "-"}</strong></div>
                  <div className="preview-row"><span>Unique admins</span><strong>{authStats.unique_admins ?? "-"}</strong></div>
                  <div className="preview-row"><span>Unique IPs</span><strong>{authStats.unique_ips ?? "-"}</strong></div>
                </div>
              ) : (
                <p className="muted">No auth metrics available yet.</p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="surface auth-card">
        <h3>Auth Audit</h3>
        {authAuditEvents.length === 0 ? (
          <p className="muted">No auth audit events to display.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Admin</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {authAuditEvents.map((event) => (
                  <tr key={event.eventId}>
                    <td>{formatTime(event.createdAt)}</td>
                    <td>{event.eventType}</td>
                    <td>{event.adminUsername || "-"}</td>
                    <td>{event.status}</td>
                    <td>{event.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="surface auth-card">
        <h3>Active Sessions</h3>
        {authSessions.length === 0 ? (
          <p className="muted">No active Telegram auth sessions to display.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>IP</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {authSessions.map((session) => (
                  <tr key={session.sessionId}>
                    <td>{session.adminIdentifier}</td>
                    <td>{formatTime(session.createdAt)}</td>
                    <td>{session.expiresAt ? formatTime(session.expiresAt) : "unknown"}</td>
                    <td>{session.ip || "-"}</td>
                    <td>
                      <button className="button small" onClick={() => revokeAuthSession(session.sessionId)} disabled={authLoading}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
