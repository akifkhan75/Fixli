import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { OffersController } from './offers.controller';

describe('OffersController', () => {
  const service = { feed: jest.fn(), submit: jest.fn(), withdraw: jest.fn(), notInterested: jest.fn(), listForCustomer: jest.fn(), accept: jest.fn() };
  const c = new OffersController(service as any);
  const reflector = new Reflector();
  const rolesOf = (fn: (...a: any[]) => any) => reflector.get(ROLES_KEY, fn);

  it('workers send, change and withdraw prices; customers list and accept them (no one else)', () => {
    expect(rolesOf(c.feed)).toEqual(['worker']);
    expect(rolesOf(c.submit)).toEqual(['worker']);
    expect(rolesOf(c.withdraw)).toEqual(['worker']);
    expect(rolesOf(c.notInterested)).toEqual(['worker']);
    expect(rolesOf(c.list)).toEqual(['customer']);
    expect(rolesOf(c.accept)).toEqual(['customer']);
  });

  it('passes the signed-in user\'s id, never one from the request body', () => {
    c.feed('w1'); c.submit('w1', 'j1', { amount: 1 } as any); c.withdraw('w1', 'j1'); c.notInterested('w1', 'j1');
    c.list('c1', 'j1'); c.accept('c1', 'o1');
    expect(service.feed).toHaveBeenCalledWith('w1');
    expect(service.submit).toHaveBeenCalledWith('w1', 'j1', { amount: 1 });
    expect(service.withdraw).toHaveBeenCalledWith('w1', 'j1');
    expect(service.notInterested).toHaveBeenCalledWith('w1', 'j1');
    expect(service.listForCustomer).toHaveBeenCalledWith('c1', 'j1');
    expect(service.accept).toHaveBeenCalledWith('c1', 'o1');
  });
});
