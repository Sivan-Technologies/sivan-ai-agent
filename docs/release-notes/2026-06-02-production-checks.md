# Production Checks - 2026-06-02

## Scope

Backend Render service checks after the latest production-hardening work.

## Live Smoke Check

Command:

```bash
npm run smoke
```

Target:

```text
https://sivan-escrow-agent.onrender.com
```

Result: passed.

Checked surfaces:

- public health
- readiness
- admin database status
- disaster recovery status endpoint reachability
- operations status
- queue status and recent jobs
- recent webhooks
- reconciliation summary
- support cases
- abuse signals, analytics, and actions
- disputes
- recent operational events

## Deploy-Time Incident Drill

Command:

```bash
npm run drill:incident
```

Mode: read-only.

Result: passed.

Checked surfaces:

- queue status
- queue jobs
- webhook ledger
- reconciliation

## Disaster Recovery Check

Command:

```bash
npm run dr:check
```

Result: failed only on restore freshness.

Passing:

- public health
- readiness
- database status
- operations status
- backup configured
- rollback configured
- outage contacts configured

Open:

- `restoreFresh=false`
- `BACKUP_LAST_RESTORE_TEST_AT` is not recorded
- first Neon restore drill still needs a staging/restore database target

## GitHub Secrets

GitHub CLI could not update secrets from this machine because the saved GitHub token is invalid. Re-authenticate with:

```bash
gh auth login -h github.com
```

Then verify or set:

```bash
gh secret set SIVAN_SMOKE_BASE_URL --body "https://sivan-escrow-agent.onrender.com"
gh secret set SIVAN_SMOKE_ADMIN_API_KEY --body "<rotated-admin-key>"
gh variable set SIVAN_SMOKE_REQUIRE_SETTLEMENT_PROOF --body "false"
gh workflow run production-smoke.yml
```

## Restore Drill Blocker

The first live database restore drill was not completed in this run because no staging/restore database URL or Neon API credentials were configured locally.

Needed before marking restore proof complete:

- Neon restore branch/database created from production backup/PITR
- staging backend pointed at the restored database
- `npm run smoke` passing against staging
- `npm run dr:check` passing against staging
- production env updated with `BACKUP_LAST_RESTORE_TEST_AT=<ISO timestamp>` and `BACKUP_LAST_RESTORE_TEST_STATUS=passed`
