# Backup and Disaster Recovery Runbook

This runbook defines the minimum production process for recovering Sivan after data loss, failed deploys, provider outages, or database incidents.

## Production Targets

| Target | MVP requirement |
| --- | --- |
| Recovery point objective | Restore to the latest managed Postgres backup available from the provider |
| Recovery time objective | Restore service within 60 minutes for backend-only incidents and 120 minutes for database restore incidents |
| Backup retention | At least 7 days for MVP, 30 days before higher-volume production |
| Restore drill cadence | At least every 30 days and after major schema changes |
| Rollback proof | Every production release should record the deploy SHA, smoke result, incident drill result, and DR check result |

## Recommended Backup Provider

Use Neon Postgres point-in-time restore as the primary MVP backup when production `DATABASE_URL` points at Neon. Sivan can still run the backend on Render, but the database recovery plan must follow the actual database provider, not the app host.

Recommended layers:

| Layer | Use now? | Purpose |
| --- | --- | --- |
| Neon point-in-time restore | ✅ Primary | Fastest recovery path for accidental deletes, bad deploys, corrupt writes, or data-loss incidents |
| Neon logical export/direct branch restore | ✅ Manual before major migrations | Portable restore artifact and isolated restore target before risky schema/data operations |
| S3 scheduled `pg_dump` export | 🟡 Add before higher volume | Longer retention and provider-independent backup copy |
| SQLite file backup | ❌ Production no | Local development only; not acceptable for real-money escrow recovery |

Production minimum:

1. Use a Neon plan with point-in-time restore/backup retention that matches the money risk.
2. Keep `BACKUP_PROVIDER=neon-postgres-pitr`.
3. Set `BACKUP_RETENTION_DAYS` to the actual Neon restore window for the project.
4. Run one staging restore drill before launch, then every 30 days.
5. Add S3 scheduled exports once escrow volume grows or if regulatory/audit retention must exceed the Neon restore window.

## Required Environment

Set these in Render or the production secret manager:

```env
BACKUP_PROVIDER=neon-postgres-pitr
BACKUP_RETENTION_DAYS=7
BACKUP_POLICY_URL=
BACKUP_RESTORE_RUNBOOK_URL=docs/disaster-recovery.md
BACKUP_RESTORE_TEST_MAX_AGE_DAYS=30
BACKUP_LAST_RESTORE_TEST_AT=
BACKUP_LAST_RESTORE_TEST_STATUS=not_recorded
ROLLBACK_RELEASE_URL=
OUTAGE_STATUS_PAGE_URL=
OUTAGE_CONTACTS=
DR_BASE_URL=https://sivan-escrow-agent.onrender.com
DR_ADMIN_API_KEY=
DR_REQUIRE_FRESH_RESTORE=true
```

Never store database URLs, Paystack keys, Twilio secrets, or admin secrets in release notes.

## Post-Deploy DR Check

Run this after every Render backend deploy:

```bash
DR_BASE_URL=https://sivan-escrow-agent.onrender.com DR_ADMIN_API_KEY=$ADMIN_API_KEY npm run dr:check
```

Expected result:

- public health passes
- readiness passes
- database status passes
- operations status passes
- disaster recovery status passes

If DR status fails because no restore drill is fresh, the deployment can remain live only if the release notes explicitly call out the exception and a restore drill is scheduled.

## Database Backup Procedure

1. Confirm `DATABASE_PROVIDER=postgres` in production.
2. Confirm the database is a Neon Postgres project with point-in-time restore or equivalent restore capability enabled.
3. Confirm `BACKUP_RETENTION_DAYS` matches the provider setting.
4. Confirm backup metadata is visible in the provider dashboard before promotion.
5. Record the backup policy link or internal note location in `BACKUP_POLICY_URL`.

SQLite is acceptable only for local development. It is not a production disaster-recovery plan.

## Neon Setup Checklist

In the Neon dashboard:

1. Open the production Postgres database.
2. Confirm the project plan and branch retention support the target restore window.
3. Open the restore/recovery controls and confirm point-in-time restore is available.
4. Record the visible recovery window in `BACKUP_RETENTION_DAYS`.
5. Create a manual logical export or branch restore target before major schema changes or payment-state migrations.
6. For a restore drill, restore to a new database instance, never over production.

In the backend service:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=<neon-pooled-connection-url-for-runtime>
POSTGRES_DATABASE_URL=<neon-pooled-connection-url-for-runtime>
POSTGRES_SSL=true
BACKUP_PROVIDER=neon-postgres-pitr
BACKUP_RETENTION_DAYS=<actual-neon-restore-window-days>
BACKUP_POLICY_URL=<private-neon-recovery-note-or-dashboard-link>
BACKUP_RESTORE_RUNBOOK_URL=docs/disaster-recovery.md
BACKUP_RESTORE_TEST_MAX_AGE_DAYS=30
ROLLBACK_RELEASE_URL=<render-service-deploys-or-runbook-url>
OUTAGE_CONTACTS=<operator-contact-list>
DR_BASE_URL=https://sivan-escrow-agent.onrender.com
DR_ADMIN_API_KEY=<rotated-admin-api-key>
DR_REQUIRE_FRESH_RESTORE=true
```

## Restore Testing Procedure

Use a staging database or temporary restore target. Do not restore over production during a drill.

1. Create a provider backup or select the latest automated backup.
2. Restore it into a staging database.
3. Point a staging backend at the restored database.
4. Run:

```bash
SMOKE_BASE_URL=$STAGING_API_BASE_URL SMOKE_ADMIN_API_KEY=$STAGING_ADMIN_API_KEY npm run smoke
DR_BASE_URL=$STAGING_API_BASE_URL DR_ADMIN_API_KEY=$STAGING_ADMIN_API_KEY npm run dr:check
```

5. Verify representative records:
   - escrow ledger loads
   - reconciliation rows load
   - support cases load
   - dispute history loads
   - queue jobs load
   - audit history loads
6. Update production env after the drill:
   - `BACKUP_LAST_RESTORE_TEST_AT=<ISO timestamp>`
   - `BACKUP_LAST_RESTORE_TEST_STATUS=passed`
7. Store the command output in release notes or the incident drill log.

## Rollback Procedure

Backend rollback:

1. Identify the last healthy commit SHA and deploy ID.
2. Roll back the Render service to the last healthy deploy or redeploy the last healthy SHA.
3. Run:

```bash
SMOKE_BASE_URL=https://sivan-escrow-agent.onrender.com SMOKE_ADMIN_API_KEY=$ADMIN_API_KEY npm run smoke
DR_BASE_URL=https://sivan-escrow-agent.onrender.com DR_ADMIN_API_KEY=$ADMIN_API_KEY npm run dr:check
npm run drill:incident
```

Frontend rollback:

1. Promote the last healthy Vercel deployment.
2. Confirm `VITE_API_BASE_URL` and `VITE_ADMIN_AUTH_BASE_URL` still point at production.
3. Log into the admin portal and verify Escrows, Disputes, Support, Payout Safety, Risk, Audit, and Ops tabs.

Bot rollback:

1. Roll back the WhatsApp bot deploy to the last healthy version.
2. Send a controlled WhatsApp test message.
3. Confirm inbound webhook logs and outbound notifications.

## Outage Procedure

1. Classify the incident:
   - backend unavailable
   - database unavailable
   - Paystack unavailable
   - Twilio unavailable
   - Telegram admin auth unavailable
   - frontend unavailable
2. Freeze risky money movement:
   - pause manual payout approvals when payment state is unclear
   - do not run autonomous payout retries
   - keep disputes and support notes active
3. Check admin Ops:
   - database
   - queue failures
   - stuck escrows
   - webhook failures
   - payout review jobs
4. Notify operators through `OUTAGE_CONTACTS`.
5. Update the status page or user-facing support channel if the outage is user visible.
6. Recover in this order:
   - database
   - backend
   - payment webhooks
   - queue worker
   - WhatsApp bot
   - admin frontend
7. Run smoke, incident drill, and DR check before declaring recovery complete.

## Release Notes Template

```text
Release:
Commit:
Backend deploy:
Frontend deploy:
Bot deploy:
Smoke check: passed/failed + timestamp
Incident drill: passed/failed + timestamp
DR check: passed/failed + timestamp
Restore drill freshness: fresh/stale + last test timestamp
Rollback target verified: yes/no
Known exceptions:
Operator:
```
