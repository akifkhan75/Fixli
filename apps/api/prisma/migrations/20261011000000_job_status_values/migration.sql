-- New enum values on their own: Postgres can't use a value inside the transaction that adds it,
-- so later migrations (and data fixes) that reference these must run separately.
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'EN_ROUTE';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'ARRIVED';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CONFIRMATION';
ALTER TYPE "UploadPurpose" ADD VALUE IF NOT EXISTS 'CHAT_PHOTO';
