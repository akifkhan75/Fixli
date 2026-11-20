import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { SweeperService } from './sweeper.service';

@Module({
  providers: [MatchingService, SweeperService],
  exports: [MatchingService, SweeperService],
})
export class MatchingModule {}
