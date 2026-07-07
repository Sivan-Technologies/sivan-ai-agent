# Changelog

## 2026-07-06

- Implemented interactive sandbox payment simulation page `/sandbox-pay` to facilitate full end-to-end testing of Naira checkout flows without real gateway charges.
- Fixed duplicate WhatsApp notification loops that were exhausting daily Twilio message limits on status checks.
- Enabled real Cloudflare R2 uploads for the test environment when credentials are configured, fixing the delivery proof image forwarding issue.
- Standardized missing `NOTIFICATION_URL` environment variables in `render.yaml` for both test and live environments.

## 2026-06-30

- Deployed production-grade Cloudflare R2 storage Client with secure 1-hour presigned HTTPS URL resolver.
- Implemented file validation layer restricting uploads to PDF, JPG, and MP4 under size caps (50MB video / 10MB document).
- Integrated anti-spoof evidence checks blocking duplicate URL submissions across escrows.
- Standardized dual-database test/live isolation for Postgres and sqlite lanes.

## 2026-05-23

- Renamed project and branding from `Hybrid Escrow Agent` to `Sivan Escrow Agent`.
- Updated package metadata, README Docker commands, and project labels.
- Added changelog entry for the Sivan rename.
