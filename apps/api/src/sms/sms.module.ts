import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggingSmsProvider, SMS_PROVIDER, SmsProvider } from '../safety/sms.provider';
import { TwilioSmsProvider } from '../safety/twilio-sms.provider';

export function createSmsProvider(config: ConfigService): SmsProvider {
  if (config.get('SMS_PROVIDER') === 'twilio') {
    return new TwilioSmsProvider({
      accountSid: config.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
      authToken: config.getOrThrow<string>('TWILIO_AUTH_TOKEN'),
      from: config.getOrThrow<string>('TWILIO_FROM'),
    });
  }
  return new LoggingSmsProvider(config.get('NODE_ENV') === 'production');
}

/** One SMS adapter for the whole app (SOS alerts, OTP codes), chosen by SMS_PROVIDER. */
@Global()
@Module({
  providers: [{ provide: SMS_PROVIDER, inject: [ConfigService], useFactory: createSmsProvider }],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
