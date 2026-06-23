import { AbuseAnalytics } from "../types";
import { money, formatTime, statusTone, compactId } from "../utils";

interface RiskTabProps {
  abuseAnalytics: AbuseAnalytics | null;
  recordAbuseAction: (subjectType: string, subjectId: string, action: string) => Promise<void>;
}

export function RiskTab({ abuseAnalytics, recordAbuseAction }: RiskTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Abuse Analytics</h2>
          <span>{abuseAnalytics?.totals.signals ?? 0} signals</span>
        </div>
        <div className="metrics-grid ops-metrics">
          <div className="metric-card critical"><span>Critical</span><strong>{abuseAnalytics?.totals.criticalSignals ?? 0}</strong></div>
          <div className="metric-card watch"><span>High risk</span><strong>{abuseAnalytics?.totals.highSignals ?? 0}</strong></div>
          <div className="metric-card"><span>Monitored escrows</span><strong>{abuseAnalytics?.totals.monitoredEscrows ?? 0}</strong></div>
          <div className="metric-card watch"><span>Active actions</span><strong>{abuseAnalytics?.totals.activeActions ?? 0}</strong></div>
          <div className="metric-card watch"><span>Suggestions</span><strong>{abuseAnalytics?.totals.suggestedActions ?? 0}</strong></div>
        </div>
        <div className="section-head ops-subhead">
          <h2>Suggested Actions</h2>
          <span>{abuseAnalytics?.suggestedActions?.length ?? 0}</span>
        </div>
        <div className="event-grid">
          {abuseAnalytics?.suggestedActions?.map((item) => (
            <div key={`${item.subjectType}:${item.subjectId}:${item.suggestedAction}`} className={`event-row ops-event ${item.suggestedAction === "block" ? "error" : "warning"}`}>
              <div>
                <strong>{item.suggestedAction} · {compactId(item.subjectId, 34)}</strong>
                <span>{item.confidence}% confidence · {item.reason}</span>
              </div>
              <button className="button small" onClick={() => recordAbuseAction(item.subjectType, item.subjectId, item.suggestedAction)}>Apply</button>
            </div>
          ))}
          {!abuseAnalytics?.suggestedActions?.length && <p className="muted">No reputation action suggestions</p>}
        </div>
        <div className="section-head ops-subhead">
          <h2>Reputation Watchlist</h2>
          <span>{abuseAnalytics?.reputationWatchlist.length ?? 0}</span>
        </div>
        <div className="event-grid">
          {abuseAnalytics?.reputationWatchlist.map((item) => (
            <div key={`${item.subjectType}:${item.subjectId}`} className={`event-row ops-event ${item.maxRiskScore >= 90 ? "error" : "warning"}`}>
              <div>
                <strong>{item.subjectId} · score {item.maxRiskScore}</strong>
                <span>{item.signals} signals · {item.reasons.slice(0, 2).join("; ")}</span>
              </div>
              <button className="button small" onClick={() => recordAbuseAction("user", item.subjectId, "watch")}>Watch</button>
              <button className="button small" onClick={() => recordAbuseAction("user", item.subjectId, "block")}>Block</button>
              <time>{formatTime(item.lastSeenAt)}</time>
            </div>
          ))}
          {!abuseAnalytics?.reputationWatchlist.length && <p className="muted">No reputation watch records</p>}
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Velocity Dashboard</h2>
          <span>{abuseAnalytics?.velocityWatchlist.length ?? 0} users</span>
        </div>
        <div className="event-grid">
          {abuseAnalytics?.velocityWatchlist.map((item) => (
            <div key={item.buyerUserId} className="event-row ops-event warning">
              <div>
                <strong>{compactId(item.buyerUserId, 18)}</strong>
                <span>{item.escrows} escrows · {item.active} active · {item.disputed} disputed · {item.reviewRequired} review</span>
              </div>
              <time>{formatTime(item.latestAt)}</time>
            </div>
          ))}
          {!abuseAnalytics?.velocityWatchlist.length && <p className="muted">No velocity outliers</p>}
        </div>
        <div className="section-head ops-subhead">
          <h2>Cross-Device Graph</h2>
          <span>{abuseAnalytics?.fingerprintWatchlist.length ?? 0}</span>
        </div>
        <div className="event-grid">
          {abuseAnalytics?.fingerprintWatchlist.map((item) => (
            <div key={item.fingerprint} className={`event-row ops-event ${item.maxRiskScore >= 90 ? "error" : "warning"}`}>
              <div>
                <strong>{compactId(item.fingerprint, 34)}</strong>
                <span>{item.signals} signals · score {item.maxRiskScore} · {item.subjects.length} subjects</span>
              </div>
              <time>{formatTime(item.lastSeenAt)}</time>
            </div>
          ))}
          {!abuseAnalytics?.fingerprintWatchlist.length && <p className="muted">No repeated device/account fingerprints</p>}
        </div>
        <div className="section-head ops-subhead">
          <h2>Recent Signals</h2>
          <span>{abuseAnalytics?.actions.length ?? 0} actions</span>
        </div>
        <div className="event-grid">
          {abuseAnalytics?.actions.slice(0, 8).map((action) => (
            <div key={action.actionId} className={`event-row ops-event ${action.action === "block" ? "error" : "warning"}`}>
              <div>
                <strong>{action.action} · {action.subjectId}</strong>
                <span>{action.reason} · by {action.createdBy}</span>
              </div>
              <time>{formatTime(action.createdAt)}</time>
            </div>
          ))}
          {!abuseAnalytics?.actions.length && <p className="muted">No persistent abuse actions</p>}
        </div>
      </aside>
    </section>
  );
}
