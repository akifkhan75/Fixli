import { isCountryCode } from '@fixli/shared';

// Validates environment variables once at boot. Missing or weak critical config
// fails fast instead of silently running with fake defaults (doc 21 §20.2).

const PLACEHOLDER_SECRETS = [
  'super-secret-jwt-key-change-in-production',
  'change-me',
  'secret',
];

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  /** Access-token lifetime. Short on purpose; the refresh token keeps users signed in. */
  JWT_EXPIRES_IN: string;
  REFRESH_TOKEN_DAYS: number;
  /** Comma-separated ISO country codes where signup is open, e.g. "PK". */
  ENABLED_COUNTRIES: string[];
  /** Where uploaded photos live. `local` writes to disk (dev/tests); production must use `s3`. */
  STORAGE_DRIVER: 'local' | 's3';
  /** Externally reachable base of this API incl. /api, used to build upload/download links. */
  PUBLIC_API_URL: string;
  STORAGE_LOCAL_DIR?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  STORAGE_PUBLIC_BASE_URL?: string;
  /** Matching & offers (owner decision O3; defaults are the recommendation). */
  MATCH_NOTIFY_LIMIT: number;
  MAX_OFFERS_SHOWN: number;
  OFFER_TTL_MINUTES: number;
  REMATCH_AFTER_MINUTES: number;
  REMATCH_RADIUS_FACTOR: number;
  /** Run the background sweeper (offer expiry, re-matching) in this process. */
  RUN_BACKGROUND_JOBS: boolean;
  /** Start needs a before photo and Finish an after photo (or a stated reason). */
  REQUIRE_JOB_PHOTOS: boolean;
  /** A finished job the customer hasn't confirmed completes by itself after this (D-F2). */
  AUTO_CONFIRM_HOURS: number;
  /** Cash the worker marked and the customer didn't answer is confirmed after this (D-F2). */
  CASH_AUTO_CONFIRM_HOURS: number;
  /** Worker location points are deleted after this many days (D-F3). */
  LOCATION_RETENTION_DAYS: number;
  /** SOS: how long the nearest worker has to accept before the next one is asked. */
  SOS_ACCEPT_SECONDS: number;
  /** SOS: how many workers are asked one by one before normal offers. */
  SOS_DIRECT_TRIES: number;
  /** Who sends one-time codes and trusted-contact alerts. none = nothing is sent. */
  SMS_PROVIDER: 'none' | 'twilio';
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** Sending number (E.164) or Messaging Service id (MG…). */
  TWILIO_FROM?: string;
  /** Card payments for project stages. none = projects are paid directly only. */
  PAYMENTS_PROVIDER: 'none' | 'stripe';
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** A submitted project stage the customer doesn't answer is approved after this many days. */
  PROJECT_AUTO_APPROVE_DAYS: number;
  /** Reads the ID number off a worker's ID photo with the AI provider. Off until the data-processing decision (O9). */
  AI_ID_OCR_ENABLED: boolean;
  /** Straight-line ETA until a routing provider is configured. */
  AVG_TRAVEL_SPEED_KMH: number;
  /** Staff must use an authenticator app (second factor). Default true; false only for tests. */
  ADMIN_TOTP_REQUIRED: boolean;
  /** 32 bytes, base64: encrypts staff authenticator secrets at rest. Required in production. */
  TOTP_ENCRYPTION_KEY?: string;
  /** Enables multi-instance realtime (socket.io Redis adapter) and shared rate limits. */
  REDIS_URL?: string;
  EXPO_PUSH_URL?: string;
  EXPO_ACCESS_TOKEN?: string;
  FRONTEND_URL?: string;
  GEMINI_API_KEY?: string;
  /** Model id; configurable so a retired model never needs a code change. */
  GEMINI_MODEL?: string;
  /** base64 of 32 random bytes; encrypts identity numbers at rest. Required in production. */
  FIELD_ENCRYPTION_KEY?: string;
  /** Signup needs a verified phone code. Defaults on in production, off elsewhere (dev/tests). */
  OTP_REQUIRED: boolean;
  /** Roadmap APIs switched on (recurring_jobs, properties, service_packages, subscriptions). Empty = hidden. */
  ENABLED_FEATURES: string[];
  LOG_LEVEL: string;
  /** Where crashes are reported. Empty = not reported (fine in development). */
  SENTRY_DSN?: string;
  /** Shown on every report so a bug can be tied to a release (the git commit or version). */
  APP_RELEASE?: string;
  /** Lets monitoring read /health/ready details (socket count etc.). Min 24 characters. */
  OPS_TOKEN?: string;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const errors: string[] = [];
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');

  const nodeEnv = (str('NODE_ENV') || 'development') as AppEnv['NODE_ENV'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV must be development, test or production');
  }

  const port = Number(str('PORT') || 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be a valid port number');

  const databaseUrl = str('DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a postgresql:// URL');

  const jwtSecret = str('JWT_SECRET');
  if (jwtSecret.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (nodeEnv === 'production' && PLACEHOLDER_SECRETS.includes(jwtSecret)) {
    errors.push('JWT_SECRET is a placeholder value; set a real secret in production');
  }

  if (nodeEnv === 'production' && !str('FRONTEND_URL')) {
    errors.push('FRONTEND_URL (allowed CORS origin) is required in production');
  }

  const fieldKey = str('FIELD_ENCRYPTION_KEY');
  if (nodeEnv === 'production' && !fieldKey) errors.push('FIELD_ENCRYPTION_KEY is required in production (openssl rand -base64 32)');
  if (fieldKey && Buffer.from(fieldKey, 'base64').length !== 32) errors.push('FIELD_ENCRYPTION_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)');

  const refreshDays = Number(str('REFRESH_TOKEN_DAYS') || 30);
  if (!Number.isInteger(refreshDays) || refreshDays < 1 || refreshDays > 365) {
    errors.push('REFRESH_TOKEN_DAYS must be between 1 and 365');
  }

  const enabledCountries = (str('ENABLED_COUNTRIES') || 'PK')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const unknown = enabledCountries.filter((c) => !isCountryCode(c));
  if (unknown.length) errors.push(`ENABLED_COUNTRIES has unknown codes: ${unknown.join(', ')}`);

  const driver = (str('STORAGE_DRIVER') || (nodeEnv === 'production' ? 's3' : 'local')) as 'local' | 's3';
  if (!['local', 's3'].includes(driver)) errors.push('STORAGE_DRIVER must be local or s3');
  if (nodeEnv === 'production' && driver !== 's3') errors.push('STORAGE_DRIVER must be s3 in production');
  if (driver === 's3') {
    for (const k of ['S3_BUCKET', 'STORAGE_PUBLIC_BASE_URL']) if (!str(k)) errors.push(`${k} is required when STORAGE_DRIVER=s3`);
  }
  const publicApiUrl = (str('PUBLIC_API_URL') || `http://localhost:${port}/api`).replace(/\/+$/, '');
  if (nodeEnv === 'production' && !str('PUBLIC_API_URL')) errors.push('PUBLIC_API_URL is required in production');

  const intIn = (k: string, def: number, min: number, max: number) => {
    const v = Number(str(k) || def);
    if (!Number.isFinite(v) || v < min || v > max) errors.push(`${k} must be between ${min} and ${max}`);
    return v;
  };
  const matchNotifyLimit = intIn('MATCH_NOTIFY_LIMIT', 10, 1, 50);
  const maxOffersShown = intIn('MAX_OFFERS_SHOWN', 3, 1, 10);
  const offerTtl = intIn('OFFER_TTL_MINUTES', 10, 1, 240);
  const rematchAfter = intIn('REMATCH_AFTER_MINUTES', 15, 1, 240);
  const rematchFactor = intIn('REMATCH_RADIUS_FACTOR', 1.5, 1, 5);
  const autoConfirmHours = intIn('AUTO_CONFIRM_HOURS', 24, 1, 24 * 14);
  const cashAutoConfirmHours = intIn('CASH_AUTO_CONFIRM_HOURS', 48, 1, 24 * 14);
  const locationRetentionDays = intIn('LOCATION_RETENTION_DAYS', 30, 1, 365);
  const travelSpeed = intIn('AVG_TRAVEL_SPEED_KMH', 20, 5, 120);
  const sosAccept = intIn('SOS_ACCEPT_SECONDS', 180, 30, 900);
  const sosTries = intIn('SOS_DIRECT_TRIES', 3, 1, 10);
  const sms = (str('SMS_PROVIDER') || 'none') as AppEnv['SMS_PROVIDER'];
  if (!['none', 'twilio'].includes(sms)) errors.push('SMS_PROVIDER must be none or twilio');
  if (sms === 'twilio') {
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']) if (!str(k)) errors.push(`${k} is required when SMS_PROVIDER=twilio`);
  }

  const payments = (str('PAYMENTS_PROVIDER') || 'none') as AppEnv['PAYMENTS_PROVIDER'];
  if (!['none', 'stripe'].includes(payments)) errors.push('PAYMENTS_PROVIDER must be none or stripe');
  if (payments === 'stripe') {
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) if (!str(k)) errors.push(`${k} is required when PAYMENTS_PROVIDER=stripe`);
    // A live key outside production would take real money from a test run.
    if (nodeEnv !== 'production' && /^(sk|rk)_live_/.test(str('STRIPE_SECRET_KEY'))) errors.push('STRIPE_SECRET_KEY is a live key: use a test key (sk_test_…) outside production');
  }
  const autoApproveDays = intIn('PROJECT_AUTO_APPROVE_DAYS', 7, 1, 60);

  const unknownFeatures = str('ENABLED_FEATURES').split(',').map((x) => x.trim()).filter((x) => x && !['recurring_jobs', 'properties', 'service_packages', 'subscriptions'].includes(x));
  if (unknownFeatures.length) errors.push(`ENABLED_FEATURES has unknown feature(s): ${unknownFeatures.join(', ')}`);

  if (str('REDIS_URL') && !/^rediss?:\/\//.test(str('REDIS_URL'))) errors.push('REDIS_URL must be a redis:// or rediss:// URL');
  if (str('OPS_TOKEN') && str('OPS_TOKEN').length < 24) errors.push('OPS_TOKEN must be at least 24 characters');
  if (str('SENTRY_DSN') && !/^https:\/\//.test(str('SENTRY_DSN'))) errors.push('SENTRY_DSN must be an https:// URL (leave empty to turn reporting off)');

  const totpKey = str('TOTP_ENCRYPTION_KEY');
  if (totpKey && Buffer.from(totpKey, 'base64').length !== 32) errors.push('TOTP_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32)');
  if (nodeEnv === 'production' && !totpKey) errors.push('TOTP_ENCRYPTION_KEY is required in production');
  const totpRequired = (str('ADMIN_TOTP_REQUIRED') || (nodeEnv === 'test' ? 'false' : 'true')) === 'true';
  if (nodeEnv === 'production' && !totpRequired) errors.push('ADMIN_TOTP_REQUIRED cannot be false in production');

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: str('JWT_EXPIRES_IN') || '15m',
    REFRESH_TOKEN_DAYS: refreshDays,
    ENABLED_COUNTRIES: enabledCountries,
    STORAGE_DRIVER: driver,
    PUBLIC_API_URL: publicApiUrl,
    STORAGE_LOCAL_DIR: str('STORAGE_LOCAL_DIR') || undefined,
    S3_BUCKET: str('S3_BUCKET') || undefined,
    S3_REGION: str('S3_REGION') || undefined,
    S3_ENDPOINT: str('S3_ENDPOINT') || undefined,
    S3_ACCESS_KEY_ID: str('S3_ACCESS_KEY_ID') || undefined,
    S3_SECRET_ACCESS_KEY: str('S3_SECRET_ACCESS_KEY') || undefined,
    STORAGE_PUBLIC_BASE_URL: str('STORAGE_PUBLIC_BASE_URL') || undefined,
    MATCH_NOTIFY_LIMIT: matchNotifyLimit,
    MAX_OFFERS_SHOWN: maxOffersShown,
    OFFER_TTL_MINUTES: offerTtl,
    REMATCH_AFTER_MINUTES: rematchAfter,
    REMATCH_RADIUS_FACTOR: rematchFactor,
    REDIS_URL: str('REDIS_URL') || undefined,
    SENTRY_DSN: str('SENTRY_DSN') || undefined,
    APP_RELEASE: str('APP_RELEASE') || undefined,
    OPS_TOKEN: str('OPS_TOKEN') || undefined,
    EXPO_PUSH_URL: str('EXPO_PUSH_URL') || undefined,
    EXPO_ACCESS_TOKEN: str('EXPO_ACCESS_TOKEN') || undefined,
    RUN_BACKGROUND_JOBS: (str('RUN_BACKGROUND_JOBS') || (nodeEnv === 'test' ? 'false' : 'true')) === 'true',
    REQUIRE_JOB_PHOTOS: (str('REQUIRE_JOB_PHOTOS') || 'true') === 'true',
    AUTO_CONFIRM_HOURS: autoConfirmHours,
    CASH_AUTO_CONFIRM_HOURS: cashAutoConfirmHours,
    LOCATION_RETENTION_DAYS: locationRetentionDays,
    AVG_TRAVEL_SPEED_KMH: travelSpeed,
    SOS_ACCEPT_SECONDS: sosAccept,
    SOS_DIRECT_TRIES: sosTries,
    SMS_PROVIDER: sms,
    TWILIO_ACCOUNT_SID: str('TWILIO_ACCOUNT_SID') || undefined,
    TWILIO_AUTH_TOKEN: str('TWILIO_AUTH_TOKEN') || undefined,
    TWILIO_FROM: str('TWILIO_FROM') || undefined,
    PAYMENTS_PROVIDER: payments,
    STRIPE_SECRET_KEY: str('STRIPE_SECRET_KEY') || undefined,
    STRIPE_WEBHOOK_SECRET: str('STRIPE_WEBHOOK_SECRET') || undefined,
    PROJECT_AUTO_APPROVE_DAYS: autoApproveDays,
    AI_ID_OCR_ENABLED: str('AI_ID_OCR_ENABLED') === 'true',
    ADMIN_TOTP_REQUIRED: totpRequired,
    TOTP_ENCRYPTION_KEY: totpKey || undefined,
    FRONTEND_URL: str('FRONTEND_URL') || undefined,
    GEMINI_API_KEY: str('GEMINI_API_KEY') || undefined,
    GEMINI_MODEL: str('GEMINI_MODEL') || undefined,
    FIELD_ENCRYPTION_KEY: fieldKey || undefined,
    ENABLED_FEATURES: str('ENABLED_FEATURES').split(',').map((x) => x.trim()).filter(Boolean),
    OTP_REQUIRED: (str('OTP_REQUIRED') || (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    LOG_LEVEL: str('LOG_LEVEL') || 'info',
  };
}
