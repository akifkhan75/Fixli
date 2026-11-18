import { Global, Module } from '@nestjs/common';
import { LoggingSmsProvider, SMS_PROVIDER } from '../safety/sms.provider';

/** One SMS adapter for the whole app (SOS alerts, OTP codes). A real gateway replaces the factory (doc 25 O5). */
@Global()
@Module({
  providers: [{ provide: SMS_PROVIDER, useFactory: () => new LoggingSmsProvider(process.env.NODE_ENV === 'production') }],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
