import { Logger } from '@nestjs/common';
import type { SmsProvider } from './sms.provider';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Either a sending number in E.164 form or a Messaging Service id (MG…). */
  from: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Real text messages through Twilio's REST API (no SDK needed). Works the same with test
 * credentials. Message text and full numbers are never logged: one-time codes pass through here.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  readonly configured = true;
  private readonly logger = new Logger('SmsProvider');

  constructor(private readonly config: TwilioConfig, private readonly fetcher: typeof fetch = fetch) {}

  async send(toE164: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const body = new URLSearchParams({ To: toE164, Body: text });
    body.set(this.config.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', this.config.from);
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    try {
      const res = await this.fetcher(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      // Twilio's numeric error code is enough to debug and carries no personal data.
      const code = ((await res.json().catch(() => null)) as { code?: number } | null)?.code;
      const error = `TWILIO_${res.status}${code ? `_${code}` : ''}`;
      this.logger.error(`SMS to ***${toE164.slice(-3)} failed: ${error}`);
      return { ok: false, error };
    } catch (e) {
      this.logger.error(`SMS to ***${toE164.slice(-3)} failed: ${(e as Error).name}`);
      return { ok: false, error: 'TWILIO_UNREACHABLE' };
    }
  }
}
