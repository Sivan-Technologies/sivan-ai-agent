# Deploy-Time Incident Drills

Run these after deploys and before high-volume traffic. Drills are read-only by default. Set `DRILL_EXECUTE=true` only when you intentionally want to enqueue a recovery job.

## Read-Only Drill

```bash
DRILL_BASE_URL=https://sivan-escrow-agent.onrender.com \
DRILL_ADMIN_API_KEY=$ADMIN_API_KEY \
npm run drill:incident
```

This checks:

- queue status and recent jobs
- webhook ledger reachability
- reconciliation surface for payout exceptions

## Queue Replay Drill

```bash
DRILL_MODE=queue \
DRILL_BASE_URL=https://sivan-escrow-agent.onrender.com \
DRILL_ADMIN_API_KEY=$ADMIN_API_KEY \
npm run drill:incident
```

To process a small batch:

```bash
DRILL_MODE=queue DRILL_EXECUTE=true DRILL_ADMIN_API_KEY=$ADMIN_API_KEY npm run drill:incident
```

## Webhook Recovery Drill

Use only with a real payment reference that is safe to re-check.

```bash
DRILL_MODE=webhook \
DRILL_EXECUTE=true \
DRILL_PAYMENT_REFERENCE=paystack-reference \
DRILL_ADMIN_API_KEY=$ADMIN_API_KEY \
npm run drill:incident
```

## Payout Failure Drill

Use only with an escrow that should enter manual payout review.

```bash
DRILL_MODE=payout \
DRILL_EXECUTE=true \
DRILL_ESCROW_ID=SIV-... \
DRILL_ADMIN_API_KEY=$ADMIN_API_KEY \
npm run drill:incident
```

## Pass Criteria

- all read-only checks return `PASS`
- queue worker can run without dead-letter growth
- webhook recovery can be enqueued for a known reference
- payout review can be enqueued for a known escrow
- admin Ops, Payout Safety, Risk, Audit, Support, and Disputes tabs load after deploy
