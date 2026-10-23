import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveLocationService } from './live-location.service';
import { ROUTING_PROVIDER, StraightLineRouting } from './routing.provider';

@Global()
@Module({
  providers: [
    LiveLocationService,
    { provide: ROUTING_PROVIDER, inject: [ConfigService], useFactory: (c: ConfigService) => new StraightLineRouting(Number(c.get('AVG_TRAVEL_SPEED_KMH') ?? 20)) },
  ],
  exports: [LiveLocationService],
})
export class TrackingModule {}
