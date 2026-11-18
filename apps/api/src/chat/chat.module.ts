import { forwardRef, Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './gateways/chat.gateway';
import { AuthModule } from '../auth/auth.module';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, forwardRef(() => NotificationsModule)],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, RealtimeService],
  exports: [ChatService, ChatGateway, RealtimeService],
})
export class ChatModule {}
