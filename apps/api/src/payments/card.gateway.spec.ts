import { createHmac } from 'crypto';
import { NoCardGateway, StripeGateway } from './card.gateway';

const config = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test' };
const NOW = 1_800_000_000_000;

const sign = (body: string, t = NOW / 1000, secret = config.webhookSecret) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const session = (over: Record<string, unknown> = {}, type = 'checkout.session.completed') =>
  JSON.stringify({ type, data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 500000, currency: 'pkr', ...over } } });

describe('StripeGateway', () => {
  const gateway = (fetcher: any = jest.fn()) => new StripeGateway(config, fetcher, () => NOW);

  it('starts a hosted checkout with an idempotency key and the exact amount', async () => {
    const fetcher = jest.fn(async (_u: any, _i: any) => ({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://pay.example/cs_1' }) }));
    const out = await gateway(fetcher).createCheckout({ amountMinor: 500000, currency: 'PKR', description: 'Stage 1', reference: 'ms1', idempotencyKey: 'fund:ms1:1', returnUrl: 'https://api/return', expiresInMinutes: 5 });
    expect(out).toEqual({ providerRef: 'cs_1', url: 'https://pay.example/cs_1', expiresAt: new Date(NOW + 31 * 60_000) });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.headers['Idempotency-Key']).toBe('fund:ms1:1');
    const form = new URLSearchParams(init.body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('500000');
    expect(form.get('line_items[0][price_data][currency]')).toBe('pkr');
    expect(form.get('success_url')).toBe('https://api/return?status=success');
  });

  it('turns provider failures into a plain message', async () => {
    const fetcher = jest.fn(async () => ({ ok: false, status: 402, json: async () => ({ error: { code: 'x' } }) }));
    await expect(gateway(fetcher).refund({ providerPaymentId: 'pi_1', amountMinor: 1, idempotencyKey: 'k' })).rejects.toMatchObject({ response: { code: 'CARD_PROVIDER_ERROR' } });
  });

  it('accepts a genuine paid event', () => {
    const body = session();
    expect(gateway().parseWebhook(Buffer.from(body), sign(body))).toEqual({ type: 'PAID', providerRef: 'cs_1', providerPaymentId: 'pi_1', amountMinor: 500000, currency: 'PKR' });
  });

  it('rejects a missing, forged, tampered or stale signature', () => {
    const body = session();
    const g = gateway();
    expect(g.parseWebhook(Buffer.from(body), undefined)).toBeNull();
    expect(g.parseWebhook(Buffer.from(body), sign(body, NOW / 1000, 'whsec_other'))).toBeNull();
    expect(g.parseWebhook(Buffer.from(body.replace('500000', '1')), sign(body))).toBeNull();
    expect(g.parseWebhook(Buffer.from(body), sign(body, NOW / 1000 - 3600))).toBeNull();
    expect(g.parseWebhook(Buffer.from(body), 't=abc,v1=zz')).toBeNull();
  });

  it('waits for the money, and reports expiry and failure', () => {
    const g = gateway();
    const unpaid = session({ payment_status: 'unpaid' });
    expect(g.parseWebhook(Buffer.from(unpaid), sign(unpaid))).toBe('IGNORED');
    const expired = session({}, 'checkout.session.expired');
    expect(g.parseWebhook(Buffer.from(expired), sign(expired))).toEqual({ type: 'EXPIRED', providerRef: 'cs_1' });
    const failed = session({}, 'checkout.session.async_payment_failed');
    expect(g.parseWebhook(Buffer.from(failed), sign(failed))).toEqual({ type: 'FAILED', providerRef: 'cs_1' });
    const other = session({}, 'customer.created');
    expect(g.parseWebhook(Buffer.from(other), sign(other))).toBe('IGNORED');
  });
});

describe('NoCardGateway', () => {
  it('says honestly that cards are unavailable', async () => {
    await expect(new NoCardGateway().createCheckout()).rejects.toMatchObject({ response: { code: 'CARD_UNAVAILABLE' } });
  });
});
