import { Prisma } from '@prisma/client';

/**
 * Messages only the server writes ("The professional is on the way"). Stored as a key plus
 * parameters so the app can show them in the reader's language (F7); `text` keeps an English
 * fallback for older clients. Clients can never create these (no isSystem in any DTO).
 */
export type SystemMessageKey = 'job.en_route' | 'job.started' | 'job.completed' | 'chat.contact_warning';

const EN: Record<SystemMessageKey, string> = {
  'job.en_route': 'The professional is on the way.',
  'job.started': 'The professional has started the work.',
  'job.completed': 'The professional has marked the work as completed.',
  'chat.contact_warning': 'Please keep communication on Fixli. Sharing contact info or links can be unsafe.',
};

export function systemMessage(conversationId: string, key: SystemMessageKey, params: Record<string, string | number> = {}) {
  return {
    conversationId,
    isSystem: true,
    senderId: null,
    systemKey: key,
    systemParams: params as Prisma.InputJsonValue,
    text: EN[key],
  };
}
