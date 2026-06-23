import { EscrowTimeline, EscrowRecord } from "../types";
import { money, formatTime, statusTone } from "../utils";

interface AuditTabProps {
  timeline: EscrowTimeline | null;
  timelineEscrowId: string;
  setTimelineEscrowId: (id: string) => void;
  selectedEscrow: EscrowRecord | null;
  loadEscrowTimeline: (escrowId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export function AuditTab({
  timeline,
  timelineEscrowId,
  setTimelineEscrowId,
  selectedEscrow,
  loadEscrowTimeline,
  setError,
}: AuditTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Escrow Event Explorer</h2>
          <span>{timeline?.escrowId || "select escrow"}</span>
        </div>
        <label className="field compact-field">
          <span>Escrow ID</span>
          <input value={timelineEscrowId} onChange={(event) => setTimelineEscrowId(event.target.value)} placeholder="SIV-..." autoComplete="off" />
        </label>
        <button
          className="button primary"
          onClick={async () => {
            try {
              await loadEscrowTimeline(timelineEscrowId || selectedEscrow?.escrowId || "");
            } catch (err: any) {
              setError(err.message || "Timeline load failed");
            }
          }}
        >
          Load timeline
        </button>
        <div className="timeline-list">
          {timeline?.events.map((event) => (
            <div key={event.eventId} className="timeline-item">
              <div className="timeline-dot" />
              <div className="event-row">
                <div>
                  <strong>{event.eventType}</strong>
                  <span>{event.previousStatus || "-"} → {event.nextStatus || "-"} · {event.actorRole} · {event.channel}</span>
                  <span>{event.reason || event.actor}</span>
                </div>
                <time>{formatTime(event.createdAt)}</time>
              </div>
            </div>
          ))}
          {timeline && timeline.events.length === 0 && <p className="muted">No events recorded for this escrow</p>}
          {!timeline && <p className="muted">Load an escrow to inspect payment, release, dispute, and operator action history.</p>}
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Linked Records</h2>
          <span>{timeline?.transactions.length || 0} payments</span>
        </div>
        <div className="event-grid">
          {timeline?.transactions.map((transaction) => (
            <div key={transaction.transactionId} className={`event-row ops-event ${statusTone(transaction.status) === "critical" ? "error" : "warning"}`}>
              <div>
                <strong>{transaction.transactionType} · {transaction.status}</strong>
                <span>{transaction.provider} · {transaction.reference || "no reference"}</span>
                <span>{money.format(transaction.amount)} {transaction.currency}</span>
              </div>
              <time>{formatTime(transaction.updatedAt || transaction.createdAt)}</time>
            </div>
          ))}
          {timeline?.supportCases.map((supportCase) => (
            <div key={supportCase.caseId} className="event-row ops-event warning">
              <div>
                <strong>{supportCase.subject}</strong>
                <span>{supportCase.status} · {supportCase.priority} · assigned {supportCase.assignedTo || "unassigned"}</span>
              </div>
              <time>{formatTime(supportCase.updatedAt)}</time>
            </div>
          ))}
          {timeline && timeline.transactions.length === 0 && timeline.supportCases.length === 0 && <p className="muted">No linked transactions or support cases</p>}
        </div>
      </aside>
    </section>
  );
}
