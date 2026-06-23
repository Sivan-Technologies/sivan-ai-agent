import { WebhookEvent } from "../types";
import { formatTime, compactId } from "../utils";

interface WebhooksTabProps {
  webhooks: WebhookEvent[];
}

export function WebhooksTab({ webhooks }: WebhooksTabProps) {
  return (
    <section className="surface">
      <div className="section-head">
        <h2>Webhook Ledger</h2>
        <span>{webhooks.length} events</span>
      </div>
      <div className="event-grid">
        {webhooks.map((event) => (
          <div key={event.eventId} className="event-row">
            <div>
              <strong>{event.eventType}</strong>
              <span>{compactId(event.paymentReference, 20)}</span>
            </div>
            <time>{formatTime(event.receivedAt)}</time>
          </div>
        ))}
        {webhooks.length === 0 && <p className="muted">No webhook events</p>}
      </div>
    </section>
  );
}
