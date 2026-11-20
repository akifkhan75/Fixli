import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminConsoleService } from './admin-console.service';

/** A model whose every method is a jest.fn, created on first use. */
const model = (): any => new Proxy({} as any, { get: (t, k: string) => (t[k] ??= jest.fn()) });
const db = (): any => {
  const models: any = {};
  return new Proxy({} as any, {
    get: (t, k: string) => {
      if (k === '$transaction') return t[k] ??= jest.fn((fn: any) => (typeof fn === 'function' ? fn(db_) : Promise.all(fn)));
      if (k === '$queryRaw') return t[k] ??= jest.fn();
      return (models[k] ??= model());
    },
  });
};
let db_: any;

describe('AdminConsoleService', () => {
  let prisma: any, audit: any, storage: any, jobs: any, ledger: any, countries: any, flags: any, users: any, svc: AdminConsoleService;

  beforeEach(() => {
    db_ = prisma = db();
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    audit = { record: jest.fn() };
    storage = { signedUrlForKey: jest.fn(async (k: string) => `https://x/${k}`) };
    jobs = { cancel: jest.fn(async () => ({ ok: 1 })), reassign: jest.fn(async () => ({ ok: 2 })), releaseSuspended: jest.fn(async () => ({ cancelled: [], offersWithdrawn: 0, activeBookings: [] })) };
    ledger = { post: jest.fn(), notifyPaused: jest.fn() };
    countries = { forWorker: jest.fn(async () => ({ currency: 'PKR' })), invalidate: jest.fn() };
    flags = { list: jest.fn(async () => ({})), get: jest.fn(async () => false), set: jest.fn() };
    users = { suspendUser: jest.fn(async () => ({ id: 'u1', status: 'SUSPENDED' })) };
    svc = new AdminConsoleService(prisma, audit, storage, jobs, ledger, countries, flags, users);
  });

  it('me: roles become permissions', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'a', name: 'A', email: 'a@x', adminRoles: ['Verification'], totpEnabledAt: null });
    const me = await svc.me('a');
    expect(me.permissions).toContain('verification.read');
    expect(me.permissions).not.toContain('finance.adjust');
  });

  describe('dashboard', () => {
    it('computes fill rate, medians and money from the counts', async () => {
      prisma.user.groupBy.mockResolvedValue([{ type: 'customer', _count: 5 }]);
      prisma.worker.count.mockResolvedValue(2);
      prisma.jobRequest.groupBy.mockResolvedValueOnce([{ status: 'CREATED', _count: 1 }]).mockResolvedValueOnce([{ cancelReason: null, _count: 2 }]);
      prisma.jobRequest.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      prisma.dispute.count.mockResolvedValue(1);
      prisma.incident.count.mockResolvedValue(3);
      prisma.payment.groupBy.mockResolvedValue([{ currency: 'PKR', _sum: { amount: 500000 }, _count: 2 }]);
      prisma.worker.aggregate.mockResolvedValue({ _sum: { ledgerBalance: 3000 }, _count: 1 });
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -1200 } });
      prisma.$queryRaw.mockResolvedValue([{ minutes: 3 }, { minutes: 9 }, { minutes: 5 }]);
      const d = await svc.dashboard('2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z');
      expect(d).toMatchObject({ requests: 10, booked: 4, fillRate: 40, medianMinutesToFirstOffer: 5, workersOnline: 2, openDisputes: 1, openIncidents: 3, commissionSettled: 1200 });
      expect(d.cancellations).toEqual({ UNKNOWN: 2 });
      expect(d.gmv).toEqual([{ currency: 'PKR', amount: 500000, payments: 2 }]);
      expect(d.commissionOwed).toEqual({ amount: 3000, workers: 1 });
    });

    it('defaults to the last 7 days and has no fill rate with no requests', async () => {
      prisma.user.groupBy.mockResolvedValue([]); prisma.worker.count.mockResolvedValue(0); prisma.jobRequest.groupBy.mockResolvedValue([]);
      prisma.jobRequest.count.mockResolvedValue(0); prisma.dispute.count.mockResolvedValue(0); prisma.incident.count.mockResolvedValue(0);
      prisma.payment.groupBy.mockResolvedValue([]); prisma.worker.aggregate.mockResolvedValue({ _sum: {}, _count: 0 });
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: {} }); prisma.$queryRaw.mockResolvedValue([]);
      const d = await svc.dashboard();
      expect(d.fillRate).toBeNull();
      expect(d.medianMinutesToFirstOffer).toBeNull();
      expect(new Date(d.range.to).getTime() - new Date(d.range.from).getTime()).toBe(7 * 86_400_000);
    });

    it('median of an even count is the rounded middle pair', async () => {
      prisma.user.groupBy.mockResolvedValue([]); prisma.worker.count.mockResolvedValue(0); prisma.jobRequest.groupBy.mockResolvedValue([]);
      prisma.jobRequest.count.mockResolvedValue(1); prisma.dispute.count.mockResolvedValue(0); prisma.incident.count.mockResolvedValue(0);
      prisma.payment.groupBy.mockResolvedValue([]); prisma.worker.aggregate.mockResolvedValue({ _sum: {}, _count: 0 });
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: {} }); prisma.$queryRaw.mockResolvedValue([{ minutes: 2 }, { minutes: 5 }]);
      expect((await svc.dashboard()).medianMinutesToFirstOffer).toBe(4);
    });
  });

  describe('jobs', () => {
    it('jobDetail hides the idempotency key and flattens the conversation', async () => {
      prisma.jobRequest.findUnique.mockResolvedValue({ id: 'j', idempotencyKey: 'secret', conversations: [{ id: 'c1' }] });
      expect(await svc.jobDetail('j')).toEqual({ id: 'j', conversationId: 'c1' });
      prisma.jobRequest.findUnique.mockResolvedValue({ id: 'j', conversations: [] });
      expect((await svc.jobDetail('j')).conversationId).toBeNull();
      prisma.jobRequest.findUnique.mockResolvedValue(null);
      await expect(svc.jobDetail('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('transcript is audited and signs image links', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 'c1', participants: [] });
      prisma.message.findMany.mockResolvedValue([{ id: 'm1', imageKey: 'k', text: 'hi' }, { id: 'm2', imageKey: null, text: 'yo' }]);
      const t = await svc.transcript('j', 's1');
      expect(t.messages.map((m: any) => m.imageUrl)).toEqual(['https://x/k', null]);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat.transcript_viewed', actorId: 's1' }));
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(svc.transcript('j', 's1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancel and reassign go through the job rules and are audited', async () => {
      await svc.cancelJob('j', 's1', 'no show');
      expect(jobs.cancel).toHaveBeenCalledWith('j', { id: 's1', type: 'admin' }, { reason: 'OTHER', note: 'no show' });
      prisma.jobRequest.findUnique.mockResolvedValue({ assignedWorkerId: 'w', status: 'ACCEPTED' });
      await svc.reassignJob('j', 's1', 'late');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'job.reassigned' }));
      prisma.jobRequest.findUnique.mockResolvedValue(null);
      await expect(svc.reassignJob('x', 's1', 'r')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('users & staff', () => {
    it('suspend releases jobs and audits only when something was released', async () => {
      await svc.suspendUser('u1', 's1', 'abuse');
      expect(audit.record).not.toHaveBeenCalled();
      jobs.releaseSuspended.mockResolvedValue({ cancelled: ['j1'], offersWithdrawn: 1, activeBookings: [] });
      const out = await svc.suspendUser('u1', 's1', 'abuse');
      expect(out.cancelled).toEqual(['j1']);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.suspension_jobs_released' }));
    });

    it('reactivate only works on a suspended account', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.reactivateUser('u1', 's1', 'ok')).rejects.toBeInstanceOf(ConflictException);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      expect(await svc.reactivateUser('u1', 's1', 'ok')).toEqual({ id: 'u1', status: 'ACTIVE' });
    });

    it('createStaff: unique email, de-duplicated roles, one-time password never stored in clear', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'x' });
      await expect(svc.createStaff('s1', { email: 'A@X.com', name: 'A', roles: ['Support'] } as any)).rejects.toMatchObject({ response: { code: 'EMAIL_TAKEN' } });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', adminRoles: data.adminRoles }));
      const out = await svc.createStaff('s1', { email: ' A@X.com ', name: ' A ', roles: ['Support', 'Support'] } as any);
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.email).toBe('a@x.com');
      expect(data.adminRoles).toEqual(['Support']);
      expect(data.password).not.toBe(out.temporaryPassword);
      expect(out.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    });
  });

  describe('lists', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    it('audit log pages with a cursor and filters', async () => {
      prisma.auditLog.findMany.mockResolvedValue(rows(51));
      const p = await svc.auditLogs({ actorId: 'a', entityType: 'User', entityId: 'e', action: 'user.', from: '2026-01-01', to: '2026-02-01', cursor: 'c' } as any);
      expect(p.items).toHaveLength(50);
      expect(p.nextCursor).toBe('r49');
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where.action).toEqual({ startsWith: 'user.' });
      expect(args.cursor).toEqual({ id: 'c' });
      prisma.auditLog.findMany.mockResolvedValue(rows(3));
      expect((await svc.auditLogs({} as any)).nextCursor).toBeNull();
    });

    it('incidents and payments page too; incidents hide the idempotency key', async () => {
      prisma.incident.findMany.mockResolvedValue([{ id: 'i1', idempotencyKey: 'k' }]);
      expect((await svc.incidents({ status: 'OPEN', type: 'SOS', cursor: 'c' } as any)).items).toEqual([{ id: 'i1' }]);
      prisma.payment.findMany.mockResolvedValue(rows(2));
      expect((await svc.payments({ status: 'CONFIRMED', cursor: 'c' } as any)).items).toHaveLength(2);
    });

    it('simple reads delegate', async () => {
      await svc.balances(); await svc.workerLedger('w'); await svc.catalog(); await svc.priceBands('c'); await svc.priceBands(); await svc.flagsList();
      expect(prisma.worker.findMany).toHaveBeenCalled();
      expect(flags.list).toHaveBeenCalled();
    });
  });

  describe('incident', () => {
    it('detail includes the reported person; 404 when missing', async () => {
      prisma.incident.findUnique.mockResolvedValue({ id: 'i', idempotencyKey: 'k', targetId: 't', notes: [] });
      prisma.user.findUnique.mockResolvedValue({ id: 't', name: 'T' });
      const i = await svc.incident('i');
      expect(i).not.toHaveProperty('idempotencyKey');
      expect(i.target).toMatchObject({ id: 't' });
      prisma.incident.findUnique.mockResolvedValue(null);
      await expect(svc.incident('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('update: needs a change; writes status and note; audits', async () => {
      prisma.incident.findUnique.mockResolvedValue({ status: 'OPEN', id: 'i', notes: [], targetId: null });
      await expect(svc.updateIncident('i', 's', {} as any)).rejects.toBeInstanceOf(BadRequestException);
      await svc.updateIncident('i', 's', { status: 'RESOLVED', note: ' called them ' } as any);
      expect(prisma.incident.update).toHaveBeenCalledWith({ where: { id: 'i' }, data: { status: 'RESOLVED' } });
      expect(prisma.incidentNote.create.mock.calls[0][0].data.text).toBe('called them');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'incident.updated' }));
      prisma.incident.findUnique.mockResolvedValue(null);
      await expect(svc.updateIncident('x', 's', { note: 'n' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ledger adjustment & disputes', () => {
    it('adjust: unknown worker 404; duplicate is not re-audited; becoming blocked notifies', async () => {
      prisma.worker.findUnique.mockResolvedValue(null);
      await expect(svc.adjust('w', 's', { amount: 1, note: 'n', idempotencyKey: 'k' } as any)).rejects.toBeInstanceOf(NotFoundException);
      prisma.worker.findUnique.mockResolvedValue({ currency: 'PKR' });
      ledger.post.mockResolvedValue({ duplicate: true, entry: { id: 'e1' } });
      await svc.adjust('w', 's', { amount: 1, note: ' n ', idempotencyKey: 'k' } as any);
      expect(audit.record).not.toHaveBeenCalled();
      ledger.post.mockResolvedValue({ duplicate: false, becameBlocked: true, entry: { id: 'e2' } });
      await svc.adjust('w', 's', { amount: 1, note: 'n', idempotencyKey: 'k2' } as any);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ledger.adjusted' }));
      expect(ledger.notifyPaused).toHaveBeenCalledWith('w', 'e2');
    });

    it('disputeDetail signs evidence and loads the payment when there is one', async () => {
      prisma.dispute.findUnique.mockResolvedValue({ id: 'd', paymentId: 'p', evidenceKeys: ['a'] });
      prisma.payment.findUnique.mockResolvedValue({ id: 'p' });
      const d = await svc.disputeDetail('d');
      expect(d.evidence).toEqual(['https://x/a']);
      expect(d.payment).toEqual({ id: 'p' });
      prisma.dispute.findUnique.mockResolvedValue({ id: 'd', paymentId: null, evidenceKeys: [] });
      expect((await svc.disputeDetail('d')).payment).toBeNull();
      prisma.dispute.findUnique.mockResolvedValue(null);
      await expect(svc.disputeDetail('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reviews', () => {
    it('queue: flagged or reported when open, hidden when asked', async () => {
      await svc.reviewQueue(); await svc.reviewQueue(true);
      expect(prisma.review.findMany.mock.calls[0][0].where.status).toBe('PUBLISHED');
      expect(prisma.review.findMany.mock.calls[1][0].where).toEqual({ status: 'HIDDEN' });
    });

    it.each([['HIDE', 'HIDDEN'], ['RESTORE', 'PUBLISHED']])('%s updates the review and recomputes the worker rating', async (action, status) => {
      prisma.review.findUnique.mockResolvedValue({ status: 'X', targetId: 'w', revieweeRole: 'worker' });
      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4.26 } });
      await svc.moderateReview('r', 's', { action, note: 'n' } as any);
      expect(prisma.review.update.mock.calls[0][0].data.status).toBe(status);
      expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w' }, data: { rating: 4.3 } });
    });

    it('DISMISS clears reports and leaves the rating alone; unknown review is 404', async () => {
      prisma.review.findUnique.mockResolvedValue({ status: 'PUBLISHED', targetId: 'w', revieweeRole: 'worker' });
      await svc.moderateReview('r', 's', { action: 'DISMISS' } as any);
      expect(prisma.reviewReport.deleteMany).toHaveBeenCalled();
      expect(prisma.worker.update).not.toHaveBeenCalled();
      prisma.review.findUnique.mockResolvedValue(null);
      await expect(svc.moderateReview('x', 's', { action: 'HIDE' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('catalogue & price bands', () => {
    it('updateCategory merges translations; 404 when missing', async () => {
      prisma.serviceCategory.findUnique.mockResolvedValue({ id: 'c', translations: { ur: { name: 'a' } }, isActive: true });
      prisma.serviceCategory.update.mockResolvedValue({ id: 'c' });
      await svc.updateCategory('c', 's', { translations: { ar: { name: 'b' } }, sortOrder: 2, isActive: false } as any);
      const data = prisma.serviceCategory.update.mock.calls[0][0].data;
      expect(data.translations).toEqual({ ur: { name: 'a' }, ar: { name: 'b' } });
      expect(data).toMatchObject({ sortOrder: 2, isActive: false });
      prisma.serviceCategory.findUnique.mockResolvedValue(null);
      await expect(svc.updateCategory('x', 's', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upsertIssue: category must exist; saves with defaults', async () => {
      prisma.serviceCategory.findUnique.mockResolvedValueOnce(null);
      await expect(svc.upsertIssue('c', 's', { code: 'LEAK', name: 'Leak' } as any)).rejects.toBeInstanceOf(NotFoundException);
      prisma.serviceCategory.findUnique.mockResolvedValue({ id: 'c' });
      prisma.serviceIssue.upsert.mockResolvedValue({ id: 'i', isActive: true });
      await svc.upsertIssue('c', 's', { code: 'LEAK', name: ' Leak ', translations: { ur: {} }, sortOrder: 1, isActive: false } as any);
      expect(prisma.serviceIssue.upsert.mock.calls[0][0].create.name).toBe('Leak');
    });

    it('price band: min must not exceed max; creates, then updates the same band', async () => {
      await expect(svc.savePriceBand('s', { categoryId: 'c', city: 'K', currency: 'PKR', minMinor: 10, maxMinor: 5 } as any)).rejects.toMatchObject({ response: { code: 'MIN_ABOVE_MAX' } });
      prisma.priceBand.findFirst.mockResolvedValueOnce(null);
      prisma.priceBand.create.mockResolvedValue({ id: 'b1' });
      await svc.savePriceBand('s', { categoryId: 'c', city: ' Karachi ', currency: 'PKR', minMinor: 1, maxMinor: 5 } as any);
      expect(prisma.priceBand.create.mock.calls[0][0].data).toMatchObject({ city: 'Karachi', approved: false, issueCode: null });
      prisma.priceBand.findFirst.mockResolvedValueOnce({ id: 'b1' });
      prisma.priceBand.update.mockResolvedValue({ id: 'b1' });
      await svc.savePriceBand('s', { categoryId: 'c', city: 'Karachi', currency: 'PKR', minMinor: 1, maxMinor: 5, approved: true } as any);
      expect(prisma.priceBand.update).toHaveBeenCalled();
    });
  });

  describe('country settings & flags', () => {
    const dto: any = {
      baseVersion: 3, commission: { rateBps: 1200, minMinor: 100, maxMinor: 1500 }, cashLimits: { softMinor: 3000, hardMinor: 5000 },
      settlementRails: [{ code: 'BANK', account: undefined }], emergencyNumbers: [{ label: 'Police', number: '15' }],
    };

    it('reads: 404 for an unknown country; includes version history', async () => {
      prisma.countryConfig.findUnique.mockResolvedValue(null);
      await expect(svc.countryConfig('pk')).rejects.toBeInstanceOf(NotFoundException);
      prisma.countryConfig.findUnique.mockResolvedValue({ countryCode: 'PK', version: 3 });
      prisma.countryConfigVersion.findMany.mockResolvedValue([{ version: 2 }]);
      expect((await svc.countryConfig('pk')).versions).toEqual([{ version: 2 }]);
    });

    it('validates before writing', async () => {
      await expect(svc.saveCountryConfig('pk', 's', { ...dto, commission: { ...dto.commission, minMinor: 9999 } })).rejects.toMatchObject({ response: { code: 'COMMISSION_MIN_ABOVE_MAX' } });
      await expect(svc.saveCountryConfig('pk', 's', { ...dto, cashLimits: { softMinor: 9, hardMinor: 1 } })).rejects.toMatchObject({ response: { code: 'SOFT_ABOVE_HARD' } });
      await expect(svc.saveCountryConfig('pk', 's', { ...dto, emergencyNumbers: [] })).rejects.toMatchObject({ response: { code: 'NO_EMERGENCY_NUMBERS' } });
    });

    it('saves a new version, keeps the old one, refreshes the cache and audits', async () => {
      prisma.countryConfig.findUnique.mockResolvedValue({ countryCode: 'PK', version: 3, commission: {}, cashLimits: {}, settlementRails: [], emergencyNumbers: [] });
      prisma.countryConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.countryConfig.findUniqueOrThrow.mockResolvedValue({ countryCode: 'PK', version: 4 });
      const out = await svc.saveCountryConfig('pk', 's1', dto);
      expect(out.version).toBe(4);
      expect(prisma.countryConfig.updateMany.mock.calls[0][0].where).toEqual({ countryCode: 'PK', version: 3 });
      expect(prisma.countryConfigVersion.upsert).toHaveBeenCalled();
      expect(prisma.countryConfigVersion.create.mock.calls[0][0].data).toMatchObject({ version: 4, editedById: 's1' });
      expect(countries.invalidate).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'config.country_saved' }));
    });

    it('refuses a stale save and an unconfigured country', async () => {
      prisma.countryConfig.findUnique.mockResolvedValue({ countryCode: 'PK', version: 5 });
      prisma.countryConfig.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.saveCountryConfig('pk', 's', dto)).rejects.toMatchObject({ response: { code: 'CONFIG_CHANGED' } });
      prisma.countryConfig.findUnique.mockResolvedValue(null);
      await expect(svc.saveCountryConfig('pk', 's', dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('flags: only known ones can be set, and the change is audited', async () => {
      await expect(svc.setFlag('nope', 's', true)).rejects.toBeInstanceOf(NotFoundException);
      const { FLAGS } = require('../common/flags/feature-flags.service');
      const key = Object.keys(FLAGS)[0];
      expect(await svc.setFlag(key, 's', true)).toEqual({ key, value: true });
      expect(flags.set).toHaveBeenCalledWith(key, true, 's');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'config.flag_set' }));
    });
  });
});
