import { useMemo } from "react";
import { ReconciliationRow, ReconciliationSummary, QueueJob, EscrowRecord } from "../types";
import { money, formatTime, statusTone } from "../utils";

interface PayoutTabProps {
  payoutSafetyRows: ReconciliationRow[];
  reconciliationSummary: ReconciliationSummary;
  queueJobs: QueueJob[];
  escrows: EscrowRecord[];
  actionBusy: boolean;
  setActionBusy: (busy: boolean) => void;
  enqueuePayoutReview: (escrowId: string, reason: string) => Promise<void>;
  openPayoutApproval: (escrow: EscrowRecord, quote: { sellerNetAmount: number; platformFeeAmount: number; grossAmount: number; amountSource: string; currency: "NAIRA" | "USDC" }) => void;
  runQueueWorker: () => Promise<void>;
  retryQueueJob: (jobId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export function PayoutTab({
  payoutSafetyRows,
  reconciliationSummary,
  queueJobs,
  escrows,
  actionBusy,
  setActionBusy,
  enqueuePayoutReview,
  openPayoutApproval,
  runQueueWorker,
  retryQueueJob,
  setError,
}: PayoutTabProps) {
  const deadOrFailedJobs = useMemo(() => queueJobs.filter((job) => job.status === "failed" || job.status === "dead"), [queueJobs]);

  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Payout Safety Queue</h2>
          <span>{payoutSafetyRows.length} records</span>
        </div>
        <div className="metrics-grid ops-metrics">
          <div className="metric-card watch"><span>Awaiting payout</span><strong>{reconciliationSummary.releasesAwaitingPayout}</strong></div>
          <div className="metric-card critical"><span>Missing refs</span><strong>{reconciliationSummary.releasedMissingPayoutReference}</strong></div>
          <div className="metric-card critical"><span>Amount mismatch</span><strong>{reconciliationSummary.paystackAmountMismatches}</strong></div>
          <div className="metric-card watch"><span>Review jobs</span><strong>{queueJobs.filter((job) => job.jobType === "payout_review" && !["succeeded", "dead"].includes(job.status)).length}</strong></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Escrow</th>
                <th>Status</th>
                <th>Seller</th>
                <th>Payout account</th>
                <th>Gross</th>
                <th>Fee</th>
                <th>Seller net</th>
                <th>Risk</th>
                <th>Payout ref</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {payoutSafetyRows.map((row) => (
                <tr key={row.escrowId}>
                  <td><strong>{row.escrowId}</strong><small>{row.purpose}</small></td>
                  <td><span className={`status ${statusTone(row.status)}`}>{row.status}</span></td>
                  <td><strong>{row.sellerName || row.seller}</strong><small>{row.seller}</small></td>
                  <td>
                    <strong>{row.payoutBankName || "not set"} {row.payoutAccountNumber || ""}</strong>
                    <small>{row.resolvedAccountName || "name not resolved"}{row.nameMatchLevel ? ` · ${row.nameMatchLevel}` : ""}</small>
                  </td>
                  <td>{money.format(row.grossAmount ?? row.expectedAmount)} {row.currency}</td>
                  <td>{money.format(row.platformFeeAmount ?? 0)} {row.currency}</td>
                  <td><strong>{money.format(row.sellerNetAmount ?? row.expectedAmount)} {row.currency}</strong></td>
                  <td>
                    <span className={`status ${statusTone(row.riskLevel || "LOW")}`}>{row.riskLevel || "LOW"}</span>
                    <small>
                      compliance {row.complianceRiskScore ?? 0}
                      {row.reconciliationRiskLevel ? ` · recon ${row.reconciliationRiskLevel}` : ""}
                    </small>
                  </td>
                  <td>{row.payoutReference || "missing"}</td>
                  <td>
                    <button
                      className="button small"
                      disabled={actionBusy}
                      onClick={async () => {
                        try {
                          if (row.status === "PENDING_RELEASE") {
                            const escrow = escrows.find((item) => item.escrowId === row.escrowId);
                            if (!escrow) throw new Error("Open the escrow ledger once before approving payout.");
                            openPayoutApproval(escrow, {
                              grossAmount: row.grossAmount ?? row.expectedAmount,
                              platformFeeAmount: row.platformFeeAmount ?? 0,
                              sellerNetAmount: row.sellerNetAmount ?? row.expectedAmount,
                              amountSource: row.amountSource || "escrow_record",
                              currency: row.currency,
                            });
                            return;
                          }
                          setActionBusy(true);
                          await enqueuePayoutReview(row.escrowId, "operator_requested_from_payout_safety");
                        } catch (err: any) {
                          setError(err.message || "Payout action failed");
                        } finally {
                          setActionBusy(false);
                        }
                      }}
                    >
                      {row.status === "PENDING_RELEASE" ? "Approve payout" : "Review"}
                    </button>
                  </td>
                </tr>
              ))}
              {payoutSafetyRows.length === 0 && <tr><td colSpan={10} className="empty-cell">No payout exceptions</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Recovery Jobs</h2>
          <span>{deadOrFailedJobs.length} failed/dead</span>
        </div>
        <button
          className="button primary full"
          onClick={async () => {
            try {
              await runQueueWorker();
            } catch (err: any) {
              setError(err.message || "Queue run failed");
            }
          }}
        >
          Run retry worker
        </button>
        <div className="event-grid ops-subhead">
          {deadOrFailedJobs.map((job) => (
            <div key={job.jobId} className={`event-row ops-event ${job.status === "dead" ? "error" : "warning"}`}>
              <div>
                <strong>{job.jobType} · {job.status}</strong>
                <span>{job.lastError || job.payload}</span>
                <span>{job.attempts}/{job.maxAttempts} attempts · next {formatTime(job.runAfter)}</span>
              </div>
              <button className="button small" onClick={() => retryQueueJob(job.jobId)}>Retry</button>
            </div>
          ))}
          {deadOrFailedJobs.length === 0 && <p className="muted">No failed queue jobs</p>}
        </div>
      </aside>
    </section>
  );
}
