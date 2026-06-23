import { EscrowRecord, EscrowFilter, PayoutApprovalQuote } from "../types";
import { money, compactId, statusTone, formatTime } from "../utils";

interface EscrowsTabProps {
  filteredEscrows: EscrowRecord[];
  escrows: EscrowRecord[];
  escrowFilter: EscrowFilter;
  setEscrowFilter: (filter: EscrowFilter) => void;
  downloadReconciliationCsv: () => Promise<void>;
  setError: (err: string | null) => void;
  selectedEscrow: EscrowRecord | null;
  setSelectedEscrow: (escrow: EscrowRecord | null) => void;
  selectedPayoutQuote: PayoutApprovalQuote | null;
  recheckEscrowPayment: (escrowId: string) => Promise<void>;
  loadEscrowTimeline: (escrowId: string) => Promise<void>;
  enqueuePayoutReview: (escrowId: string, reason: string) => Promise<void>;
  openPayoutApproval: (escrow: EscrowRecord, quote: PayoutApprovalQuote) => void;
  disputeEscrow: (escrowId: string) => Promise<void>;
}

export function EscrowsTab({
  filteredEscrows,
  escrows,
  escrowFilter,
  setEscrowFilter,
  downloadReconciliationCsv,
  setError,
  selectedEscrow,
  setSelectedEscrow,
  selectedPayoutQuote,
  recheckEscrowPayment,
  loadEscrowTimeline,
  enqueuePayoutReview,
  openPayoutApproval,
  disputeEscrow,
}: EscrowsTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Escrow Ledger</h2>
          <span>{filteredEscrows.length} of {escrows.length} records</span>
        </div>
        <div className="filter-bar">
          {([
            ["all", "All"],
            ["review", "Review required"],
            ["pendingRelease", "Pending release"],
            ["released", "Released"],
            ["missingPayout", "Missing payout ref"],
            ["amountMismatch", "Amount mismatch"],
          ] as [EscrowFilter, string][]).map(([value, label]) => (
            <button key={value} className={escrowFilter === value ? "active" : ""} onClick={() => setEscrowFilter(value)}>
              {label}
            </button>
          ))}
          <button
            className="export-button"
            onClick={async () => {
              try {
                await downloadReconciliationCsv();
              } catch (err: any) {
                setError(err.message || "CSV export failed");
              }
            }}
          >
            Export CSV
          </button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Escrow</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Received</th>
                <th>Release</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {filteredEscrows.map((escrow) => (
                <tr
                  key={escrow.escrowId}
                  className={selectedEscrow?.escrowId === escrow.escrowId ? "selected" : ""}
                  onClick={() => setSelectedEscrow(selectedEscrow?.escrowId === escrow.escrowId ? null : escrow)}
                >
                  <td>
                    <strong>{escrow.escrowId}</strong>
                    <small>{escrow.purpose}</small>
                  </td>
                  <td>{money.format(escrow.amount)} {escrow.currency}</td>
                  <td><span className={`status ${statusTone(escrow.status)}`}>{escrow.status}</span></td>
                  <td>{escrow.receivedAmount === undefined ? "pending" : `${money.format(escrow.receivedAmount)} ${escrow.currency}`}</td>
                  <td>{escrow.settlementPolicy}</td>
                  <td>{compactId(escrow.paymentReference, 16)}</td>
                </tr>
              ))}
              {filteredEscrows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">No escrows match this filter</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Escrow Actions</h2>
          <span>{selectedEscrow ? compactId(selectedEscrow.escrowId, 12) : "none"}</span>
        </div>
        {selectedEscrow ? (
          <div className="detail-stack">
            <div className="detail-row"><span>Status</span><strong>{selectedEscrow.status}</strong></div>
            <div className="detail-row"><span>Currency</span><strong>{selectedEscrow.currency}</strong></div>
            <div className="detail-row"><span>Policy</span><strong>{selectedEscrow.settlementPolicy}</strong></div>
            <div className="detail-row"><span>Escrow deadline</span><strong>{formatTime(selectedEscrow.fundingExpiresAt)}</strong></div>
            <div className="detail-row"><span>Active payment ref</span><strong>{selectedEscrow.paymentReference || "pending"}</strong></div>
            <div className="detail-row"><span>Instruction expires</span><strong>{formatTime(selectedEscrow.activePaymentExpiresAt)}</strong></div>
            <div className="detail-row"><span>Regenerated</span><strong>{selectedEscrow.paymentRegenerationCount ?? 0} times</strong></div>
            <div className="detail-row"><span>Last reminder</span><strong>{formatTime(selectedEscrow.lastPaymentReminderAt)}</strong></div>
            <div className="detail-row"><span>Expired refs</span><strong>{selectedEscrow.expiredPaymentReferences?.length ? selectedEscrow.expiredPaymentReferences.map((ref) => compactId(ref, 12)).join(", ") : "none"}</strong></div>
            <div className="detail-row"><span>Payment status</span><strong>{selectedEscrow.providerPaymentStatus || selectedEscrow.status}</strong></div>
            <div className="detail-row"><span>Expected amount</span><strong>{money.format(selectedEscrow.amount)} {selectedEscrow.currency}</strong></div>
            <div className="detail-row"><span>Received amount</span><strong>{selectedEscrow.receivedAmount === undefined ? "not verified" : `${money.format(selectedEscrow.receivedAmount)} ${selectedEscrow.currency}`}</strong></div>
            <div className="detail-row"><span>Platform fee</span><strong>{money.format(selectedPayoutQuote?.platformFeeAmount ?? 0)} {selectedEscrow.currency}</strong></div>
            <div className="detail-row"><span>Seller net payout</span><strong>{money.format(selectedPayoutQuote?.sellerNetAmount ?? selectedEscrow.amount)} {selectedEscrow.currency}</strong></div>
            <div className="detail-row"><span>Amount source</span><strong>{selectedPayoutQuote?.amountSource || "escrow_record"}</strong></div>
            <div className="detail-row"><span>Payment checked</span><strong>{formatTime(selectedEscrow.paymentCheckedAt)}</strong></div>
            <div className="detail-row"><span>Seller</span><strong>{selectedEscrow.sellerWhatsapp || selectedEscrow.sellerUserId || "pending"}</strong></div>
            <div className="detail-row"><span>Payout ref</span><strong>{selectedEscrow.manualPayoutReference || (selectedEscrow.status === "RELEASED" ? "MISSING REFERENCE" : "not released")}</strong></div>
            <div className="detail-row"><span>Payout notes</span><strong>{selectedEscrow.payoutNotes || "none"}</strong></div>
            <div className="detail-row"><span>Released by</span><strong>{selectedEscrow.releasedBy || "not released"}</strong></div>
            <div className="detail-row"><span>Released at</span><strong>{formatTime(selectedEscrow.releasedAt)}</strong></div>
            <div className="detail-row"><span>Dispute</span><strong>{selectedEscrow.status === "DISPUTED" ? "open" : "none"}</strong></div>
            {selectedEscrow.reconciliationFlags?.length ? (
              <div className="detail-note critical-note">
                {selectedEscrow.reconciliationFlags.join(", ")}
              </div>
            ) : null}
            <div className="detail-note">{selectedEscrow.purpose}</div>
            <button
              className="button secondary full"
              disabled={!selectedEscrow.paymentReference || selectedEscrow.paymentProvider !== "paystack"}
              onClick={async () => {
                try {
                  await recheckEscrowPayment(selectedEscrow.escrowId);
                } catch (err: any) {
                  setError(err.message || "Payment recheck failed");
                }
              }}
            >
              Re-check Paystack payment
            </button>
            <button
              className="button secondary full"
              onClick={async () => {
                try {
                  await loadEscrowTimeline(selectedEscrow.escrowId);
                } catch (err: any) {
                  setError(err.message || "Timeline load failed");
                }
              }}
            >
              Open event timeline
            </button>
            <button
              className="button secondary full"
              disabled={["RELEASED", "CANCELLED", "FAILED"].includes(selectedEscrow.status)}
              onClick={async () => {
                try {
                  await enqueuePayoutReview(selectedEscrow.escrowId, "operator_requested_from_escrow_detail");
                } catch (err: any) {
                  setError(err.message || "Payout review failed");
                }
              }}
            >
              Queue payout safety review
            </button>
            <button
              className="button primary full"
              disabled={selectedEscrow.status !== "PENDING_RELEASE"}
              onClick={() => {
                if (selectedPayoutQuote) {
                  openPayoutApproval(selectedEscrow, selectedPayoutQuote);
                }
              }}
            >
              Approve Naira release
            </button>
            <button
              className="button secondary full"
              disabled={["RELEASED", "CANCELLED"].includes(selectedEscrow.status)}
              onClick={async () => {
                try {
                  await disputeEscrow(selectedEscrow.escrowId);
                } catch (err: any) {
                  setError(err.message || "Dispute failed");
                }
              }}
            >
              Mark disputed
            </button>
          </div>
        ) : (
          <p className="muted">Select an escrow row.</p>
        )}
      </aside>
    </section>
  );
}
