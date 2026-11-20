import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const notifications = { list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn() };
  const sessions = { setPushToken: jest.fn() };
  const ctl = new NotificationsController(notifications as any, sessions as any);
  beforeEach(() => jest.resetAllMocks());

  it('lists and counts the caller\'s own notifications', () => {
    ctl.list('u1', { limit: 10 } as any);
    ctl.unread('u1');
    expect(notifications.list).toHaveBeenCalledWith('u1', { limit: 10 });
    expect(notifications.unreadCount).toHaveBeenCalledWith('u1');
  });

  it('marks some or all as read', () => {
    ctl.read('u1', { ids: ['a'] });
    ctl.read('u1', {});
    expect(notifications.markRead.mock.calls).toEqual([['u1', ['a']], ['u1', undefined]]);
  });

  it('registers and clears the push token for this session only', async () => {
    expect(await ctl.setToken({ id: 'u1', sid: 's1' }, { token: 'ExponentPushToken[abc]' })).toEqual({ success: true });
    expect(await ctl.clearToken({ id: 'u1', sid: 's1' })).toEqual({ success: true });
    expect(sessions.setPushToken.mock.calls).toEqual([['s1', 'u1', 'ExponentPushToken[abc]'], ['s1', 'u1', null]]);
  });

  it('the request shapes refuse junk (token format, limits, dates, too many ids)', async () => {
    const ctor = (name: string) => Reflect.getMetadata('design:paramtypes', NotificationsController.prototype, name);
    const [, Query] = ctor('list');
    const [, Read] = ctor('read');
    const [, Token] = ctor('setToken');
    const bad = async (cls: any, o: object) => (await validate(plainToInstance(cls, o))).map((e) => e.property).sort();
    expect(await bad(Query, { limit: 500, since: 'yesterday' })).toEqual(['limit', 'since']);
    expect(await bad(Query, { limit: 20, since: '2026-11-01T00:00:00Z', cursor: 'c' })).toEqual([]);
    expect(await bad(Read, { ids: Array(101).fill('x') })).toEqual(['ids']);
    expect(await bad(Read, {})).toEqual([]);
    expect(await bad(Token, { token: 'not-a-token' })).toEqual(['token']);
    expect(await bad(Token, { token: 'ExpoPushToken[a-b_c]' })).toEqual([]);
  });
});
