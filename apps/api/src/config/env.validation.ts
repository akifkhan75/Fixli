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
  /** Worker location points are deleted after this many days (D-F3). */
  LOCATION_RETENTION_DAYS: number;
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
  LOG_LEVEL: string;
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
  const locationRetentionDays = intIn('LOCATION_RETENTION_DAYS', 30, 1, 365);
  const travelSpeed = intIn('AVG_TRAVEL_SPEED_KMH', 20, 5, 120);

  if (str('REDIS_URL') && !/^rediss?:\/\//.test(str('REDIS_URL'))) errors.push('REDIS_URL must be a redis:// or rediss:// URL');

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
    EXPO_PUSH_URL: str('EXPO_PUSH_URL') || undefined,
    EXPO_ACCESS_TOKEN: str('EXPO_ACCESS_TOKEN') || undefined,
    RUN_BACKGROUND_JOBS: (str('RUN_BACKGROUND_JOBS') || (nodeEnv === 'test' ? 'false' : 'true')) === 'true',
    REQUIRE_JOB_PHOTOS: (str('REQUIRE_JOB_PHOTOS') || 'true') === 'true',
    AUTO_CONFIRM_HOURS: autoConfirmHours,
    LOCATION_RETENTION_DAYS: locationRetentionDays,
    AVG_TRAVEL_SPEED_KMH: travelSpeed,
    ADMIN_TOTP_REQUIRED: totpRequired,
    TOTP_ENCRYPTION_KEY: totpKey || undefined,
    FRONTEND_URL: str('FRONTEND_URL') || undefined,
    GEMINI_API_KEY: str('GEMINI_API_KEY') || undefined,
    GEMINI_MODEL: str('GEMINI_MODEL') || undefined,
    LOG_LEVEL: str('LOG_LEVEL') || 'info',
  };
}
