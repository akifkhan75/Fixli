import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Provider } from 'react-redux';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { store } from '../src/store';
import { useAppSelector, useAppDispatch } from '../src/hooks/useRedux';
import { selectCurrentUser, selectSessionRestored, restoreSession } from '../src/store/authSlice';
import { realtime } from '../src/services/socket';
import { chatOutbox } from '../src/services/chatOutbox';
import { outbox } from '../src/services/outbox';
import { registerOutboxHandlers } from '../src/services/outboxHandlers';
import { connectivity } from '../src/services/connectivity';
import { analytics } from '../src/services/analytics';
import { clearCache } from '../src/services/cache';
import { OutboxBar } from '../src/components/ds/OutboxBar';
import { NotificationsProvider } from '../src/hooks/useNotifications';
import { useWorkerLocationTracker } from '../src/hooks/useWorkerLocationTracker';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN && process.env.EXPO_PUBLIC_SENTRY_DSN !== 'YOUR_SENTRY_DSN',
  debug: false,
});

registerOutboxHandlers();

function SocketHandler() {
  const currentUser = useAppSelector(selectCurrentUser);

  useEffect(() => {
    void analytics.init().then(() => analytics.track('app_open'));
    return connectivity.start();
  }, []);

  useEffect(() => {
    if (!currentUser?.id) {
      realtime.disconnect();
      // Signed out: this account's unsent messages and saved actions don't stay on the phone.
      void chatOutbox.clear();
      void outbox.clear();
      void clearCache();
      return undefined;
    }
    void realtime.connect();
    // Unsent chat messages and saved job steps / requests go out when the connection is back.
    const stopChat = chatOutbox.start();
    const stopOutbox = outbox.start();
    return () => { stopChat(); stopOutbox(); realtime.disconnect(); };
  }, [currentUser?.id]);

  return null;
}

/** Notifications need a signed-in user; remounts (fresh count) when the account changes. */
function SignedIn({ children }: { children: React.ReactNode }) {
  const user = useAppSelector(selectCurrentUser);
  return user ? <NotificationsProvider key={user.id}>{children}</NotificationsProvider> : <>{children}</>;
}

function LocationTrackerHandler() {
  // Workers send their position only while on the way to a job (started from the job screen).
  // Customers' location is never tracked; they see the worker's position on the job screen.
  useWorkerLocationTracker();

  return null;
}

import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { I18nProvider, useI18n } from '../src/hooks/useI18n';
import { CountryProvider } from '../src/hooks/useCountry';
import { useTheme } from '../src/hooks/useTheme';

function SessionGate({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const restored = useAppSelector(selectSessionRestored);
  const user = useAppSelector(selectCurrentUser);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    dispatch(restoreSession());
  }, [dispatch]);

  // Keep the splash up until we know whether the stored session is still valid.
  useEffect(() => {
    if (restored) SplashScreen.hideAsync();
  }, [restored]);

  // Which screens are used (anonymous, and only if the person agreed): the route name, never ids or content.
  const screen = segments.join('_').replace(/[^a-z0-9_]/gi, '').toLowerCase().replace(/^[^a-z]+/, '').slice(0, 40);
  useEffect(() => { if (restored && screen) void analytics.screen(screen); }, [restored, screen]);

  // Signed-out users can only see (auth) screens; signed-in users never see them.
  useEffect(() => {
    if (!restored) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/(auth)/login' as any);
    else if (user && inAuth) router.replace((user.type === 'worker' ? '/(worker)/today' : '/(customer)/(home)') as any);
  }, [restored, user, segments, router]);

  return restored ? <>{children}</> : null;
}

/** Redraws every screen when the language changes (text is looked up as each screen renders). */
function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  return <React.Fragment key={locale}>{children}</React.Fragment>;
}

function RootLayoutInner() {
  const theme = useTheme();
  
  return (
    <I18nProvider>
      <CountryProvider>
      <BottomSheetModalProvider>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <SessionGate>
            <SocketHandler />
            <LocationTrackerHandler />
            <OutboxBar />
            <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
            <LocaleBoundary><SignedIn>
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                  contentStyle: { backgroundColor: theme.colors.background },
                }}
              />
            </SignedIn></LocaleBoundary>
          </SessionGate>
        </View>
      </BottomSheetModalProvider>
      </CountryProvider>
    </I18nProvider>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <RootLayoutInner />
      </Provider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
