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
import { NotificationsProvider } from '../src/hooks/useNotifications';
import { useWorkerLocationTracker } from '../src/hooks/useWorkerLocationTracker';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN && process.env.EXPO_PUBLIC_SENTRY_DSN !== 'YOUR_SENTRY_DSN',
  debug: false,
});

function SocketHandler() {
  const currentUser = useAppSelector(selectCurrentUser);

  useEffect(() => {
    if (currentUser?.id) void realtime.connect();
    else realtime.disconnect();
    return () => realtime.disconnect();
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
import { I18nProvider } from '../src/hooks/useI18n';
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

  // Signed-out users can only see (auth) screens; signed-in users never see them.
  useEffect(() => {
    if (!restored) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/(auth)/login' as any);
    else if (user && inAuth) router.replace((user.type === 'worker' ? '/(worker)/today' : '/(customer)/(home)') as any);
  }, [restored, user, segments, router]);

  return restored ? <>{children}</> : null;
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
            <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
            <SignedIn>
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                  contentStyle: { backgroundColor: theme.colors.background },
                }}
              />
            </SignedIn>
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
