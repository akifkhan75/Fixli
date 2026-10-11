/**
 * Text messages to phones that don't have the app: trusted-contact SOS alerts now, one-time codes
 * later (O5). The provider is a business decision (doc 25 D-F5); until it's made, NoSmsProvider
 * says honestly that nothing was sent, and the app tells the user.
 */
export interface SmsProvider {
  readonly name: string;
  readonly configured: boolean;
  send(toE164: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export class NoSmsProvider implements SmsProvider {
  readonly name = 'none';
  readonly configured = false;
  async send() {
    return { ok: false as const, error: 'NO_PROVIDER' };
  }
}
