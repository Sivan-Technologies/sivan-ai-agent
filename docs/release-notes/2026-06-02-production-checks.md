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

## Production Disaster Recovery Check

Command:

```bash
npm run dr:check
```

Result before restore proof was recorded: failed only on restore freshness.

Passing:

- public health
- readiness
- database status
- operations status
- backup configured
- rollback configured
- outage contacts configured

Previously open:

- `restoreFresh=false`
- `BACKUP_LAST_RESTORE_TEST_AT` is not recorded
- first Neon restore drill still needs a staging/restore database target

## Neon Restore Drill

Restore branch:

```text
sivan-restore-drill-2026-06-02
```

Restore test target:

```text
local backend pointed at the Neon restore branch
```

Result: passed.

Commands:

```bash
npm run serve
npm run smoke
npm run dr:check
```

Verified:

- backend booted with the restored Neon branch
- public health passed
- readiness passed
- admin database status passed
- disaster recovery status passed with `DR_REQUIRE_FRESH_RESTORE=false`
- operations status passed
- queue, webhook, reconciliation, support, abuse, disputes, and operational event surfaces passed

Production restore proof recorded locally:

```env
BACKUP_LAST_RESTORE_TEST_AT=2026-06-02T09:27:13Z
BACKUP_LAST_RESTORE_TEST_STATUS=passed
```

Render backend env must be updated with the same restore proof values, then production should be redeployed and `npm run dr:check` should be rerun until `restoreFresh=true`.

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

## Remaining Production Follow-Up

- Update Render backend env with the restore proof timestamp/status.
- Redeploy the Render backend.
- Run `npm run dr:check` against production and confirm `restoreFresh=true`.
- Re-authenticate GitHub CLI and verify GitHub Actions smoke secrets.
