import type { colors } from '../theme';

type Tints = typeof colors.category;

/** Catalog keys (apps/api/prisma/catalog-data.ts) to tint names. */
const BY_CODE: Record<string, keyof Tints> = {
  HVAC: 'hvac',
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  APPLIANCE_REPAIR: 'mechanics',
  CARPENTRY: 'carpentry',
  PAINTING: 'painting',
  CLEANING: 'cleaning',
  GENERAL_HANDYMAN: 'generalHandyman',
  LOCKSMITH: 'carServices',
  INSTALLATION: 'security',
  CONSTRUCTION: 'construction',
  RENOVATION: 'renovation',
  MASONRY: 'masonry',
  WELDING: 'welding',
  FLOORING: 'flooring',
  ROOFING: 'roofing',
  SOLAR: 'solar',
  INTERIOR: 'interior',
  GARDENING: 'gardening',
  AUTOMOTIVE: 'carServices',
  PEST_CONTROL: 'pestControl',
  MOVERS: 'moving',
  WATER_SUPPLY: 'waterSupply',
  CCTV_SECURITY: 'security',
  GENERATOR_UPS: 'generator',
  IT_SUPPORT: 'itSupport',
  GAS_SERVICES: 'gas',
  SALON_BEAUTY: 'salon',
  TUTORING: 'tutoring',
  HEALTHCARE_AT_HOME: 'healthcare',
};

/** A trade's colour; categories added by staff later fall back to the brand blue. */
export function categoryTint(code: string | null | undefined, tints: Tints): string {
  return tints[(code && BY_CODE[code]) || 'other'];
}
