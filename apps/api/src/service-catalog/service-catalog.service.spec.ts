import { NotFoundException } from '@nestjs/common';
import { ServiceCatalogService } from './service-catalog.service';

describe('ServiceCatalogService', () => {
  const prisma: any = {
    serviceCategory: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    service: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const svc = new ServiceCatalogService(prisma, audit as any);
  beforeEach(() => jest.resetAllMocks());

  it('customers see active categories, services and issues only; staff can ask for everything', async () => {
    await svc.getAllCategories();
    expect(prisma.serviceCategory.findMany.mock.calls[0][0]).toMatchObject({ where: { isActive: true }, include: { services: { where: { isActive: true } }, issues: { where: { isActive: true } } } });
    await svc.getAllCategories(true);
    const all = prisma.serviceCategory.findMany.mock.calls[1][0];
    expect(all.where).toBeUndefined();
    expect(all.include.services.where).toBeUndefined();
  });

  it('a single category must be active; unknown is 404', async () => {
    prisma.serviceCategory.findFirst.mockResolvedValueOnce({ id: 'c' });
    expect(await svc.getCategoryById('c')).toEqual({ id: 'c' });
    expect(prisma.serviceCategory.findFirst.mock.calls[0][0].where).toEqual({ id: 'c', isActive: true });
    prisma.serviceCategory.findFirst.mockResolvedValueOnce(null);
    await expect(svc.getCategoryById('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('every staff change is audited with who and what', async () => {
    prisma.serviceCategory.create.mockResolvedValue({ id: 'c1' });
    await svc.createCategory({ name: 'Plumbing' } as any, 's1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 's1', action: 'catalog.category_created', entityId: 'c1' }));

    prisma.serviceCategory.findUnique.mockResolvedValueOnce({ id: 'c1', name: 'Old' });
    prisma.serviceCategory.update.mockResolvedValue({ id: 'c1' });
    await svc.updateCategory('c1', { name: 'New' } as any, 's1');
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'catalog.category_updated', before: { id: 'c1', name: 'Old' } }));

    prisma.serviceCategory.findUnique.mockResolvedValueOnce({ id: 'c1' });
    prisma.service.create.mockResolvedValue({ id: 'sv1' });
    await svc.addServiceToCategory('c1', { name: 'Tap' } as any, 's1');
    expect(prisma.service.create.mock.calls[0][0].data).toEqual({ name: 'Tap', categoryId: 'c1' });

    prisma.service.findUnique.mockResolvedValueOnce({ id: 'sv1' });
    prisma.service.update.mockResolvedValue({ id: 'sv1' });
    await svc.updateService('sv1', { isActive: false } as any, 's1');
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'catalog.service_updated' }));
  });

  it('changing something that does not exist is 404 and writes nothing', async () => {
    prisma.serviceCategory.findUnique.mockResolvedValue(null);
    prisma.service.findUnique.mockResolvedValue(null);
    await expect(svc.updateCategory('x', {} as any, 's')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addServiceToCategory('x', {} as any, 's')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updateService('x', {} as any, 's')).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
