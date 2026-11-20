jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn() } }));
import { AnalyticsService, stripPII } from '../services/productAnalytics';

describe('analytics', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ status: 200 });
    (global as any).fetch = fetchMock;
    AnalyticsService.configure({ key: 'phc_test', host: 'https://ph.example/' });
    AnalyticsService.setEnabled(true);
    AnalyticsService.reset();
  });

  it('strips personal data, long free text and non-plain values', () => {
    const out = stripPII({
      phone: '+923001234567', email: 'a@b.c', address: 'House 12', latitude: 24.9, customerName: 'Ahmed', message: 'hi',
      description: 'my tap leaks', jobId: 'job1', category: 'PLUMBING', count: 3, urgent: true,
      note2: 'x', blob: 'z'.repeat(200), nested: { a: 1 },
    });
    expect(out).toEqual({ jobId: 'job1', category: 'PLUMBING', count: 3, urgent: true });
  });

  it('sends nothing without a key', async () => {
    AnalyticsService.configure({ key: '' });
    AnalyticsService.track('app_open');
    await AnalyticsService.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('batches events to the configured host with the pseudonymous id, never PII', async () => {
    AnalyticsService.identify('user_1', 'customer');
    AnalyticsService.track('job_submitted', { phone: '0300', category: 'PLUMBING' });
    await AnalyticsService.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ph.example/batch/');
    const body = JSON.parse(init.body);
    expect(body.api_key).toBe('phc_test');
    expect(body.batch[0]).toMatchObject({ event: 'job_submitted', distinct_id: 'user_1', properties: { category: 'PLUMBING', user_type: 'customer' } });
    expect(JSON.stringify(body)).not.toContain('0300');
  });

  it('opt-out drops queued events and stops sending', async () => {
    AnalyticsService.track('app_open');
    AnalyticsService.setEnabled(false);
    AnalyticsService.track('app_open');
    await AnalyticsService.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a network failure never throws and the events are retried', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    AnalyticsService.track('app_open');
    await expect(AnalyticsService.flush()).resolves.toBeUndefined();
    await AnalyticsService.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
