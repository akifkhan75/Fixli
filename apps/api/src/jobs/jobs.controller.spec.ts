import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

describe('JobsController', () => {
  let controller: JobsController;
  const svc = {
    create: jest.fn(), findAll: jest.fn(), findById: jest.fn(), update: jest.fn(),
    requestWorker: jest.fn(), accept: jest.fn(), decline: jest.fn(), start: jest.fn(),
    cancel: jest.fn(), enRoute: jest.fn(), arrive: jest.fn(), finish: jest.fn(), confirm: jest.fn(), contact: jest.fn(),
  };
  const user = { id: 'u1', type: 'customer' as const, name: 'Test' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [{ provide: JobsService, useValue: svc }],
    }).compile();
    controller = module.get(JobsController);
  });
  afterEach(() => jest.resetAllMocks());

  it('passes the authenticated user (not client input) to create', async () => {
    const dto = { categoryId: 'c', addressId: 'a', when: 'NOW' as const, idempotencyKey: 'k-12345678', issueCodes: ['leaking_tap'] };
    svc.create.mockResolvedValue({ id: '1' });
    await controller.create(user, dto);
    expect(svc.create).toHaveBeenCalledWith(user, dto);
  });

  it('passes query filters to findAll', async () => {
    svc.findAll.mockResolvedValue({ items: [], nextCursor: null });
    await controller.findAll(user, { status: 'ACCEPTED', limit: 5 });
    expect(svc.findAll).toHaveBeenCalledWith(user, { status: 'ACCEPTED', limit: 5 });
  });

  it('exposes one endpoint per transition and no generic status setter', () => {
    expect((controller as any).replace).toBeUndefined();
    // The worker can't complete their own job: there is no /complete (doc 26 8.2).
    expect((controller as any).complete).toBeUndefined();
    for (const fn of ['accept', 'decline', 'enRoute', 'arrive', 'start', 'finish', 'confirm', 'cancel', 'requestWorker', 'contact']) {
      expect(typeof (controller as any)[fn]).toBe('function');
    }
  });
});
