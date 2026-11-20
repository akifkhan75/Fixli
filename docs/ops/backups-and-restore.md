# Backups and the restore drill

A backup nobody has restored is a hope, not a backup.

## What to back up

| What | How | Keep |
|---|---|---|
| **Postgres** (everything: accounts, jobs, money, audit) | automated daily snapshot plus continuous log shipping (point-in-time recovery) at the database host | 14 days of point-in-time, 30 daily snapshots [owner to confirm; counsel for the legal minimum, D-F4] |
| **Files** (ID photos, job photos, chat photos, voice notes) in the S3 bucket | bucket versioning on; a lifecycle rule keeps deleted versions 30 days; cross-region copy if the host offers it | same |
| **Secrets** (`JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, ...) | in the secret manager, with a sealed printed copy of `TOTP_ENCRYPTION_KEY` held by two people | forever. **Losing `TOTP_ENCRYPTION_KEY` means every staff member must set up their authenticator again.** |

Not backed up and not needed: Redis (rate-limit counters and live-event fan-out; it refills itself).

When someone deletes their account, their files are erased from the bucket straight away but old **versions and backups** keep them until they age out. The Privacy Policy says backups are overwritten within [N] days: set the retention above to match.

## The restore drill (do it every quarter, and before launch)

```bash
cd apps/api
pnpm build
DATABASE_URL='postgresql://...production-or-a-copy...' ./scripts/restore-drill.sh
```

It dumps the database, restores the dump into a fresh scratch database, compares the row count of every table, checks `prisma migrate status`, starts the API on the copy and calls `/api/health/ready`. It prints PASS/FAIL and how long it took. Run it against a **snapshot restored from the host's own backup** at least once, not just against a live dump: that proves the backup itself.

Last results (fill in):

| Date | Against | Size | Time | Result | By |
|---|---|---|---|---|---|
| 2026-10-12 | development database copy (52 tables, 280 rows) | 132 KB | 4 s | PASS | F8 |
| | production snapshot | | | | |

## A real restore (database lost or corrupted)

1. **Stop writes.** Put the API in maintenance (scale to 0, or point the load balancer at a static page).
2. Decide the target time (just before the bad change). With point-in-time recovery, restore to a new database at that time; otherwise take the newest snapshot.
3. Restore into a **new** database; do not overwrite the damaged one yet.
4. Run `pnpm exec prisma migrate status` against it. If it is behind the code, run `prisma migrate deploy`.
5. Point `DATABASE_URL` at the new database; start one instance; call `/api/health/ready`.
6. Sign in to the admin portal, open Audit log, and check the last entries are from before the target time. Tell Support which hours of activity were lost (jobs, chats, payments reported in that window): customers and professionals will need to redo them.
7. Bring the other instances up. Keep the damaged database for investigation, then delete it after [30] days.
8. Write what happened in the incident log and in the table above.

## Files restore

Turn on versioning before you need it. To recover a deleted or overwritten object, restore the previous version in the bucket console. Uploaded files are never edited, only added or removed, so versions are straightforward.
