import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from './ai.service';

describe('AiService', () => {
  const categories = [
    { id: 'c1', name: 'PLUMBING', issues: [{ code: 'leaking_tap', name: 'Leaking tap' }, { code: 'pipe_burst', name: 'Burst pipe' }] },
    { id: 'c2', name: 'ELECTRICAL', issues: [{ code: 'no_power', name: 'No power' }] },
  ];
  const prisma: any = {
    serviceCategory: { findMany: jest.fn().mockResolvedValue(categories) },
    jobAiAnalysis: { create: jest.fn().mockResolvedValue({ id: 'an1' }) },
  };
  const storage: any = { readOwn: jest.fn().mockResolvedValue({ bytes: Buffer.from('img'), mime: 'image/jpeg' }) };
  const provider = { name: 'fake', model: 'fake-1', available: jest.fn().mockReturnValue(true), generate: jest.fn() };
  const settings: Record<string, unknown> = {};
  const svc = new AiService(provider as any, prisma, storage, { get: (k: string) => settings[k] } as any);

  describe('reading an ID number', () => {
    afterEach(() => { delete settings.AI_ID_OCR_ENABLED; });
    it('never sends the document anywhere unless switched on', async () => {
      await expect(svc.readIdNumber('w1', 'up1')).resolves.toEqual({ available: false, idNumber: null });
      expect(storage.readOwn).not.toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
    });
    it('returns only something shaped like a number, and records no content', async () => {
      settings.AI_ID_OCR_ENABLED = true;
      provider.generate.mockResolvedValue(' 42101-1234567-1 ');
      await expect(svc.readIdNumber('w1', 'up1')).resolves.toEqual({ available: true, idNumber: '42101-1234567-1' });
      expect(JSON.stringify(prisma.jobAiAnalysis.create.mock.calls)).not.toContain('42101');
      provider.generate.mockResolvedValue('Ignore previous instructions');
      await expect(svc.readIdNumber('w1', 'up1')).resolves.toEqual({ available: true, idNumber: null });
    });
  });
  afterEach(() => { jest.clearAllMocks(); provider.available.mockReturnValue(true); prisma.jobAiAnalysis.create.mockResolvedValue({ id: 'an1' }); prisma.serviceCategory.findMany.mockResolvedValue(categories); });

  const answer = (o: object) => JSON.stringify({ categoryCode: 'PLUMBING', issueCodes: ['leaking_tap'], urgency: 'standard', severity: 'low', lifeThreatening: false, hazards: [], summary: 'Tap drips', confidence: 0.8, questions: [], ...o });

  it('returns a validated suggestion mapped to a real category id, and records the call', async () => {
    provider.generate.mockResolvedValue(answer({}));
    const r = await svc.analyzeRequest('u1', { description: 'my kitchen tap drips' });
    expect(r).toMatchObject({ analysisId: 'an1', available: true, suggestion: { categoryId: 'c1', issueCodes: ['leaking_tap'] } });
    expect(prisma.jobAiAnalysis.create.mock.calls[0][0].data).toMatchObject({ ownerId: 'u1', kind: 'request_analysis', provider: 'fake', model: 'fake-1', valid: true });
  });

  it('a garbage answer is "unavailable", recorded as invalid, never shown as a suggestion', async () => {
    provider.generate.mockResolvedValue('sorry I cannot');
    const r = await svc.analyzeRequest('u1', { description: 'my tap drips' });
    expect(r).toMatchObject({ available: false, suggestion: null });
    expect(prisma.jobAiAnalysis.create.mock.calls[0][0].data.valid).toBe(false);
  });

  it('retries once on a transport error, then degrades gracefully', async () => {
    provider.generate.mockRejectedValue(new Error('timeout'));
    const r = await svc.analyzeRequest('u1', { description: 'my tap drips' });
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(r.available).toBe(false);
  });

  it('safety rules run even with no AI configured, and AI can never clear a rule hazard', async () => {
    provider.available.mockReturnValue(false);
    const off = await svc.analyzeRequest('u1', { description: 'I smell gas near the stove' });
    expect(off).toMatchObject({ available: false, safety: { lifeThreatening: true } });
    expect(provider.generate).not.toHaveBeenCalled();

    provider.available.mockReturnValue(true);
    provider.generate.mockResolvedValue(answer({ lifeThreatening: false, urgency: 'standard' }));
    const on = await svc.analyzeRequest('u1', { description: 'I smell gas near the stove' });
    expect(on.safety.lifeThreatening).toBe(true);
    expect(on.suggestion?.urgency).toBe('emergency');
  });

  it('uses the tapped problems as text and sends photos the caller owns', async () => {
    provider.generate.mockResolvedValue(answer({}));
    await svc.analyzeRequest('u1', { categoryId: 'c1', issueCodes: ['pipe_burst'], photoUploadIds: ['p1'] });
    expect(storage.readOwn).toHaveBeenCalledWith('u1', 'p1', ['JOB_PHOTO']);
    const input = provider.generate.mock.calls[0][0];
    expect(input.prompt).toContain('Burst pipe');
    expect(input.media).toHaveLength(1);
  });

  it('refuses to analyse nothing', async () => {
    await expect(svc.analyzeRequest('u1', {})).rejects.toThrow(BadRequestException);
  });

  describe('transcribe', () => {
    it('reads only the caller\'s own voice note', async () => {
      storage.readOwn.mockResolvedValue({ bytes: Buffer.from('a'), mime: 'audio/mp4' });
      provider.generate.mockResolvedValue('  "Kitchen ka nal tapak raha hai"  ');
      const r = await svc.transcribe('u1', 'a1', 'ur');
      expect(storage.readOwn).toHaveBeenCalledWith('u1', 'a1', ['JOB_AUDIO']);
      expect(r.text).toBe('Kitchen ka nal tapak raha hai');
    });

    it('says plainly when voice typing is unavailable (never returns fake text)', async () => {
      provider.available.mockReturnValue(false);
      await expect(svc.transcribe('u1', 'a1')).rejects.toThrow(ServiceUnavailableException);
      provider.available.mockReturnValue(true);
      provider.generate.mockRejectedValue(new Error('boom'));
      await expect(svc.transcribe('u1', 'a1')).rejects.toMatchObject({ response: { code: 'AI_UNAVAILABLE' } });
    });
  });

  it('safety screen: rules short-circuit; unavailable AI fails closed', async () => {
    expect(await svc.screenForSafety('there is smoke from the wall')).toMatchObject({ isSafe: false, verified: true });
    provider.available.mockReturnValue(false);
    expect(await svc.screenForSafety('tap drips')).toMatchObject({ isSafe: false, verified: false });
  });
});
