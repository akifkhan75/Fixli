import { CountryConfigService } from './country-config.service';

describe('CountryConfigService', () => {
  const prisma: any = { countryConfig: { findUnique: jest.fn() }, user: { findUnique: jest.fn() } };
  let svc: CountryConfigService;
  beforeEach(() => { jest.resetAllMocks(); svc = new CountryConfigService(prisma); });

  it('with no row it falls back to the documented placeholders for that country (Pakistan)', async () => {
    prisma.countryConfig.findUnique.mockResolvedValue(null);
    const c = await svc.get('pk');
    expect(c).toMatchObject({ countryCode: 'PK', currency: 'PKR', version: 0, commission: { rateBps: 1200, minMinor: 10_000, maxMinor: 150_000 }, cashLimits: { softMinor: 300_000, hardMinor: 500_000, maxDaysOwed: 7 } });
    expect(c.settlementRails.map((r) => r.id)).toEqual(['JAZZCASH', 'EASYPAISA', 'BANK']);
    expect(c.emergencyNumbers.length).toBeGreaterThan(0);
  });

  it('no country at all means Pakistan', async () => {
    prisma.countryConfig.findUnique.mockResolvedValue(null);
    expect((await svc.get(null)).countryCode).toBe('PK');
    expect((await svc.get(undefined)).countryCode).toBe('PK');
  });

  it('an unknown country gets Pakistan\'s reference data rather than failing', async () => {
    prisma.countryConfig.findUnique.mockResolvedValue(null);
    expect((await svc.get('zz')).countryCode).toBe('ZZ');
  });

  it('a stored row wins over the defaults, field by field', async () => {
    prisma.countryConfig.findUnique.mockResolvedValue({
      currency: 'PKR', commission: { rateBps: 1000, minMinor: 1, maxMinor: 2 }, cashLimits: null, settlementRails: [{ id: 'BANK', label: 'Bank', account: 'X' }], emergencyNumbers: [{ label: 'Police', number: '15' }], version: 7,
    });
    const c = await svc.get('PK');
    expect(c.commission.rateBps).toBe(1000);
    expect(c.cashLimits.hardMinor).toBe(500_000);
    expect(c.settlementRails).toEqual([{ id: 'BANK', label: 'Bank', account: 'X' }]);
    expect(c.version).toBe(7);
  });

  it('reads through the transaction it is given, never a second pool connection', async () => {
    const tx: any = { countryConfig: { findUnique: jest.fn().mockResolvedValue(null) }, user: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'PK' }) } };
    await svc.forWorker('w1', tx);
    expect(tx.user.findUnique).toHaveBeenCalled();
    expect(tx.countryConfig.findUnique).toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.countryConfig.findUnique).not.toHaveBeenCalled();
  });

  it('is cached for a minute and refreshed after invalidate()', async () => {
    prisma.countryConfig.findUnique.mockResolvedValue(null);
    await svc.get('PK'); await svc.get('PK');
    expect(prisma.countryConfig.findUnique).toHaveBeenCalledTimes(1);
    svc.invalidate();
    await svc.get('PK');
    expect(prisma.countryConfig.findUnique).toHaveBeenCalledTimes(2);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    await svc.get('PK');
    expect(prisma.countryConfig.findUnique).toHaveBeenCalledTimes(3);
    jest.restoreAllMocks();
  });

  it('forWorker uses the worker\'s own country (and Pakistan when unknown)', async () => {
    prisma.countryConfig.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValueOnce({ countryCode: 'ae' });
    expect((await svc.forWorker('w1')).countryCode).toBe('AE');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    expect((await svc.forWorker('w2')).countryCode).toBe('PK');
  });
});
