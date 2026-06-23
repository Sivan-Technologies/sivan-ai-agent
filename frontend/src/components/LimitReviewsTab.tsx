import { EscrowLimitReview } from "../types";
import { money, compactId, formatTime } from "../utils";

interface LimitReviewsTabProps {
  limitReviews: EscrowLimitReview[];
  selectedLimitReview: EscrowLimitReview | null;
  setSelectedLimitReview: (review: EscrowLimitReview | null) => void;
  limitReviewNotes: string;
  setLimitReviewNotes: (notes: string) => void;
  actionBusy: boolean;
  decideLimitReview: (decision: "approve" | "reject") => Promise<void>;
}

export function LimitReviewsTab({
  limitReviews,
  selectedLimitReview,
  setSelectedLimitReview,
  limitReviewNotes,
  setLimitReviewNotes,
  actionBusy,
  decideLimitReview,
}: LimitReviewsTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Escrow Limit Reviews</h2>
          <span>{limitReviews.filter((review) => review.status === "pending").length} pending</span>
        </div>
        <div className="event-grid">
          {limitReviews.map((review) => (
            <button
              key={review.reviewId}
              className={`event-row selectable-row ops-event ${review.status === "pending" ? "warning" : review.status === "rejected" ? "error" : "success"} ${selectedLimitReview?.reviewId === review.reviewId ? "selected" : ""}`}
              onClick={() => {
                setSelectedLimitReview(review);
                setLimitReviewNotes("");
              }}
            >
              <div>
                <strong>{review.currency} {money.format(review.amount)} · {review.policy.tier || "unknown"} buyer</strong>
                <span>{review.reasonCode} · {review.status}</span>
                <span>{review.buyerWhatsapp} · {review.purpose}</span>
              </div>
              <time>{formatTime(review.createdAt)}</time>
            </button>
          ))}
          {limitReviews.length === 0 && <p className="muted">No escrow limit reviews</p>}
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Review Decision</h2>
          <span>{selectedLimitReview ? compactId(selectedLimitReview.reviewId, 16) : "none"}</span>
        </div>
        {selectedLimitReview ? (
          <div className="detail-stack">
            <div className="detail-row"><span>Status</span><strong>{selectedLimitReview.status}</strong></div>
            <div className="detail-row"><span>Reason</span><strong>{selectedLimitReview.reasonCode}</strong></div>
            <div className="detail-row"><span>Buyer</span><strong>{selectedLimitReview.buyerWhatsapp}</strong></div>
            <div className="detail-row"><span>Seller</span><strong>{selectedLimitReview.sellerWhatsapp || "not set"}</strong></div>
            <div className="detail-row"><span>Requested amount</span><strong>{selectedLimitReview.currency} {money.format(selectedLimitReview.amount)}</strong></div>
            <div className="detail-row"><span>Buyer tier</span><strong>{selectedLimitReview.policy.tier || "unknown"} · {selectedLimitReview.policy.successfulEscrows || 0} successful</strong></div>
            <div className="detail-row"><span>Tier limit</span><strong>NGN {money.format(selectedLimitReview.policy.tierLimit || 0)}</strong></div>
            <div className="detail-row"><span>Buyer active exposure</span><strong>NGN {money.format(selectedLimitReview.policy.buyerActiveExposure || 0)} / {money.format(selectedLimitReview.policy.buyerActiveExposureLimit || 0)}</strong></div>
            <div className="detail-row"><span>Platform active exposure</span><strong>NGN {money.format(selectedLimitReview.policy.platformActiveExposure || 0)} / {money.format(selectedLimitReview.policy.platformActiveExposureLimit || 0)}</strong></div>
            <div className="detail-row"><span>Purpose</span><strong>{selectedLimitReview.purpose}</strong></div>
            {selectedLimitReview.approvedEscrowId && <div className="detail-row"><span>Created escrow</span><strong>{selectedLimitReview.approvedEscrowId}</strong></div>}
            {selectedLimitReview.decisionNotes && <div className="detail-row"><span>Decision</span><strong>{selectedLimitReview.decisionNotes}</strong></div>}
            {selectedLimitReview.status === "pending" && (
              <>
                <label className="field">
                  <span>Required operator decision notes</span>
                  <textarea rows={4} value={limitReviewNotes} onChange={(event) => setLimitReviewNotes(event.target.value)} placeholder="Record why this one-time override is approved or rejected." />
                </label>
                <div className="control-grid">
                  <button className="button primary" disabled={actionBusy || !limitReviewNotes.trim()} onClick={() => decideLimitReview("approve")}>
                    Approve and create
                  </button>
                  <button className="button danger" disabled={actionBusy || !limitReviewNotes.trim()} onClick={() => decideLimitReview("reject")}>
                    Reject request
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="muted">Select a review to inspect its recorded policy snapshot.</p>
        )}
      </aside>
    </section>
  );
}
