import { createHmac, timingSafeEqual } from 'crypto';
import { Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Card payments for project stages. The customer pays on the provider's own hosted page, so card
 * numbers never touch Fixli. Money arrives in Fixli's account and is held until the stage is
 * approved (the professional is then credited on their ledger), or refunded.
 */
export interface CardGateway {
  readonly name: string;
  readonly configured: boolean;
  createCheckout(args: {
    amountMinor: number; currency: string; description: string; reference: string;
    idempotencyKey: string; returnUrl: string; expiresInMinutes: number;
  }): Promise<{ providerRef: string; url: string; expiresAt: Date }>;
  refund(args: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }): Promise<void>;
  /** null: not genuinely from the provider. IGNORED: genuine, but nothing for us to do. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): CardEvent | 'IGNORED' | null;
}

export type CardEvent =
  | { type: 'PAID'; providerRef: string; providerPaymentId: string; amountMinor: number; currency: string }
  | { type: 'FAILED' | 'EXPIRED'; providerRef: string };

export const CARD_GATEWAY = Symbol('CARD_GATEWAY');

export class NoCardGateway implements CardGateway {
  readonly name = 'none';
  readonly configured = false;
  private refuse(): never {
    throw new ServiceUnavailableException({ code: 'CARD_UNAVAILABLE', message: 'Card payments are not available yet. Choose to pay the professional directly.' });
  }
  async createCheckout(): Promise<never> { return this.refuse(); }
  async refund(): Promise<never> { return this.refuse(); }
  parseWebhook() { return null; }
}

const SIGNATURE_TOLERANCE_SECONDS = 300;
const TIMEOUT_MS = 15_000;

/** Stripe Checkout through the REST API. Test keys (sk_test_…) behave like live ones with test cards. */
export class StripeGateway implements CardGateway {
  readonly name = 'stripe';
  readonly configured = true;
  private readonly logger = new Logger('StripeGateway');

  constructor(
    private readonly config: { secretKey: string; webhookSecret: string },
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async post(path: string, form: Record<string, string>, idempotencyKey: string): Promise<any> {
    let res: Response;
    try {
      res = await this.fetcher(`https://api.stripe.com/v1/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.error(`Stripe ${path} unreachable: ${(e as Error).name}`);
      throw new ServiceUnavailableException({ code: 'CARD_PROVIDER_DOWN', message: 'The card service did not answer. Please try again.' });
    }
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body) {
      this.logger.error(`Stripe ${path} failed: ${res.status} ${body?.error?.code ?? body?.error?.type ?? ''}`);
      throw new ServiceUnavailableException({ code: 'CARD_PROVIDER_ERROR', message: 'The card payment could not be started. Please try again.' });
    }
    return body;
  }

  async createCheckout(a: Parameters<CardGateway['createCheckout']>[0]) {
    // Stripe accepts an expiry between 30 minutes and 24 hours from now.
    const minutes = Math.min(Math.max(a.expiresInMinutes, 31), 23 * 60);
    const expiresAt = Math.floor(this.now() / 1000) + minutes * 60;
    const back = (status: string) => `${a.returnUrl}?status=${status}`;
    const session = await this.post('checkout/sessions', {
      mode: 'payment',
      client_reference_id: a.reference,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': a.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(a.amountMinor),
      'line_items[0][price_data][product_data][name]': a.description.slice(0, 120),
      'payment_intent_data[metadata][reference]': a.reference,
      success_url: back('success'),
      cancel_url: back('cancelled'),
      expires_at: String(expiresAt),
    }, a.idempotencyKey);
    return { providerRef: String(session.id), url: String(session.url), expiresAt: new Date(expiresAt * 1000) };
  }

  async refund(a: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }) {
    await this.post('refunds', { payment_intent: a.providerPaymentId, amount: String(a.amountMinor) }, a.idempotencyKey);
  }

  /** Checks `Stripe-Signature` (HMAC-SHA256 of "timestamp.body") and rejects old deliveries. */
  private genuine(rawBody: Buffer, header: string): boolean {
    const parts = header.split(',').map((p) => p.split('=', 2) as [string, string]);
    const t = Number(parts.find(([k]) => k === 't')?.[1]);
    if (!Number.isFinite(t) || Math.abs(this.now() / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
    const expected = createHmac('sha256', this.config.webhookSecret).update(`${t}.`).update(rawBody).digest();
    return parts.some(([k, v]) => {
      if (k !== 'v1' || !v) return false;
      const given = Buffer.from(v, 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): CardEvent | 'IGNORED' | null {
    if (!signature || !this.genuine(rawBody, signature)) return null;
    let event: any;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { return null; }
    const s = event?.data?.object;
    if (!s?.id) return 'IGNORED';
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        // A completed session may still be waiting for the money (bank debits): act only once paid.
        if (s.payment_status !== 'paid' || !s.payment_intent) return 'IGNORED';
        return { type: 'PAID', providerRef: s.id, providerPaymentId: String(s.payment_intent), amountMinor: Number(s.amount_total), currency: String(s.currency).toUpperCase() };
      case 'checkout.session.async_payment_failed':
        return { type: 'FAILED', providerRef: s.id };
      case 'checkout.session.expired':
        return { type: 'EXPIRED', providerRef: s.id };
      default:
        return 'IGNORED';
    }
  }
}
