jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { Analytics, type AnalyticsProvider } from '../services/analytics';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } };
};
const provider = () => { const sent: any[] = []; const p: AnalyticsProvider = { capture: async (event, props, id) => { sent.push({ event, props, id }); } }; return { p, sent }; };

describe('Analytics', () => {
  it('sends nothing until the person agrees', async () => {
    const { p, sent } = provider();
    const a = new Analytics(p, memory() as any);
    await a.track('app_open');
    expect(sent).toEqual([]);
    await a.setConsent(true);
    await a.track('app_open');
    expect(sent).toHaveLength(1);
  });

  it('sends nothing when no provider is configured', async () => {
    const s = memory();
    const a = new Analytics(null, s as any);
    await a.setConsent(true);
    await a.track('app_open');
    expect(s.m.get('@fixli_analytics_id')).toBeUndefined();
  });

  it('strips everything off the allow-list, even if the code passes it by mistake', async () => {
    const { p, sent } = provider();
    const a = new Analytics(p, memory() as any);
    await a.setConsent(true);
    await a.track('request_sent', { time_ms: 30_000, used_photo: true, phone: '+923001234567', address: 'x', latitude: 24, message: 'hi' } as any);
    expect(sent[0].props).toEqual({ time_ms: 30_000, used_photo: true });
    expect(JSON.stringify(sent)).not.toMatch(/923001234567|latitude|message|address/);
    await a.track('some_other_event' as any, { text: 'hi' });
    expect(sent).toHaveLength(1);
  });

  it('uses a random id kept on the phone, and forgets it when consent is withdrawn', async () => {
    const { p, sent } = provider();
    const s = memory();
    const a = new Analytics(p, s as any);
    await a.setConsent(true);
    await a.track('app_open');
    await a.track('went_online');
    expect(sent[0].id).toBe(sent[1].id);
    const first = sent[0].id;
    await a.setConsent(false);
    await a.track('app_open');
    expect(sent).toHaveLength(2);
    expect(s.m.size).toBe(0);
    await a.setConsent(true);
    await a.track('app_open');
    expect(sent[2].id).not.toBe(first);
  });

  it('a failing provider never throws into the app', async () => {
    const a = new Analytics({ capture: async () => { throw new Error('offline'); } }, memory() as any);
    await a.setConsent(true);
    await expect(a.track('app_open')).resolves.toBeUndefined();
  });
});
