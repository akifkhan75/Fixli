# Staging and releasing

## Staging = production with fake people

Staging must be built the same way as production, or it proves nothing:

| Part | Staging | Same as production? |
|---|---|---|
| API | the same Docker image (`apps/api/Dockerfile`), 2 instances | yes: so sockets across instances are tested |
| Postgres | the same major version (16), a separate database | yes |
| Redis | a real Redis | yes (multi-instance needs it) |
| Files | an S3 bucket of its own | yes (not the local disk driver) |
| Push | a real Expo project in `staging` | yes |
| Sentry | its own project, `SENTRY_ENVIRONMENT=staging` | |
| Data | seeded: `db:seed:catalog`, `seed:e2e` accounts | never real people's data |
| Phone app | EAS `preview` profile (`EXPO_PUBLIC_API_URL=https://staging-api.fixli.pk/api`) | |
| Staff portal | built with `VITE_API_URL` pointing at staging | |

Never run `seed:e2e` against production (it refuses when `NODE_ENV=production`).

## Releasing the API

1. Everything in `ci.yml` is green on the commit; `e2e-admin.yml` too.
2. Merge to `main`. The pipeline builds the image tagged with the commit and sets `APP_RELEASE=<commit>`.
3. Deploy to **staging**. Run `pnpm --filter @fixli/api load` against it (the load workflow does this) and `maestro test .maestro` on an emulator pointed at it.
4. Deploy to production, **one instance first** (migrations run on start; see migration-rollback.md). Watch `/api/health/ready` and Sentry for 10 minutes, then the rest.
5. **Roll back:** redeploy the previous image tag. Safe as long as migrations followed the expand rule.

## Releasing the staff portal and website

Static builds (`pnpm --filter admin build`, `pnpm --filter web build`). The website build also writes `/privacy.html`, `/terms.html`, `/delete-account.html` and the Urdu copies from `docs/legal/`: **these URLs must be live before the store listing is submitted** (Google Play requires the deletion page).

## Releasing the phone app

- **Version numbers:** `apps/mobile/app.json` `version` is the user-visible version. EAS raises the build number by itself (`appVersionSource: remote`, `autoIncrement: true`).
- **Build:** `eas build --platform all --profile production` (needs the Expo organisation account and the Firebase/Apple credentials, owner decision O14).
- **Secrets, never in the repo:** `eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value ...`. A test fails the build if a placeholder DSN is committed.
- **Over-the-air fixes** (JavaScript only, no new native code): `eas update --channel production`. The runtime version follows the app version, so an update only reaches phones with a compatible build. Anything that adds a native module (like the connectivity library in F7) needs a new store build.
- **Submit:** `eas submit`. Before the first submission, fill the store forms from [docs/store/data-safety.md](../store/data-safety.md) and add screenshots in English and Urdu.
- **Roll back an OTA update:** `eas update:rollback` (or publish the previous bundle on the channel). A bad store build cannot be recalled: ship a fixed build, and use the `preview` channel to test first.

## Release checklist

Doc 20 is the full list; the engineering part is: CI green, load test green, restore drill within 90 days, Sentry and uptime alerts live with named owners, legal pages live and reviewed, store forms filled from the real data flows, and the owner has signed off the open items in doc 25.
