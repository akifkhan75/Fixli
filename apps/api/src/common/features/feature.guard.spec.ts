import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard, RequiresFeature } from './feature.guard';

describe('FeatureGuard', () => {
  @RequiresFeature('properties')
  class Gated { handler() {} }
  class Open { handler() {} }
  const ctx = (cls: any) => ({ getHandler: () => cls.prototype.handler, getClass: () => cls }) as any;
  const guard = (on: string[]) => new FeatureGuard(new Reflector(), { get: () => on } as any);

  it('lets ungated routes through', () => expect(guard([]).canActivate(ctx(Open))).toBe(true));
  it('hides a gated route (404) when the feature is off', () => expect(() => guard([]).canActivate(ctx(Gated))).toThrow(NotFoundException));
  it('hides it when only other features are on', () => expect(() => guard(['recurring_jobs']).canActivate(ctx(Gated))).toThrow(NotFoundException));
  it('allows it once enabled', () => expect(guard(['properties']).canActivate(ctx(Gated))).toBe(true));
});
