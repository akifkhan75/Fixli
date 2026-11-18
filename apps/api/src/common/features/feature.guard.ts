import { CanActivate, ExecutionContext, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

/** Roadmap features whose API exists but has no finished app behind it (doc 27 R6). Off unless enabled. */
export const FEATURES = ['recurring_jobs', 'properties', 'service_packages', 'subscriptions'] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_KEY = 'feature';
/** Hides the route (404, as if it did not exist) unless the feature is listed in ENABLED_FEATURES. */
export const RequiresFeature = (f: Feature) => SetMetadata(FEATURE_KEY, f);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, [context.getHandler(), context.getClass()]);
    if (!feature) return true;
    const on = this.config.get<string[]>('ENABLED_FEATURES') ?? [];
    if (on.includes(feature)) return true;
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
  }
}
