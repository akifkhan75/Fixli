# Database changes (migrations) and what to do if one goes wrong

Prisma migrations only go **forward**: there is no "down". That is on purpose. The safe way to run a database is to make every change safe to leave in place, and to fix mistakes with the next change.

## How a change gets to production

1. A migration is generated and checked in with the code (`apps/api/prisma/migrations/<time>_name/`).
2. CI proves two things on every push: the migrations build the database from empty (`prisma migrate deploy`), and the result **matches the schema exactly** (`prisma migrate diff --exit-code`). A hand-edited migration that differs from the schema fails the build.
3. The production image runs `prisma migrate deploy` when it starts. Migrations are applied in order, once.

## Rules for every migration (so a rollback is never needed)

- **Expand, then contract.** Add the new column/table first (nullable or with a default), ship code that writes both, backfill, switch reads, and only in a *later* release remove the old one. Never rename or drop in the same release that stops using it.
- **Old code must keep working with the new schema** for one release: the previous version of the API may still be running on another instance during a deploy, or you may need to roll the code back.
- Large backfills run in batches, outside the migration, not as one `UPDATE` that locks a table.
- No `DROP` of anything with data unless the backup was verified that day.
- Data fixes inside a migration (like F3's duplicate-payment clean-up) must be re-runnable and must print what they changed.

## If a migration fails during deploy

`prisma migrate deploy` stops at the failing migration and the new instance does not start; the old instances keep running on the old schema. Nothing is half-applied unless the failing migration was not transactional.

1. Read the error in the deploy log (it names the migration and the SQL).
2. If the database is fine (nothing was changed): fix the migration **in a new commit** (do not edit one that already ran anywhere else), deploy again.
3. If it changed part of the database before failing: look at what exists (`\d` in psql). Either complete it by hand to match the migration and mark it done, or undo the partial change by hand and mark it rolled back:
   ```bash
   pnpm exec prisma migrate resolve --rolled-back <migration_folder_name>   # undone by hand, will be retried
   pnpm exec prisma migrate resolve --applied     <migration_folder_name>   # finished by hand
   ```
4. Run `prisma migrate status` until it says up to date, then deploy.

## If a migration applied but the release is bad

1. **Roll the code back** to the previous image (staging-and-releasing.md). The schema stays as it is: this works because of the expand rule above.
2. Fix forward with a new migration if the schema itself is wrong.
3. Only if data was damaged: restore from backup (backups-and-restore.md), which loses everything since the backup.

## Before a risky migration

- Run the restore drill that day.
- Run the migration on a restored copy of production and time it.
- Choose a quiet hour; tell Support.
