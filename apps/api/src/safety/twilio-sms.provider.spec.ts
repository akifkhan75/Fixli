import { TwilioSmsProvider } from './twilio-sms.provider';

const config = { accountSid: 'AC123', authToken: 'token', from: '+15005550006' };

describe('TwilioSmsProvider', () => {
  it('posts the message with basic auth and reports success', async () => {
    const fetcher = jest.fn(async (_url: any, _init?: any) => ({ ok: true, status: 201, json: async () => ({}) }) as Response);
    const sms = new TwilioSmsProvider(config, fetcher as any);
    await expect(sms.send('+923001234567', 'Code 123456')).resolves.toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:token').toString('base64')}`);
    const sent = new URLSearchParams(init.body);
    expect(Object.fromEntries(sent)).toEqual({ To: '+923001234567', Body: 'Code 123456', From: '+15005550006' });
  });

  it('uses a messaging service when given its id', async () => {
    const fetcher = jest.fn(async (_url: any, _init?: any) => ({ ok: true, status: 201, json: async () => ({}) }) as Response);
    await new TwilioSmsProvider({ ...config, from: 'MG999' }, fetcher as any).send('+923001234567', 'hi');
    const sent = new URLSearchParams(fetcher.mock.calls[0][1].body);
    expect(sent.get('MessagingServiceSid')).toBe('MG999');
    expect(sent.get('From')).toBeNull();
  });

  it('never claims delivery when Twilio refuses or cannot be reached', async () => {
    const refused = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ code: 21211 }) }) as Response);
    await expect(new TwilioSmsProvider(config, refused as any).send('+92300', 'x')).resolves.toEqual({ ok: false, error: 'TWILIO_400_21211' });
    const down = jest.fn(async () => { throw new Error('network'); });
    await expect(new TwilioSmsProvider(config, down as any).send('+92300', 'x')).resolves.toEqual({ ok: false, error: 'TWILIO_UNREACHABLE' });
  });
});
