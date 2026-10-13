-- Apply explicitly to the escrow PostgreSQL database before enabling this module.
-- No migration is executed by application startup.
CREATE TABLE ngn_agreement_event_inbox (
 id text PRIMARY KEY, digest text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ngn_agreement_projection (
 id text PRIMARY KEY, sequence bigint NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE ngn_agreement_notifications (
 id text PRIMARY KEY, agreement_id text NOT NULL, sequence bigint NOT NULL,
 channel text NOT NULL CHECK(channel IN ('whatsapp','telegram')), payload jsonb NOT NULL,
 delivered_at timestamptz, skipped_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 lease_token text, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error_code text
);
CREATE INDEX ngn_agreement_notifications_due ON ngn_agreement_notifications(next_attempt_at)
 WHERE delivered_at IS NULL;
