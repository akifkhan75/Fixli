import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { NotificationService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ExpoPushProvider, PUSH_PROVIDER } from './push.provider';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        new ExpoPushProvider(c.get<string>('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push/send', c.get<string>('EXPO_ACCESS_TOKEN')),
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
