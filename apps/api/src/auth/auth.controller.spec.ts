import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { StaffTwoFactorService } from './staff-two-factor.service';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

describe('AuthController', () => {
  let controller: AuthController;
  const svc = {
    signup: jest.fn(), login: jest.fn(), adminLogin: jest.fn(), refresh: jest.fn(), logout: jest.fn(),
    me: jest.fn(), listSessions: jest.fn(), revokeSession: jest.fn(), changePassword: jest.fn(),
  };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: svc }, { provide: StaffTwoFactorService, useValue: {} }],
    }).compile();
    controller = mod.get(AuthController);
  });
  afterEach(() => jest.resetAllMocks());

  it('only the credential endpoints are public', () => {
    const isPublic = (fn: Function) => Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true;
    for (const fn of ['signup', 'login', 'adminLogin', 'refresh', 'beginTotp', 'activateTotp'] as const) {
      expect(isPublic(AuthController.prototype[fn])).toBe(true);
    }
    for (const fn of ['logout', 'me', 'sessions', 'revokeSession', 'changePassword'] as const) {
      expect(isPublic(AuthController.prototype[fn])).toBe(false);
    }
  });

  it('logout and password change act on the caller\'s own session', async () => {
    svc.logout.mockResolvedValue({ success: true });
    await controller.logout('u1', 's1');
    expect(svc.logout).toHaveBeenCalledWith('u1', 's1');
    await controller.changePassword('u1', 's1', { currentPassword: 'a', newPassword: 'b' });
    expect(svc.changePassword).toHaveBeenCalledWith('u1', 's1', { currentPassword: 'a', newPassword: 'b' });
  });
});
