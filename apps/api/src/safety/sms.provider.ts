import { Logger } from '@nestjs/common';

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

/** Development / unconfigured fallback: logs the text (phone masked), never claims delivery. */
export class LoggingSmsProvider implements SmsProvider {
  readonly name = 'log';
  readonly configured = false;
  private readonly logger = new Logger('SmsProvider');
  constructor(private readonly production: boolean) {}
  async send(toE164: string, text: string) {
    if (this.production) this.logger.error('No SMS provider configured in production: message NOT sent.');
    else this.logger.log(`[dev] SMS to ***${toE164.slice(-3)}: ${text}`);
    return { ok: false as const, error: 'NO_PROVIDER' };
  }
}
