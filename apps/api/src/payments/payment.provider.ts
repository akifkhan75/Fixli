/**
 * How money moves (doc 24 Phase 9). Cash is the only provider at launch (D13): the worker is paid
 * in person and Fixli records it. Card/wallet providers (JazzCash, Easypaisa, Stripe) implement
 * the same interface later, with signed webhooks and idempotency, once legal L5 is answered.
 */
export interface PaymentProvider {
  readonly method: 'CASH' | 'CARD' | 'WALLET';
  /** CASH: nothing to charge; others create an intent with the provider. */
  createIntent(args: { jobId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<{ providerRef: string | null }>;
  /** Verify a provider webhook's signature and return the event, or null if it isn't genuine. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<{ providerRef: string; status: 'CAPTURED' | 'FAILED' | 'REFUNDED' } | null>;
}

export class CashProvider implements PaymentProvider {
  readonly method = 'CASH' as const;
  async createIntent() { return { providerRef: null }; }
  async verifyWebhook() { return null; }
}
