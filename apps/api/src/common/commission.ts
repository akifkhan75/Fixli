import { COUNTRIES, CommissionConfig, isCountryCode } from '@fixli/shared';

/** Commission rules for a country, from shared config (never hard-coded in services). */
export function commissionConfigFor(countryCode?: string | null): CommissionConfig {
  const code = (countryCode ?? 'PK').toUpperCase();
  return COUNTRIES[isCountryCode(code) ? code : 'PK'].commission;
}

/**
 * Commission for one cash job, integer minor units: floor(amount * rate), clamped to
 * [min, max] but never more than the amount itself. Zero amount -> zero commission.
 */
export function computeCommission(amountMinor: number, cfg: CommissionConfig): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 0;
  const raw = Math.floor((amountMinor * cfg.rateBps) / 10_000);
  return Math.min(amountMinor, Math.min(cfg.maxMinor, Math.max(cfg.minMinor, raw)));
}

export type CapStatus = 'OK' | 'WARN' | 'BLOCKED';

/** `owedMinor` is a positive number of commission the worker owes the platform. */
export function capStatus(owedMinor: number, cfg: CommissionConfig): CapStatus {
  if (owedMinor > cfg.hardLimitMinor) return 'BLOCKED';
  if (owedMinor > cfg.softLimitMinor) return 'WARN';
  return 'OK';
}
