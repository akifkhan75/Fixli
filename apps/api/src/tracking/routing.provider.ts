/** Travel-time estimate between two points. Swappable for a real routing API later. */
export interface RoutingProvider {
  readonly name: string;
  etaMinutes(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): Promise<number | null>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.latitude - a.latitude);
  const dLng = r(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line distance x 1.3 (roads aren't straight) at an average city speed. Shown to people
 * as "about N min", never as an exact arrival time.
 */
export class StraightLineRouting implements RoutingProvider {
  readonly name = 'straight-line';
  constructor(private readonly kmh: number) {}

  async etaMinutes(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
    const km = haversineKm(from, to) * 1.3;
    return Math.max(1, Math.round((km / this.kmh) * 60));
  }
}
