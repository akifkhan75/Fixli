import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

export const THROTTLE_STORAGE = 'THROTTLE_STORAGE';

/**
 * Owns the Redis connection for rate limits as a real provider, so Nest closes it on shutdown
 * (a connection created inside a factory is never told to close and keeps the process alive).
 * With no REDIS_URL the value is undefined and the throttler keeps its counts in memory.
 */
@Module({
  providers: [{ provide: THROTTLE_STORAGE, inject: [ConfigService], useFactory: (c: ConfigService) => (c.get<string>('REDIS_URL') ? new RedisThrottlerStorage(c.get<string>('REDIS_URL')!) : undefined) }],
  exports: [THROTTLE_STORAGE],
})
export class ThrottleStorageModule {}
