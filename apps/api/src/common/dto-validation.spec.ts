import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as C from '../admin/dto/console.dto';
import * as A from '../admin/dto/admin.dto';
import * as P from '../properties/dto/property.dto';
import * as D from '../disputes/dto/dispute.dto';

/** Which fields does validation complain about? Mirrors the app's ValidationPipe (whitelist + forbid unknown). */
const bad = async (cls: any, plain: object) =>
  (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).flatMap((e) => [e.property, ...(e.children ?? []).map((c) => `${e.property}.${c.property}`)]).sort();
const ok = async (cls: any, plain: object) => expect(await bad(cls, plain)).toEqual([]);

const country = {
  commission: { rateBps: 1200, minMinor: 100, maxMinor: 1500 }, cashLimits: { softMinor: 3000, hardMinor: 5000, maxDaysOwed: 7 },
  settlementRails: [{ id: 'JAZZCASH', label: 'JazzCash', account: null }], emergencyNumbers: [{ label: 'Police', number: '15' }], baseVersion: 1,
};

describe('staff console DTOs', () => {
  it('queries accept their filters and refuse unknown or malformed ones', async () => {
    await ok(C.RangeQuery, { from: '2026-11-01', to: '2026-11-08T00:00:00Z' });
    expect(await bad(C.RangeQuery, { from: 'yesterday' })).toEqual(['from']);
    await ok(C.AuditQuery, { actorId: 'a', entityType: 'User', action: 'user.', from: '2026-01-01', cursor: 'c' });
    expect(await bad(C.AuditQuery, { cursor: 'x'.repeat(65), evil: 1 })).toEqual(['cursor', 'evil']);
    await ok(C.IncidentListQuery, { status: 'OPEN', type: 'SOS' });
    expect(await bad(C.IncidentListQuery, { status: 'DONE', type: 'X' })).toEqual(['status', 'type']);
    await ok(C.PaymentQuery, { status: 'CONFIRMED' });
    expect(await bad(C.PaymentQuery, { status: 'PAID' })).toEqual(['status']);
  });

  it('incident updates, reasons, review moderation', async () => {
    await ok(C.IncidentUpdateDto, { status: 'RESOLVED', note: 'called both' });
    expect(await bad(C.IncidentUpdateDto, { status: 'NOPE', note: 'x' })).toEqual(['note', 'status']);
    await ok(C.ReasonDto, { reason: 'repeated no-shows' });
    expect(await bad(C.ReasonDto, { reason: 'x' })).toEqual(['reason']);
    await ok(C.ModerateReviewDto, { action: 'HIDE' });
    expect(await bad(C.ModerateReviewDto, { action: 'DELETE' })).toEqual(['action']);
  });

  it('ledger adjustments need a whole number, a reason and a key', async () => {
    await ok(C.AdjustmentDto, { amount: -500, note: 'goodwill', idempotencyKey: 'adjust-123' });
    expect(await bad(C.AdjustmentDto, { amount: 1.5, note: 'x', idempotencyKey: 'k' })).toEqual(['amount', 'idempotencyKey', 'note']);
    expect(await bad(C.AdjustmentDto, { amount: 999_999_999, note: 'fine note', idempotencyKey: 'adjust-123' })).toEqual(['amount']);
  });

  it('catalogue content, issues and price bands', async () => {
    await ok(C.UpdateCategoryContentDto, { displayName: 'Plumbing', translations: { ur: { name: 'x' } }, sortOrder: 3, isActive: true });
    expect(await bad(C.UpdateCategoryContentDto, { sortOrder: -1, isActive: 'yes' })).toEqual(['isActive', 'sortOrder']);
    await ok(C.IssueDto, { code: 'leaking_tap', name: 'Leaking tap' });
    expect(await bad(C.IssueDto, { code: 'Leaking Tap', name: 'x' })).toEqual(['code', 'name']);
    await ok(C.PriceBandDto, { categoryId: 'c1', city: 'Karachi', currency: 'PKR', minMinor: 100, maxMinor: 900, approved: false });
    expect(await bad(C.PriceBandDto, { categoryId: 'c1', city: 'K', currency: 'pkr', minMinor: 0, maxMinor: 900 })).toEqual(['city', 'currency', 'minMinor']);
  });

  it('country settings validate nested commission, limits, rails and numbers', async () => {
    const dto = plainToInstance(C.CountryConfigDto, country);
    expect(await validate(dto)).toEqual([]);
    expect(await bad(C.CountryConfigDto, { ...country, baseVersion: -1 })).toEqual(['baseVersion']);
    expect(await bad(C.CountryConfigDto, { ...country, commission: { rateBps: 9000, minMinor: 0, maxMinor: 1 } })).toContain('commission');
    expect(await bad(C.CountryConfigDto, { ...country, emergencyNumbers: [{ label: 'Police', number: 'abc' }] })).toContain('emergencyNumbers');
    expect(await bad(C.CountryConfigDto, { ...country, settlementRails: [{ id: 'bad id', label: 'x' }] })).toContain('settlementRails');
    expect(await bad(C.CountryConfigDto, { ...country, cashLimits: { softMinor: 1, hardMinor: 0, maxDaysOwed: 100 } })).toContain('cashLimits');
  });

  it('flags and new staff', async () => {
    await ok(C.FlagDto, { value: true });
    expect(await bad(C.FlagDto, { value: 'true' })).toEqual(['value']);
    await ok(C.CreateStaffDto, { email: 'a@x.com', name: 'Ali', roles: ['Support'] });
    expect(await bad(C.CreateStaffDto, { email: 'nope', name: 'A', roles: ['Boss'] })).toEqual(['email', 'name', 'roles']);
  });
});

describe('admin DTOs', () => {
  it('verification queue and decision', async () => {
    await ok(A.VerificationQueryDto, { status: 'SUBMITTED', limit: 20, cursor: 'c' });
    expect(await bad(A.VerificationQueryDto, { status: 'X', limit: 500 })).toEqual(['limit', 'status']);
    await ok(A.VerificationDecisionDto, { decision: 'REJECT', reason: 'blurry' });
    expect(await bad(A.VerificationDecisionDto, { decision: 'MAYBE' })).toEqual(['decision']);
    await ok(A.ActionReasonDto, { reason: 'because' });
    expect(await bad(A.ActionReasonDto, { reason: 'no' })).toEqual(['reason']);
  });

  it('paging, search, job and incident filters, role changes; the search term is trimmed', async () => {
    await ok(A.PageQueryDto, { skip: 10 });
    expect(await bad(A.PageQueryDto, { skip: -1 })).toEqual(['skip']);
    expect(plainToInstance(A.UserSearchDto, { q: '  ali ' }).q).toBe('ali');
    await ok(A.JobListQueryDto, { status: 'COMPLETED', skip: 0 });
    expect(await bad(A.JobListQueryDto, { status: 'DONE' })).toEqual(['status']);
    await ok(A.IncidentQueryDto, { status: 'OPEN' });
    await ok(A.SetRolesDto, { roles: ['Support', 'Finance'] });
    expect(await bad(A.SetRolesDto, { roles: ['Root'] })).toEqual(['roles']);
    expect(A.JOB_STATUSES).toContain('EN_ROUTE');
  });
});

describe('property DTOs', () => {
  it('property, asset and warranty', async () => {
    await ok(P.CreatePropertyDto, { type: 'HOUSE', streetAddress: '1 Main', city: 'Karachi', country: 'PK', postalCode: '75000', squareFeet: 900, builtYear: 2010 });
    expect(await bad(P.CreatePropertyDto, { type: '', streetAddress: '1', city: 'K', country: 'PK', postalCode: '1', builtYear: 1500 })).toEqual(['builtYear', 'type']);
    await ok(P.CreateAssetDto, { name: 'Geyser', category: 'APPLIANCE', installDate: '2026-01-01' });
    expect(await bad(P.CreateAssetDto, { name: '', category: 'X', installDate: 'soon' })).toEqual(['installDate', 'name']);
    await ok(P.CreateWarrantyDto, { provider: 'Acme', expirationDate: '2027-01-01' });
    expect(await bad(P.CreateWarrantyDto, { provider: 'Acme', expirationDate: 'later' })).toEqual(['expirationDate']);
  });
});

describe('dispute DTOs', () => {
  it('opening: amount is whole minor units, evidence is upload ids, at most six', async () => {
    await ok(D.CreateDisputeDto, { jobRequestId: 'j1', reason: 'bad', category: 'QUALITY', amountHeld: 1000, evidenceUploadIds: ['u1'] });
    expect(await bad(D.CreateDisputeDto, { jobRequestId: 'j1', reason: 'bad', category: 'WHATEVER', amountHeld: 1.5, evidenceUploadIds: Array(7).fill('u') })).toEqual(['amountHeld', 'category', 'evidenceUploadIds']);
    expect(await bad(D.CreateDisputeDto, { jobRequestId: 'j1', reason: 'bad', evidenceKeys: ['uploads/x.jpg'] })).toEqual(['evidenceKeys']);
  });
  it('resolving: status, optional payment outcome and nested ledger adjustment', async () => {
    await ok(D.ResolveDisputeDto, { status: 'RESOLVED', resolution: 'ok', paymentOutcome: 'VOID', ledgerAdjustment: { amount: -100, note: 'goodwill' } });
    expect(await bad(D.ResolveDisputeDto, { status: 'OPEN' })).toEqual(['status']);
    expect(await bad(D.ResolveDisputeDto, { status: 'RESOLVED', paymentOutcome: 'MAYBE', ledgerAdjustment: { amount: 1, note: 'x' } })).toEqual(['ledgerAdjustment', 'ledgerAdjustment.note', 'paymentOutcome']);
    expect(D.DISPUTE_CATEGORIES).toContain('PAYMENT');
  });
});
