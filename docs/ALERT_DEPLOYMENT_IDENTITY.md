# Operational alert deployment identity

Telegram alerts, webhook event bodies, operational warning logs and Sentry operational events now carry deployment labels and a shared event ID. This identifies the emitting process; it does not fix a provider quota.

## Configure each deployment separately

| Variable | Render staging | AWS production | Local development |
| --- | --- | --- | --- |
| DEPLOYMENT_ENVIRONMENT | staging | production | development |
| HOSTING_PROVIDER | render | aws | local |
| DEPLOYMENT_INSTANCE_ID | optional Render metadata fallback | unique instance/process label | local-dev |
| DEPLOYMENT_RELEASE | deployed Git commit | deployed Git commit | local |
| OPS_DATABASE_LABEL | neon-staging if verified | local-postgres if verified | local-test |

Set labels in the actual service environment, not only a local snapshot. Render can provide RENDER_INSTANCE_ID or RENDER_SERVICE_ID and RENDER_GIT_COMMIT automatically. The service-ID fallback identifies the service, not an individual replica. AWS labels must be explicitly supplied; this code never queries instance metadata or infers AWS from production mode.

Use only short letters, digits, dots, underscores and hyphens for labels. Never place connection strings, credentials, personal data or private keys in these variables. Database labels are operator-supplied descriptions, not provider detection. Missing or invalid labels display unknown.

## Rollout

1. Deploy to staging first and configure its labels.
2. Confirm a staging operational event shows the correct host, instance and release. Do not trigger payment failures as a test.
3. Keep production and staging Telegram destinations separate where possible.
4. Schedule a separately approved production deployment and process reload with its labels. Updating a file alone does not update a running process.
5. Compare event IDs across Telegram, logs and Sentry. Warning/error operational events have deployment tags; this does not relabel all unrelated Sentry events or all application logs.

Local/development external operational alerts are disabled by default. Set ENABLE_LOCAL_OPS_ALERTS=true only for an intentional diagnostic session using a test destination. DISABLE_OPS_ALERTS=true and test-runner suppression still override that opt-in. A locally running production-mode process must explicitly set HOSTING_PROVIDER=local; production mode alone cannot reveal where it runs.

Existing alerts omit this metadata until the emitting deployment is updated. No AWS or Render settings were changed by this implementation. Rotate the previously identified exposed alert bot credential separately; no credentials belong in this guide.
