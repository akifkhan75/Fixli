# Operations (doc 27 F8.2)

How Fixli is run once it is live. Short, tested where it can be, and honest about what is not set up yet.

| Page | Use it when |
|---|---|
| [monitoring-and-alerts.md](monitoring-and-alerts.md) | something is slow or broken, and for what to watch |
| [backups-and-restore.md](backups-and-restore.md) | setting up backups, or practising a restore (a script does it) |
| [migration-rollback.md](migration-rollback.md) | a database change goes wrong |
| [staging-and-releasing.md](staging-and-releasing.md) | shipping the API, the portal, or a phone-app build |

## Status: what exists in the code vs. what must be set up by a person

| Piece | In the repo | Still to do (needs accounts / servers) |
|---|---|---|
| Health checks | `/api/health` (alive), `/api/health/ready` (database, Redis, background jobs; socket count with the ops token) | point the uptime monitor and load balancer at them |
| Crash reports | Sentry in API and app, personal data removed, release tag | create the Sentry projects; set `SENTRY_DSN` (API) and the EAS secret `EXPO_PUBLIC_SENTRY_DSN` (app) |
| Alerts | rules written down below | create them in the monitoring tool |
| Backups | restore drill script, proven on a copy | turn on automated backups at the database host; schedule the drill |
| Staging | checklist and config | create the environment |
| Load test | `pnpm --filter @fixli/api load`, weekly workflow | run it against staging before launch |
| Phone/browser tests | Playwright runs in CI; Maestro flows written | first Maestro run on an emulator |

## Settings that matter in production (see `.env.example` for all)

`NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL` (required for more than one API instance), `JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, `STORAGE_DRIVER=s3` and the S3 settings, `SENTRY_DSN`, `APP_RELEASE`, `OPS_TOKEN`, `ADMIN_TOTP_REQUIRED=true`, and `RUN_BACKGROUND_JOBS=true` on at least one instance (the jobs take turns through a database lease, so more than one is fine).
