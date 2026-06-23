import { DisputeRow, EscrowRecord } from "../types";
import { money, formatTime, statusTone } from "../utils";

interface DisputesTabProps {
  disputes: DisputeRow[];
  selectedDispute: DisputeRow | null;
  setSelectedDispute: (dispute: DisputeRow | null) => void;
  setSelectedEscrow: (escrow: EscrowRecord | null) => void;
  setTimelineEscrowId: (id: string) => void;
  evidenceDraft: { evidenceType: string; source: string; summary: string; uri: string };
  setEvidenceDraft: (draft: { evidenceType: string; source: string; summary: string; uri: string }) => void;
  resolutionDraft: { outcome: string; reason: string; reference: string };
  setResolutionDraft: (draft: { outcome: string; reason: string; reference: string }) => void;
  actionBusy: boolean;
  setActionBusy: (busy: boolean) => void;
  recordDisputeEvidence: () => Promise<void>;
  resolveDispute: () => Promise<void>;
  loadEscrowTimeline: (escrowId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export function DisputesTab({
  disputes,
  selectedDispute,
  setSelectedDispute,
  setSelectedEscrow,
  setTimelineEscrowId,
  evidenceDraft,
  setEvidenceDraft,
  resolutionDraft,
  setResolutionDraft,
  actionBusy,
  setActionBusy,
  recordDisputeEvidence,
  resolveDispute,
  loadEscrowTimeline,
  setError,
}: DisputesTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Dispute Desk</h2>
          <span>{disputes.length} open</span>
        </div>
        <div className="event-grid">
          {disputes.map((row) => (
            <button
              key={row.escrow.escrowId}
              className={`event-row selectable-row ops-event error ${selectedDispute?.escrow.escrowId === row.escrow.escrowId ? "selected" : ""}`}
              onClick={() => {
                setSelectedDispute(row);
                setSelectedEscrow(row.escrow);
                setTimelineEscrowId(row.escrow.escrowId);
              }}
            >
              <div>
                <strong>{row.escrow.escrowId} · {money.format(row.escrow.amount)} {row.escrow.currency}</strong>
                <span>{row.escrow.purpose}</span>
                <span>{row.evidenceCount} evidence records · {row.supportCases.length} support cases</span>
              </div>
              <time>{formatTime(row.openedAt)}</time>
            </button>
          ))}
          {disputes.length === 0 && <p className="muted">No open disputes</p>}
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Manual Resolution</h2>
          <span>{selectedDispute ? selectedDispute.escrow.escrowId : "none"}</span>
        </div>
        {selectedDispute ? (
          <div className="detail-stack">
            <div className="detail-row"><span>Status</span><strong>{selectedDispute.escrow.status}</strong></div>
            <div className="detail-row"><span>Payment reference</span><strong>{selectedDispute.escrow.paymentReference || "none"}</strong></div>
            <div className="detail-row"><span>Received</span><strong>{selectedDispute.escrow.receivedAmount === undefined ? "not verified" : `${money.format(selectedDispute.escrow.receivedAmount)} ${selectedDispute.escrow.currency}`}</strong></div>
            <div className="detail-row"><span>Latest event</span><strong>{formatTime(selectedDispute.latestEventAt)}</strong></div>

            <div className="section-head ops-subhead">
              <h2>Evidence Capture</h2>
              <span>{selectedDispute.evidenceCount} records</span>
            </div>
            <div className="control-grid">
              <label className="field">
                <span>Type</span>
                <select value={evidenceDraft.evidenceType} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, evidenceType: event.target.value })}>
                  <option value="message">Message</option>
                  <option value="payment_proof">Payment proof</option>
                  <option value="delivery_proof">Delivery proof</option>
                  <option value="identity">Identity</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="field">
                <span>Source</span>
                <select value={evidenceDraft.source} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, source: event.target.value })}>
                  <option value="buyer">Buyer</option>
                  <option value="seller">Seller</option>
                  <option value="admin">Admin</option>
                  <option value="support">Support</option>
                  <option value="payment_provider">Payment provider</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Evidence summary</span>
              <textarea rows={4} value={evidenceDraft.summary} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, summary: event.target.value })} />
            </label>
            <label className="field">
              <span>Evidence URL</span>
              <input type="url" value={evidenceDraft.uri} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, uri: event.target.value })} placeholder="https://..." autoComplete="url" />
            </label>
            <button
              className="button secondary full"
              disabled={!evidenceDraft.summary.trim() || actionBusy}
              onClick={async () => {
                setActionBusy(true);
                try {
                  await recordDisputeEvidence();
                } catch (err: any) {
                  setError(err.message || "Evidence capture failed");
                } finally {
                  setActionBusy(false);
                }
              }}
            >
              Record evidence
            </button>

            <div className="section-head ops-subhead">
              <h2>Resolution Outcome</h2>
              <span>manual</span>
            </div>
            <label className="field">
              <span>Outcome</span>
              <select value={resolutionDraft.outcome} onChange={(event) => setResolutionDraft({ ...resolutionDraft, outcome: event.target.value })}>
                <option value="release_to_seller">Release to seller</option>
                <option value="refund_buyer">Refund buyer</option>
                <option value="cancel_no_funds">Cancel, no funds received</option>
                <option value="no_action_close">Close with no action</option>
              </select>
            </label>
            <label className="field">
              <span>Reference</span>
              <input value={resolutionDraft.reference} onChange={(event) => setResolutionDraft({ ...resolutionDraft, reference: event.target.value })} placeholder="Payout/refund/reference ID" autoComplete="off" />
            </label>
            <label className="field">
              <span>Resolution reason</span>
              <textarea rows={4} value={resolutionDraft.reason} onChange={(event) => setResolutionDraft({ ...resolutionDraft, reason: event.target.value })} />
            </label>
            <button
              className="button primary full"
              disabled={!resolutionDraft.reason.trim() || actionBusy}
              onClick={async () => {
                setActionBusy(true);
                try {
                  await resolveDispute();
                } catch (err: any) {
                  setError(err.message || "Dispute resolution failed");
                } finally {
                  setActionBusy(false);
                }
              }}
            >
              Record manual resolution
            </button>
            <button className="button secondary full" onClick={() => loadEscrowTimeline(selectedDispute.escrow.escrowId)}>
              Open full timeline
            </button>
          </div>
        ) : (
          <p className="muted">Select a dispute to capture evidence or record the manual outcome.</p>
        )}
      </aside>
    </section>
  );
}
