import { Test, TestingModule } from '@nestjs/testing';
import { ChangeOrdersService } from './change-orders.service';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ConflictException } from '@nestjs/common';

describe('ChangeOrdersService', () => {
  let service: ChangeOrdersService;

  const mockPrisma: any = {
    changeOrder: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  };
  const mockStorage = { consume: jest.fn(), signedUrlForKey: jest.fn(async (k: string) => `https://signed/${k}`) };

  const mockAccess = {
    requireAssignedWorker: jest.fn(),
    requireParticipant: jest.fn(),
  };

  const mockAudit = {
    record: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangeOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JobAccessService, useValue: mockAccess },
        { provide: AuditService, useValue: mockAudit },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get<ChangeOrdersService>(ChangeOrdersService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    mockStorage.signedUrlForKey.mockImplementation(async (k: string) => `https://signed/${k}`);
  });

  describe('create', () => {
    it('creates a change order if job is EN_ROUTE, ARRIVED, or IN_PROGRESS', async () => {
      mockAccess.requireAssignedWorker.mockResolvedValue({ status: 'IN_PROGRESS' });
      mockPrisma.changeOrder.create.mockResolvedValue({ id: 'co1', mediaKeys: [] });

      const dto = {
        jobRequestId: 'j1',
        reason: 'Extra scope',
        addedScope: 'Clean up',
        revisedPrice: 15000,
      };

      const result = await service.create('w1', dto);
      expect(result.id).toBe('co1');
      expect(mockPrisma.changeOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'PENDING',
          mediaKeys: [],
        }),
      });
    });

    it('throws ConflictException if job is not active', async () => {
      mockAccess.requireAssignedWorker.mockResolvedValue({ status: 'COMPLETED' });

      const dto = {
        jobRequestId: 'j1',
        reason: 'Extra scope',
        addedScope: 'Clean up',
        revisedPrice: 15000,
      };

      await expect(service.create('w1', dto)).rejects.toThrow(ConflictException);
    });

    it('photos must be the worker\'s own uploads; the response has signed links, never keys', async () => {
      mockAccess.requireAssignedWorker.mockResolvedValue({ status: 'IN_PROGRESS' });
      mockStorage.consume.mockResolvedValue(['job-photos/k1.jpg']);
      mockPrisma.changeOrder.create.mockImplementation(async ({ data }: any) => ({ id: 'co2', ...data }));
      const result: any = await service.create('w1', { jobRequestId: 'j1', reason: 'r', addedScope: 's', revisedPrice: 100, photoUploadIds: ['up1'] });
      expect(mockStorage.consume).toHaveBeenCalledWith('w1', ['up1'], 'JOB_PHOTO', mockPrisma);
      expect(result.photos).toEqual(['https://signed/job-photos/k1.jpg']);
      expect(result.mediaKeys).toBeUndefined();
    });
  });
});
