import { analytics } from '../services/analytics';
import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { IUser, AuthFlowState } from '@fixli/shared';
import * as api from '../services/api';
import { saveTokens, clearTokens, getAccessToken } from '../services/session';
import type { CountryCode } from '@fixli/shared';
import type { RootState } from './index';
import { t } from '../i18n';

interface AuthState {
  currentUser: IUser | null;
  token: string | null;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
  authFlowState: AuthFlowState;
  /** True once the stored session has been checked with the server (success or not). */
  restored: boolean;
}

const initialState: AuthState = {
  currentUser: null,
  token: null,
  status: 'idle',
  error: null,
  authFlowState: 'LOGIN',
  restored: false,
};

export interface LoginArgs { phone: string; countryCode: CountryCode; password: string }
export interface SignupArgs extends LoginArgs { name: string; type: 'customer' | 'worker'; locale?: 'en' | 'ar' | 'ur' }

export const loginUser = createAsyncThunk<
  { user: IUser; token: string },
  LoginArgs,
  { rejectValue: string }
>('auth/loginUser', async (args, { rejectWithValue }) => {
  try {
    const res = await api.login(args.phone, args.countryCode, args.password);
    await saveTokens(res.token, res.refreshToken);
    return { user: res.user, token: res.token };
  } catch (error: any) {
    // Real errors only: a wrong password or an unreachable server must never produce a signed-in user.
    return rejectWithValue(friendlyAuthError(error));
  }
});

export const signupUser = createAsyncThunk<
  { user: IUser; token: string },
  SignupArgs,
  { rejectValue: string }
>('auth/signupUser', async (args, { rejectWithValue }) => {
  try {
    const res = await api.signup(args);
    void analytics.track('sign_up_completed', { role: args.type });
    await saveTokens(res.token, res.refreshToken);
    return { user: res.user, token: res.token };
  } catch (error: any) {
    return rejectWithValue(friendlyAuthError(error));
  }
});

/** Validates the stored session with the server (refreshing it if needed). No session = signed out. */
export const restoreSession = createAsyncThunk<
  { user: IUser; token: string } | null,
  void,
  { rejectValue: string }
>('auth/restoreSession', async () => {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const user = await api.getCurrentUser(); // refreshes silently on 401
    return { user, token: (await getAccessToken()) ?? token };
  } catch (error: any) {
    // Only a definite "your session is gone" signs out. A network error keeps the tokens so the
    // user is not logged out just for opening the app with no signal.
    if (error instanceof api.ApiError && (error.status === 401 || error.status === 403)) {
      await clearTokens();
    }
    return null;
  }
});

/** Revokes the session on the server (best effort) and clears local credentials. */
export const logoutUser = createAsyncThunk<void, void>('auth/logoutUser', async () => {
  try {
    await api.logoutRemote();
  } catch {
    // Offline or already expired: still sign out locally.
  }
  await clearTokens();
});

function friendlyAuthError(error: unknown): string {
  if (error instanceof api.ApiError) {
    if (error.status === 401) return error.userMessage || t('auth.wrongCredentials');
    if (error.status === 429) return t('auth.tooManyTries');
    return error.userMessage;
  }
  return t('common.noServer');
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** After editing the profile, keep the signed-in user in sync with the server's copy. */
    setCurrentUser: (state, action: PayloadAction<IUser>) => {
      state.currentUser = action.payload;
    },
    /** Used when the server says the session is gone (refresh failed); no network call. */
    sessionExpired: (state) => {
      state.currentUser = null;
      state.token = null;
      state.authFlowState = 'LOGIN';
      state.restored = true;
    },
    setAuthFlowState: (state, action: PayloadAction<AuthFlowState>) => {
      state.authFlowState = action.payload;
    },
    clearAuthError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginUser.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.currentUser = action.payload.user;
        state.token = action.payload.token;
        state.authFlowState = 'LOGIN';
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? t('auth.loginFailed');
      })
      .addCase(signupUser.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(signupUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.currentUser = action.payload.user;
        state.token = action.payload.token;
        state.authFlowState = 'LOGIN';
      })
      .addCase(signupUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? t('auth.signupFailed');
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.currentUser = null;
        state.token = null;
        state.status = 'idle';
        state.error = null;
        state.authFlowState = 'LOGIN';
        state.restored = true;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        if (action.payload) {
          state.currentUser = action.payload.user;
          state.token = action.payload.token;
        }
        state.restored = true;
      })
      .addCase(restoreSession.rejected, (state) => {
        state.restored = true;
      });
  },
});

export const { setCurrentUser, sessionExpired, setAuthFlowState, clearAuthError } = authSlice.actions;

export const selectCurrentUser = (state: RootState) => state.auth.currentUser;
export const selectAuthToken = (state: RootState) => state.auth.token;
export const selectIsAuthLoading = (state: RootState) => state.auth.status === 'loading';
export const selectSessionRestored = (state: RootState) => state.auth.restored;
export const selectAuthFlowState = (state: RootState) => state.auth.authFlowState;
export const selectAuthError = (state: RootState) => state.auth.error;

export default authSlice.reducer;
