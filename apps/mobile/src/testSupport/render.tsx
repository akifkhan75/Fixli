import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { render } from '@testing-library/react-native';
import auth from '../store/authSlice';
import ui from '../store/uiSlice';
import tracking from '../store/trackingSlice';
import workerFlow from '../store/workerFlowSlice';

/** Renders with the real store slices (so theme and signed-in user work as in the app). */
export function renderWithStore(node: React.ReactElement, user?: { id: string; name: string; type: 'customer' | 'worker' }) {
  const store = configureStore({
    reducer: { auth, ui, tracking, workerFlow },
    ...(user ? { preloadedState: { auth: { currentUser: user as any, token: 't', status: 'succeeded' as const, error: null, authFlowState: 'LOGIN' as const, restored: true } } } : {}),
  });
  return { store, ...render(<Provider store={store}>{node}</Provider>) };
}
