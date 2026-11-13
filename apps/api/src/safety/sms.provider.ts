import { Logger } from '@nestjs/common';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsResult {
  /** True only when a real provider accepted the message for delivery. */
  delivered: boolean;
}

/**
 * One way to text a phone number. Shared by SOS trusted-contact alerts (R3) and OTP codes (R5).
 * A real adapter (WhatsApp / SMS gateway, doc 25 O5) plugs in here; nothing else changes.
 */
export interface SmsProvider {
  /** False for the dev logger: callers must not tell users a message was sent. */
  readonly configured: boolean;
  send(phone: string, text: string): Promise<SmsResult>;
}

/** Development / unconfigured fallback: logs the message, never claims delivery. */
export class LoggingSmsProvider implements SmsProvider {
  readonly configured = false;
  private readonly logger = new Logger('SmsProvider');

  constructor(private readonly production: boolean) {}

  async send(phone: string, text: string): Promise<SmsResult> {
    if (this.production) {
      this.logger.error('No SMS provider configured in production: message NOT sent.');
    } else {
      // Phone is masked even in dev logs.
      this.logger.log(`[dev] SMS to ***${phone.slice(-3)}: ${text}`);
    }
    return { delivered: false };
  }
}
