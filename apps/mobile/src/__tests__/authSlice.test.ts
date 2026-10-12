import { configureStore } from '@reduxjs/toolkit';
import authReducer, { signupUser, loginUser, clearAuthError, logoutUser, restoreSession, sessionExpired } from '../store/authSlice';

const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
import { IAuthResponse, IUser, AuthFlowState, UserType } from '@fixli/shared';

describe('authSlice', () => {
  const initialState = {
    currentUser: null as IUser | null,
    token: null as string | null,
    status: 'idle' as 'idle' | 'loading' | 'succeeded' | 'failed',
    error: null as string | null,
    authFlowState: 'LOGIN' as AuthFlowState,
    restored: false,
  };

  const mockUser: IUser = {
    id: '123',
    email: 'test@example.com',
    name: 'Test User',
    type: UserType.CUSTOMER,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('should handle initial state', () => {
    expect(authReducer(undefined, { type: 'unknown' })).toEqual(initialState);
  });

  it('should handle clearAuthError', () => {
    const state = { ...initialState, error: 'Some error' };
    expect(authReducer(state, clearAuthError())).toEqual(initialState);
  });

  it('sessionExpired signs the UI out without a network call', () => {
    const state = { ...initialState, currentUser: mockUser, token: 'fake-token' };
    expect(authReducer(state, sessionExpired())).toEqual({ ...initialState, restored: true });
  });

  it('logoutUser.fulfilled clears the user', () => {
    const state = { ...initialState, currentUser: mockUser, token: 'fake-token', status: 'succeeded' as const };
    const next = authReducer(state, { type: logoutUser.fulfilled.type });
    expect(next.currentUser).toBeNull();
    expect(next.token).toBeNull();
  });

  describe('loginUser', () => {
    it('should set status to loading on pending', () => {
      const action = { type: loginUser.pending.type };
      const state = authReducer(initialState, action);
      expect(state.status).toBe('loading');
      expect(state.error).toBeNull();
    });

    it('should set user and token on fulfilled', () => {
      const payload: Omit<IAuthResponse, 'refreshToken'> = { user: mockUser, token: 'jwt-token' };
      const action = { type: loginUser.fulfilled.type, payload };
      const state = authReducer(initialState, action);
      
      expect(state.status).toBe('succeeded');
      expect(state.currentUser).toEqual(mockUser);
      expect(state.token).toBe('jwt-token');
      expect(state.error).toBeNull();
    });

    it('should set error on rejected', () => {
      const action = { type: loginUser.rejected.type, payload: 'Invalid credentials' };
      const state = authReducer(initialState, action);
      
      expect(state.status).toBe('failed');
      expect(state.currentUser).toBeNull();
      expect(state.token).toBeNull();
      expect(state.error).toBe('Invalid credentials');
    });
  });

  describe('signupUser', () => {
    it('should set status loading on pending', () => {
      const action = { type: signupUser.pending.type };
      const state = authReducer(initialState, action);
      expect(state.status).toBe('loading');
    });

    it('should set user and token on fulfilled', () => {
      const payload: Omit<IAuthResponse, 'refreshToken'> = { user: mockUser, token: 'jwt-token-new' };
      const action = { type: signupUser.fulfilled.type, payload };
      const state = authReducer(initialState, action);
      
      expect(state.status).toBe('succeeded');
      expect(state.currentUser).toEqual(mockUser);
      expect(state.token).toBe('jwt-token-new');
    });
  });
});


describe('auth thunks never fabricate a session', () => {
  const makeStore = () => configureStore({ reducer: { auth: authReducer } as any });
  const jsonResponse = (status: number, body: unknown) =>
    ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

  afterEach(() => {
    jest.restoreAllMocks();
    for (const k of Object.keys(mockStore)) delete mockStore[k];
  });

  it('wrong password: rejected, no user, no token stored', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Phone number or password is wrong.' } }),
    );
    const store = makeStore();
    await store.dispatch(loginUser({ phone: '0300 1234567', countryCode: 'PK', password: 'bad' }) as any);
    const state = (store.getState() as any).auth;
    expect(state.currentUser).toBeNull();
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/not right|wrong/i);
    expect(mockStore.authToken).toBeUndefined();
  });

  it('server unreachable: rejected with a friendly message, not a demo user', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const store = makeStore();
    await store.dispatch(loginUser({ phone: '0300 1234567', countryCode: 'PK', password: 'password123' }) as any);
    const state = (store.getState() as any).auth;
    expect(state.currentUser).toBeNull();
    expect(state.error).toMatch(/offline|reach the server/i);
  });

  it('a successful login stores BOTH tokens and sends the device id', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { user: { id: 'u1', name: 'A', type: 'customer' }, token: 'acc', refreshToken: 'sid.ref' }),
    );
    const store = makeStore();
    await store.dispatch(loginUser({ phone: '0300 1234567', countryCode: 'PK', password: 'blue-Tiger-42' }) as any);
    expect(mockStore.authToken).toBe('acc');
    expect(mockStore.refreshToken).toBe('sid.ref');
    const sent = JSON.parse((spy.mock.calls[0][1] as any).body);
    expect(sent).toMatchObject({ phone: '0300 1234567', countryCode: 'PK', platform: expect.any(String) });
    expect(sent.deviceId).toBeTruthy();
    expect((store.getState() as any).auth.currentUser.id).toBe('u1');
  });

  it('signup sends role, country and locale', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(201, { user: { id: 'u2', name: 'B', type: 'worker' }, token: 'acc', refreshToken: 'sid.ref' }),
    );
    const store = makeStore();
    await store.dispatch(signupUser({ name: 'B', phone: '0300 1234567', countryCode: 'PK', password: 'blue-Tiger-42', type: 'worker', locale: 'ur' }) as any);
    expect(JSON.parse((spy.mock.calls[0][1] as any).body)).toMatchObject({ type: 'worker', countryCode: 'PK', locale: 'ur' });
    expect((store.getState() as any).auth.currentUser.type).toBe('worker');
  });

  it('server validation messages are shown to the user (e.g. phone already registered)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(409, { success: false, error: { code: 'PHONE_TAKEN', message: 'That number is already registered. Try signing in.' } }),
    );
    const store = makeStore();
    await store.dispatch(signupUser({ name: 'B', phone: '0300 1234567', countryCode: 'PK', password: 'blue-Tiger-42', type: 'customer' }) as any);
    expect((store.getState() as any).auth.error).toMatch(/already registered/);
  });

  it('restoreSession with no stored token stays signed out', async () => {
    const store = makeStore();
    await store.dispatch(restoreSession() as any);
    const state = (store.getState() as any).auth;
    expect(state.currentUser).toBeNull();
    expect(state.restored).toBe(true);
  });

  it('restoreSession validates the token with the server and clears a rejected one', async () => {
    mockStore.authToken = 'stale';
    mockStore.refreshToken = 'sid.stale';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );
    const store = makeStore();
    await store.dispatch(restoreSession() as any);
    expect((store.getState() as any).auth.currentUser).toBeNull();
    expect(mockStore.authToken).toBeUndefined();
    expect(mockStore.refreshToken).toBeUndefined();
  });

  it('restoreSession keeps the tokens when the network is down (no logout for being offline)', async () => {
    mockStore.authToken = 'good';
    mockStore.refreshToken = 'sid.good';
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const store = makeStore();
    await store.dispatch(restoreSession() as any);
    expect(mockStore.authToken).toBe('good');
    expect(mockStore.refreshToken).toBe('sid.good');
  });

  it('restoreSession restores the real user from /auth/me', async () => {
    mockStore.authToken = 'good';
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { id: 'u1', name: 'Real', email: 'r@x.com', type: 'customer' }));
    const store = makeStore();
    await store.dispatch(restoreSession() as any);
    expect((store.getState() as any).auth.currentUser.id).toBe('u1');
  });
});
