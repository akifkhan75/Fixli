import { SafetyController } from './safety.controller';

describe('SafetyController', () => {
  it('passes the caller (never a client-chosen user) to the service', async () => {
    const safety: any = { raiseSos: jest.fn(), emergencyNumbers: jest.fn() };
    const c = new SafetyController(safety);
    await c.sos({ id: 'u1', type: 'customer' }, { kind: 'LIFE_THREATENING', idempotencyKey: 'k' });
    expect(safety.raiseSos).toHaveBeenCalledWith({ id: 'u1', type: 'customer' }, { kind: 'LIFE_THREATENING', idempotencyKey: 'k' });
    await c.numbers('u1');
    expect(safety.emergencyNumbers).toHaveBeenCalledWith('u1');
  });
});
