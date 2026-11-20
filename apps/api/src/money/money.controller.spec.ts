import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MoneyController } from './money.controller';

describe('MoneyController', () => {
  const earnings = { summary: jest.fn(), ledger: jest.fn() };
  const settlements = { report: jest.fn(), listMine: jest.fn(), listForStaff: jest.fn(), decide: jest.fn() };
  const ctl = new MoneyController(earnings as any, settlements as any);
  beforeEach(() => jest.resetAllMocks());

  it('earnings default to this week; the ledger takes a cursor and limit', () => {
    ctl.summary('w1', {} as any);
    ctl.summary('w1', { period: 'month' });
    ctl.ledger('w1', { cursor: 'c', limit: 10 } as any);
    expect(earnings.summary.mock.calls).toEqual([['w1', 'week'], ['w1', 'month']]);
    expect(earnings.ledger).toHaveBeenCalledWith('w1', 'c', 10);
  });

  it('workers report and list their own settlements', () => {
    ctl.report('w1', { amount: 100, rail: 'JAZZ', reference: 'TX1' } as any);
    ctl.mine('w1');
    expect(settlements.report).toHaveBeenCalledWith('w1', { amount: 100, rail: 'JAZZ', reference: 'TX1' });
    expect(settlements.listMine).toHaveBeenCalledWith('w1');
  });

  it('staff list by status', () => {
    ctl.staffList({ status: 'PENDING' });
    expect(settlements.listForStaff).toHaveBeenCalledWith('PENDING');
  });

  it('staff confirm or reject a settlement, with an optional note', () => {
    ctl.confirm('s1', 'a1', { note: 'ok' });
    ctl.reject('s1', 'a1', {});
    expect(settlements.decide.mock.calls).toEqual([['s1', 'a1', true, 'ok'], ['s1', 'a1', false, undefined]]);
  });

  it('request shapes: reference characters, amounts, period and status', async () => {
    const t = (n: string) => Reflect.getMetadata('design:paramtypes', MoneyController.prototype, n);
    const bad = async (cls: any, o: object) => (await validate(plainToInstance(cls, o))).map((e) => e.property).sort();
    const [, Report] = t('report');
    expect(await bad(Report, { amount: 100, rail: 'JAZZ', reference: 'TX-1/ok' })).toEqual([]);
    expect(await bad(Report, { amount: 0, rail: 'JAZZ', reference: '<script>' })).toEqual(['amount', 'reference']);
    expect(await bad(t('summary')[1], { period: 'year' })).toEqual(['period']);
    expect(await bad(t('ledger')[1], { limit: 99 })).toEqual(['limit']);
    expect(await bad(t('staffList')[0], { status: 'LOST' })).toEqual(['status']);
  });
});
