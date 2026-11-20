import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/** Global so any feature can publish live events without importing the chat module. */
@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
