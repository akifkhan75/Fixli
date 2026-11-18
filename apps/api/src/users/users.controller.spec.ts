import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { DataExportService } from './data-export.service';
import { UsersService } from './users.service';
import { AccountDeletionService } from './account-deletion.service';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

describe('UsersController', () => {
  let controller: UsersController;
  const svc = { findAll: jest.fn(), findById: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: svc }, { provide: AccountDeletionService, useValue: {} }, { provide: DataExportService, useValue: { export: jest.fn() } }],
    }).compile();
    controller = module.get(UsersController);
  });
  afterEach(() => jest.resetAllMocks());

  it('listing all users is admin-only (not public)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.findAll)).toEqual(['admin']);
  });

  it('a user can read themselves', async () => {
    svc.findById.mockResolvedValue({ id: 'u1' });
    await expect(controller.findOne('u1', 'u1', 'customer')).resolves.toEqual({ id: 'u1' });
  });

  it("a user cannot read someone else's record", () => {
    expect(() => controller.findOne('u2', 'u1', 'customer')).toThrow(NotFoundException);
    expect(svc.findById).not.toHaveBeenCalled();
  });

  it('an admin can read anyone', async () => {
    svc.findById.mockResolvedValue({ id: 'u2' });
    await controller.findOne('u2', 'a1', 'admin');
    expect(svc.findById).toHaveBeenCalledWith('u2');
  });
});
