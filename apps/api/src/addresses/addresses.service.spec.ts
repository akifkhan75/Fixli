import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AddressesService } from './addresses.service';

describe('AddressesService', () => {
  const tx: any = { address: { count: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() } };
  const prisma: any = { address: { findMany: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)) };
  const svc = new AddressesService(prisma);
  beforeEach(() => { jest.resetAllMocks(); prisma.$transaction.mockImplementation((fn: any) => fn(tx)); });
  const dto = (o: any = {}) => ({ label: 'Home', line1: 'x', city: 'Karachi', country: 'pk', ...o }) as any;

  it('rejects half a coordinate pair', async () => {
    await expect(svc.create('u1', dto({ latitude: 24.9 }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('a1', 'u1', { longitude: 67 } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('the first address becomes the default and the country is upper-cased', async () => {
    tx.address.count.mockResolvedValue(0);
    await svc.create('u1', dto());
    expect(tx.address.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { isDefault: false } });
    expect(tx.address.create.mock.calls[0][0].data).toMatchObject({ country: 'PK', userId: 'u1', isDefault: true });
  });
  it('a later address only takes over the default when asked', async () => {
    tx.address.count.mockResolvedValue(2);
    await svc.create('u1', dto());
    expect(tx.address.updateMany).not.toHaveBeenCalled();
    expect(tx.address.create.mock.calls[0][0].data.isDefault).toBe(false);
    await svc.create('u1', dto({ isDefault: true }));
    expect(tx.address.updateMany).toHaveBeenCalled();
  });
  it('caps saved addresses at 10', async () => {
    tx.address.count.mockResolvedValue(10);
    await expect(svc.create('u1', dto())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.address.create).not.toHaveBeenCalled();
  });
  it('lists default first', async () => {
    await svc.findAll('u1');
    expect(prisma.address.findMany.mock.calls[0][0].orderBy[0]).toEqual({ isDefault: 'desc' });
  });
  it('update: 404 for someone else\'s address; making one default clears the others; cannot un-default', async () => {
    tx.address.findFirst.mockResolvedValue(null);
    await expect(svc.update('a1', 'u1', { label: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    tx.address.findFirst.mockResolvedValue({ id: 'a1' });
    await svc.update('a1', 'u1', { isDefault: true, country: 'ae' } as any);
    expect(tx.address.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', id: { not: 'a1' } }, data: { isDefault: false } });
    expect(tx.address.update.mock.calls[0][0].data).toMatchObject({ isDefault: true, country: 'AE' });
    await svc.update('a1', 'u1', { isDefault: false } as any);
    expect(tx.address.update.mock.calls[1][0].data).not.toHaveProperty('isDefault');
  });
  it('remove: 404 for others; deleting the default promotes the newest remaining', async () => {
    tx.address.findFirst.mockResolvedValueOnce(null);
    await expect(svc.remove('a1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    tx.address.findFirst.mockResolvedValueOnce({ id: 'a1', isDefault: true }).mockResolvedValueOnce({ id: 'a2' });
    await expect(svc.remove('a1', 'u1')).resolves.toEqual({ success: true });
    expect(tx.address.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(tx.address.update).toHaveBeenCalledWith({ where: { id: 'a2' }, data: { isDefault: true } });
  });
  it('remove: deleting a non-default address promotes nothing', async () => {
    tx.address.findFirst.mockResolvedValueOnce({ id: 'a1', isDefault: false });
    await svc.remove('a1', 'u1');
    expect(tx.address.update).not.toHaveBeenCalled();
  });
});
