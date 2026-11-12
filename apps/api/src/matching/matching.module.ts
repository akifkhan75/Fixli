import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { MatchingService } from './matching.service';
import { PaymentsModule } from '../payments/payments.module';
import { SweeperService } from './sweeper.service';

@Module({
  imports: [ChatModule, PaymentsModule],
  providers: [MatchingService, SweeperService],
  exports: [MatchingService, SweeperService],
})
export class MatchingModule {}
