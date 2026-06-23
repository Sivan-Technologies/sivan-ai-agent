import { OperationsStatus, QueueStatus, AbuseSignal, SupportCase, DisasterRecoveryStatus, WhatsAppProviderStatus, SettlementProof, OperationalEvent } from "../types";
import { formatTime } from "../utils";

interface OpsTabProps {
  operationsStatus: OperationsStatus | null;
  queueStatus: QueueStatus | null;
  abuseSignals: AbuseSignal[];
  supportCases: SupportCase[];
  disasterRecoveryStatus: DisasterRecoveryStatus | null;
  whatsappProviderStatus: WhatsAppProviderStatus | null;
  actionBusy: boolean;
  switchWhatsAppProvider: (provider: "twilio" | "meta") => Promise<void>;
  settlementProof: SettlementProof | null;
  runSettlementVerification: () => Promise<void>;
  operationalEvents: OperationalEvent[];
  setError: (error: string | null) => void;
}

export function OpsTab({
  operationsStatus,
  queueStatus,
  abuseSignals,
  supportCases,
  disasterRecoveryStatus,
  whatsappProviderStatus,
  actionBusy,
  switchWhatsAppProvider,
  settlementProof,
  runSettlementVerification,
  operationalEvents,
  setError,
}: OpsTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Operations Status</h2>
          <span>{operationsStatus?.status || "unknown"}</span>
        </div>
        <div className="metrics-grid ops-metrics">
          <div className={`metric-card ${operationsStatus?.database.status === "ok" ? "good" : "critical"}`}>
            <span>Database</span>
            <strong>{operationsStatus?.database.status || "-"}</strong>
          </div>
          <div className={`metric-card ${operationsStatus?.operations.sentryConfigured ? "good" : "watch"}`}>
            <span>Sentry</span>
            <strong>{operationsStatus?.operations.sentryConfigured ? "On" : "Off"}</strong>
          </div>
          <div className={`metric-card ${operationsStatus?.operations.alertsConfigured ? "good" : "watch"}`}>
            <span>Alerts</span>
            <strong>{operationsStatus?.operations.alertsConfigured ? "On" : "Off"}</strong>
          </div>
          <div className={`metric-card ${operationsStatus?.operations.recentErrors ? "critical" : "good"}`}>
            <span>Recent errors</span>
            <strong>{operationsStatus?.operations.recentErrors ?? 0}</strong>
          </div>
          <div className={`metric-card ${queueStatus?.dead || queueStatus?.failed ? "critical" : "good"}`}>
            <span>Queue failures</span>
            <strong>{(queueStatus?.dead || 0) + (queueStatus?.failed || 0)}</strong>
          </div>
          <div className={`metric-card ${abuseSignals.length ? "watch" : "good"}`}>
            <span>Abuse signals</span>
            <strong>{abuseSignals.length}</strong>
          </div>
          <div className={`metric-card ${supportCases.filter((item) => item.status === "open").length ? "watch" : "good"}`}>
            <span>Open support</span>
            <strong>{supportCases.filter((item) => item.status === "open").length}</strong>
          </div>
          <div className={`metric-card ${disasterRecoveryStatus?.status === "ok" ? "good" : "watch"}`}>
            <span>Backup / DR</span>
            <strong>{disasterRecoveryStatus?.status || "unknown"}</strong>
          </div>
        </div>
        <div className="detail-stack">
          <div className="detail-row"><span>Provider</span><strong>{operationsStatus?.database.provider || "unknown"}</strong></div>
          <div className="detail-row"><span>DB latency</span><strong>{operationsStatus?.database.latencyMs ?? "-"} ms</strong></div>
          <div className="detail-row"><span>Settings version</span><strong>{operationsStatus?.database.settingsVersion || "-"}</strong></div>
          <div className="detail-row"><span>Recent warnings</span><strong>{operationsStatus?.operations.recentWarnings ?? 0}</strong></div>
        </div>
        <div className="section-head ops-subhead">
          <h2>WhatsApp Provider</h2>
          <span>{whatsappProviderStatus?.activeProvider || "unknown"}</span>
        </div>
        <div className="detail-stack">
          <div className="detail-row"><span>Active outbound</span><strong>{whatsappProviderStatus?.activeProvider || "unknown"}</strong></div>
          <div className="detail-row"><span>Twilio</span><strong>{whatsappProviderStatus?.providers?.twilio?.configured ? "Configured" : "Not configured"}</strong></div>
          <div className="detail-row"><span>Meta Cloud API</span><strong>{whatsappProviderStatus?.providers?.meta?.configured ? "Configured" : "Not configured"}</strong></div>
          <div className="detail-row"><span>Meta Graph</span><strong>{whatsappProviderStatus?.providers?.meta?.graphApiVersion || "not set"}</strong></div>
          {whatsappProviderStatus?.warning ? <div className="detail-note critical-note">{whatsappProviderStatus.warning}</div> : null}
          <div className="toolbar-row">
            <button
              className="button secondary"
              disabled={actionBusy || !whatsappProviderStatus?.providers?.twilio?.configured || whatsappProviderStatus?.activeProvider === "twilio"}
              onClick={async () => {
                try {
                  await switchWhatsAppProvider("twilio");
                } catch (err: any) {
                  setError(err.message || "WhatsApp provider switch failed");
                }
              }}
            >
              Use Twilio
            </button>
            <button
              className="button secondary"
              disabled={actionBusy || !whatsappProviderStatus?.providers?.meta?.configured || whatsappProviderStatus?.activeProvider === "meta"}
              onClick={async () => {
                try {
                  await switchWhatsAppProvider("meta");
                } catch (err: any) {
                  setError(err.message || "WhatsApp provider switch failed");
                }
              }}
            >
              Use Meta
            </button>
          </div>
          <div className="detail-note">Runtime switching changes the current bot process. Update Render env `WHATSAPP_PROVIDER` for the permanent deploy default.</div>
        </div>
        <div className="section-head ops-subhead">
          <h2>Backup and Recovery</h2>
          <span>{disasterRecoveryStatus?.backup.provider || "not configured"}</span>
        </div>
        <div className="detail-stack">
          <div className="detail-row"><span>Database backups</span><strong>{disasterRecoveryStatus?.backup.configured ? "Configured" : "Needs setup"}</strong></div>
          <div className="detail-row"><span>Retention</span><strong>{disasterRecoveryStatus?.backup.retentionDays ?? 0} days</strong></div>
          <div className="detail-row"><span>Restore drill</span><strong>{disasterRecoveryStatus?.restore.fresh ? "Fresh" : disasterRecoveryStatus?.restore.lastStatus || "not recorded"}</strong></div>
          <div className="detail-row"><span>Last restore test</span><strong>{formatTime(disasterRecoveryStatus?.restore.lastTestAt || undefined)}</strong></div>
          <div className="detail-row"><span>Rollback plan</span><strong>{disasterRecoveryStatus?.rollback.configured ? "Configured" : "Needs setup"}</strong></div>
          <div className="detail-row"><span>Outage procedure</span><strong>{disasterRecoveryStatus?.outage.configured ? "Configured" : "Needs contacts"}</strong></div>
          {disasterRecoveryStatus?.status !== "ok" ? <div className="detail-note critical-note">Run `npm run dr:check` after deploys and record restore-test proof in release notes.</div> : null}
        </div>
        <div className="section-head ops-subhead">
          <h2>Settlement Verification</h2>
          <span>{settlementProof?.status || "not run"}</span>
        </div>
        <div className="detail-stack">
          <div className="detail-row"><span>SAP</span><strong>{settlementProof?.sap?.status || "unknown"}</strong></div>
          <div className="detail-row"><span>x402</span><strong>{settlementProof?.x402?.status || "unknown"}</strong></div>
          <div className="detail-row"><span>Last checked</span><strong>{formatTime(settlementProof?.checkedAt)}</strong></div>
          {settlementProof?.warnings?.length ? <div className="detail-note critical-note">{settlementProof.warnings.join("; ")}</div> : null}
        </div>
        <button
          className="button primary full ops-action"
          onClick={async () => {
            try {
              await runSettlementVerification();
            } catch (err: any) {
              setError(err.message || "Settlement verification failed");
            }
          }}
        >
          Run settlement verification
        </button>
        <div className="section-head ops-subhead">
          <h2>Abuse Signals</h2>
          <span>{abuseSignals.length} records</span>
        </div>
        <div className="event-grid">
          {abuseSignals.slice(0, 5).map((signal) => (
            <div key={signal.signalId} className={`event-row ops-event ${signal.riskScore >= 70 ? "error" : "warning"}`}>
              <div>
                <strong>{signal.category} · {signal.riskScore}</strong>
                <span>{signal.reason}</span>
              </div>
              <time>{formatTime(signal.createdAt)}</time>
            </div>
          ))}
          {abuseSignals.length === 0 && <p className="muted">No abuse signals</p>}
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Support Queue</h2>
          <span>{supportCases.length} cases</span>
        </div>
        <div className="event-grid">
          {supportCases.map((supportCase) => (
            <div key={supportCase.caseId} className={`event-row ops-event ${supportCase.priority === "urgent" || supportCase.priority === "high" ? "error" : "warning"}`}>
              <div>
                <strong>{supportCase.subject}</strong>
                <span>{supportCase.status} · {supportCase.priority} · {supportCase.relatedEscrowId || supportCase.source}</span>
              </div>
              <time>{formatTime(supportCase.updatedAt)}</time>
            </div>
          ))}
          {supportCases.length === 0 && <p className="muted">No support cases</p>}
        </div>

        <div className="section-head ops-subhead">
          <h2>Recent Events</h2>
          <span>{operationalEvents.length} records</span>
        </div>
        <div className="event-grid">
          {operationalEvents.map((event) => (
            <div key={event.id} className={`event-row ops-event ${event.level}`}>
              <div>
                <strong>{event.message}</strong>
                <span>{event.error || JSON.stringify(event.context)}</span>
              </div>
              <time>{formatTime(event.createdAt)}</time>
            </div>
          ))}
          {operationalEvents.length === 0 && <p className="muted">No operational events</p>}
        </div>
      </aside>
    </section>
  );
}
