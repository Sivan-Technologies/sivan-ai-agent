# Changelog

## 2026-06-30

- Deployed production-grade Cloudflare R2 storage Client with secure 1-hour presigned HTTPS URL resolver.
- Implemented file validation layer restricting uploads to PDF, JPG, and MP4 under size caps (50MB video / 10MB document).
- Integrated anti-spoof evidence checks blocking duplicate URL submissions across escrows.
- Standardized dual-database test/live isolation for Postgres and sqlite lanes.

## 2026-05-23

- Renamed project and branding from `Hybrid Escrow Agent` to `Sivan Escrow Agent`.
- Updated package metadata, README Docker commands, and project labels.
- Added changelog entry for the Sivan rename.
