import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** The switches staff may change without a release. Anything else is rejected. */
export const FLAGS = {
  REQUIRE_JOB_PHOTOS: { type: 'boolean', description: 'Start and Finish need a photo (or a stated reason).', env: 'REQUIRE_JOB_PHOTOS', default: true },
  SHOW_PRICE_BANDS: { type: 'boolean', description: 'Show approved price ranges on the request review screen (O1).', env: null, default: false },
} as const;
export type FlagKey = keyof typeof FLAGS;

const TTL = 30_000;

@Injectable()
export class FeatureFlagsService {
  private cache = new Map<string, { at: number; value: unknown }>();
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  /** Database value if staff set one, else the environment, else the default. */
  async get<T = unknown>(key: FlagKey): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.at > Date.now() - TTL) return hit.value as T;
    const row = await this.prisma.featureFlag.findUnique({ where: { key } });
    const def = FLAGS[key];
    const envVal = def.env ? this.config.get(def.env) : undefined;
    const value = row ? row.value : envVal !== undefined ? envVal : def.default;
    this.cache.set(key, { at: Date.now(), value });
    return value as T;
  }

  async list() {
    const rows = await this.prisma.featureFlag.findMany();
    return Promise.all((Object.keys(FLAGS) as FlagKey[]).map(async (key) => ({
      key, ...FLAGS[key], value: await this.get(key), setByStaff: rows.some((r) => r.key === key),
    })));
  }

  async set(key: FlagKey, value: boolean, staffId: string) {
    await this.prisma.featureFlag.upsert({
      where: { key }, create: { key, value: value as Prisma.InputJsonValue, updatedById: staffId }, update: { value: value as Prisma.InputJsonValue, updatedById: staffId },
    });
    this.cache.delete(key);
  }
}
