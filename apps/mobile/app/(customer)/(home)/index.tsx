import React, { useEffect } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppSelector, useAppDispatch } from '../../../src/hooks/useRedux';
import { selectCurrentUser } from '../../../src/store/authSlice';
import { selectTrackingState } from '../../../src/store/trackingSlice';
import { useApi } from '../../../src/hooks/useApi';
import { getCatalog } from '../../../src/services/api';
import { localizedName, humanize } from '../../../src/utils/catalog';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { useTheme } from '../../../src/hooks/useTheme';
import { useI18n } from '../../../src/hooks/useI18n';
import LiveTrackerMap from '../../../src/components/ui/LiveTrackerMap';
import { t } from '../../../src/i18n';

import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { SOSButton } from '../../../src/components/ds/SOSButton';
import { CategoryTile } from '../../../src/components/ds/CategoryTile';
import { Logo } from '../../../src/components/ds/Logo';
import { NotificationBell } from '../../../src/components/ds/NotificationBell';

export default function CustomerHomeScreen() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(selectCurrentUser);
  const trackingState = useAppSelector(selectTrackingState);
  const theme = useTheme();
  const { t, locale } = useI18n();
  const catalog = useApi(getCatalog, [], { cacheKey: 'catalog' });

  const handleSOS = () => {
    router.push('/sos' as any);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing['4xl'] }]}>
        
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? theme.spacing.xl : 0, marginBottom: theme.spacing.xl }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Logo variant="mark" height={40} />
            <View>
              <Text variant="body" color={theme.colors.textSecondary}>{t('home.greeting')}</Text>
              <Text variant="h2" color={theme.colors.textPrimary}>{t('customerHome.greeting', { name: currentUser?.name ?? t('customerHome.guest') })}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <NotificationBell />
          </View>
        </View>

        {/* Tracking Map if Job Active */}
        {trackingState.isTracking && (
          <View style={{ marginBottom: theme.spacing['2xl'] }}>
            <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: theme.spacing.lg }}>{t('customerHome.liveTracking')}</Text>
            <LiveTrackerMap
              customerLocation={trackingState.customerLocation || undefined}
              workerLocation={trackingState.workerLocation || undefined}
              etaString={trackingState.etaString || undefined}
            />
          </View>
        )}

        {/* What needs fixing? */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.lg }}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{t('home.categories')}</Text>
        </View>

        {/* Categories Grid: real catalog from the server */}
        {catalog.loading && !catalog.data ? (
          <View style={{ height: 220 }}><LoadingState /></View>
        ) : catalog.error && !catalog.data ? (
          <View style={{ height: 260 }}><ErrorState message={catalog.error} onRetry={catalog.reload} /></View>
        ) : !catalog.data?.length ? (
          <EmptyState icon="construct-outline" title={t('customerHome.noServicesAvailableYet')} message={t('customerHome.pleaseCheckBackSoon')} />
        ) : (
          <View style={[styles.categoriesGrid, { gap: 16 }]}>
            {catalog.data.map((cat) => (
              <CategoryTile
                key={cat.id}
                id={cat.id}
                name={localizedName({ name: cat.translations?.en?.name ?? humanize(cat.name), translations: cat.translations }, locale)}
                icon={(cat.iconName as any) ?? 'construct'}
                onPress={() => router.push(`/(customer)/(home)/categories/${cat.id}` as any)}
              />
            ))}
          </View>
        )}

        {/* Quick Capture Buttons */}
        <View style={[styles.quickActions, { marginTop: theme.spacing.xl, gap: theme.spacing.md }]}>
          <Button 
            title={`📷 ${t('home.category.other')}`} 
            variant="secondary" 
            size="lg" 
            style={{ flex: 1 }}
            onPress={() => router.push('/(customer)/request-service' as any)}
            accessibilityRole="button"
            accessibilityLabel={t('home.category.other')}
          />
          <Button 
            title={t('customerHome.tellUs')} 
            variant="secondary" 
            size="lg" 
            style={{ flex: 1 }}
            onPress={() => router.push('/(customer)/request-service' as any)}
            accessibilityRole="button"
            accessibilityLabel={t('customerHome.tellUsUsingVoice')}
          />
        </View>

      </ScrollView>

      {/* Floating SOS Button */}
      <View style={[styles.floatingSOS, { bottom: 120, right: theme.spacing.xl }]}>
        <SOSButton onSOSTriggered={handleSOS} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notifButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  categoriesGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  quickActions: { flexDirection: 'row' },
  floatingSOS: { position: 'absolute', zIndex: 100, elevation: 10 },
});
