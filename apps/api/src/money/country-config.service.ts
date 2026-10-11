import { Injectable } from '@nestjs/common';
import { COUNTRIES, isCountryCode, type CommissionRule } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';

export interface CashLimits { softMinor: number; hardMinor: number; maxDaysOwed: number }
export interface SettlementRail { id: string; label: string; account: string | null }
export interface CountryMoney {
  countryCode: string;
  currency: string;
  commission: CommissionRule;
  cashLimits: CashLimits;
  settlementRails: SettlementRail[];
  emergencyNumbers: { label: string; number: string }[];
  version: number;
}

/**
 * Doc 25 O8 placeholders for Pakistan (12 %, Rs 100 min, Rs 1,500 max per job; soft Rs 3,000,
 * hard Rs 5,000, 7 days). Used only when a country has no row yet; the row (migration + admin, F6)
 * is the source of truth.
 */
const DEFAULTS: Record<string, Omit<CountryMoney, 'countryCode' | 'currency' | 'emergencyNumbers' | 'version'>> = {
  PK: {
    commission: { rateBps: 1200, minMinor: 10_000, maxMinor: 150_000 },
    cashLimits: { softMinor: 300_000, hardMinor: 500_000, maxDaysOwed: 7 },
    settlementRails: [
      { id: 'JAZZCASH', label: 'JazzCash', account: null },
      { id: 'EASYPAISA', label: 'Easypaisa', account: null },
      { id: 'BANK', label: 'Bank transfer', account: null },
    ],
  },
};

const TTL_MS = 60_000;

/** Country rules for money (and emergency numbers): one place, cached for a minute. */
@Injectable()
export class CountryConfigService {
  private cache = new Map<string, { at: number; value: CountryMoney }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(countryCode: string | null | undefined): Promise<CountryMoney> {
    const code = (countryCode ?? 'PK').toUpperCase();
    const hit = this.cache.get(code);
    if (hit && hit.at > Date.now() - TTL_MS) return hit.value;

    const row = await this.prisma.countryConfig.findUnique({ where: { countryCode: code } });
    const ref = isCountryCode(code) ? COUNTRIES[code] : COUNTRIES.PK;
    const d = DEFAULTS[code] ?? DEFAULTS.PK;
    const value: CountryMoney = {
      countryCode: code,
      currency: row?.currency ?? ref.currency.code,
      commission: (row?.commission as unknown as CommissionRule) ?? d.commission,
      cashLimits: (row?.cashLimits as unknown as CashLimits) ?? d.cashLimits,
      settlementRails: (row?.settlementRails as unknown as SettlementRail[]) ?? d.settlementRails,
      emergencyNumbers: (row?.emergencyNumbers as unknown as CountryMoney['emergencyNumbers']) ?? ref.emergencyNumbers,
      version: row?.version ?? 0,
    };
    this.cache.set(code, { at: Date.now(), value });
    return value;
  }

  forWorker = async (workerId: string) => {
    const u = await this.prisma.user.findUnique({ where: { id: workerId }, select: { countryCode: true } });
    return this.get(u?.countryCode);
  };

  invalidate() {
    this.cache.clear();
  }
}
