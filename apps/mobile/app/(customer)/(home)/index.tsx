import React, { useCallback, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAppSelector } from '../../../src/hooks/useRedux';
import { selectCurrentUser } from '../../../src/store/authSlice';
import { selectTrackingState } from '../../../src/store/trackingSlice';
import { useApi } from '../../../src/hooks/useApi';
import { useLiveReload } from '../../../src/hooks/useRealtime';
import * as api from '../../../src/services/api';
import { humanize, localizedName } from '../../../src/utils/catalog';
import { isFinished } from '../../../src/utils/jobStatus';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { useTheme } from '../../../src/hooks/useTheme';
import { useI18n } from '../../../src/hooks/useI18n';
import LiveTrackerMap from '../../../src/components/ui/LiveTrackerMap';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { Avatar } from '../../../src/components/ds/Avatar';
import { JobCard } from '../../../src/components/ds/JobCard';
import { Card } from '../../../src/components/ds/Card';
import { DirIcon } from '../../../src/components/ds/DirIcon';
import { SOSButton } from '../../../src/components/ds/SOSButton';
import { CategoryTile } from '../../../src/components/ds/CategoryTile';
import { Logo } from '../../../src/components/ds/Logo';
import { NotificationBell } from '../../../src/components/ds/NotificationBell';
import { Entrance } from '../../../src/components/motion/Entrance';
import { PressableScale } from '../../../src/components/motion/PressableScale';

/** Tiles shown before "See all", so the first screen stays calm. */
const FIRST_TILES = 9;
const GAP = 12;
const GUTTER = 20;

export default function CustomerHomeScreen() {
  const currentUser = useAppSelector(selectCurrentUser);
  const trackingState = useAppSelector(selectTrackingState);
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { width } = useWindowDimensions();
  const catalog = useApi(api.getCatalog, [], { cacheKey: 'catalog' });
  const jobs = useApi(async () => (await api.listJobs()).items, [currentUser?.id], { cacheKey: `customer-home-jobs:${currentUser?.id}` });
  const favorites = useApi(api.getFavorites, [currentUser?.id], { cacheKey: `favorites:${currentUser?.id}` });
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  useFocusEffect(useCallback(() => { jobs.reload(); favorites.reload(); }, [jobs.reload, favorites.reload]));
  useLiveReload(jobs.reload, ['job.updated']);

  const current = jobs.data?.find((j) => !isFinished(j.status));
  const firstName = currentUser?.name?.split(' ')[0] ?? t('customerHome.guest');
  const tileWidth = Math.floor((width - GUTTER * 2 - GAP * 2) / 3);

  const nameOf = (c: api.CatalogCategory) => localizedName({ name: c.translations?.en?.name ?? humanize(c.name), translations: c.translations }, locale);
  // Search by trade or by problem ("leaking tap"), in the user's language or English.
  const needle = query.trim().toLocaleLowerCase();
  const matches = (catalog.data ?? []).filter((c) => !needle || [
    nameOf(c), humanize(c.name), c.description ?? '',
    ...c.issues.flatMap((i) => [i.name, localizedName(i, locale)]),
  ].some((s) => s.toLocaleLowerCase().includes(needle)));
  const tiles = needle || showAll ? matches : matches.slice(0, FIRST_TILES);

  return (
    <Screen
      onRefresh={() => { catalog.reload(); jobs.reload(); favorites.reload(); }}
      refreshing={catalog.loading && !!catalog.data}
      floating={<SOSButton onSOSTriggered={() => router.push('/sos' as any)} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.xl }}>
        <Logo variant="mark" height={40} />
        <View style={{ flex: 1 }}>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('home.greeting')}</Text>
          <Text variant="h3" weight="bold" numberOfLines={1}>{t('customerHome.greeting', { name: firstName })}</Text>
        </View>
        <NotificationBell />
      </View>

      <Entrance>
        <LinearGradient colors={theme.gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: theme.borderRadius['2xl'], padding: theme.spacing.xl }}>
          <Text variant="h2" weight="bold" color={theme.colors.onPrimary}>{t('customerHome.whatNeedsFixing')}</Text>
          <Text variant="body" color={theme.colors.onPrimary} style={{ marginTop: 6, marginBottom: theme.spacing.lg, opacity: 0.9 }}>{t('customerHome.heroHint')}</Text>
          <Button
            title={t('customerHome.getHelp')}
            variant="accent"
            size="lg"
            leftIcon={<Ionicons name="mic" size={22} color={theme.colors.onAccent} />}
            rightIcon={<Ionicons name="camera" size={22} color={theme.colors.onAccent} />}
            onPress={() => router.push('/(customer)/(home)/request-service' as any)}
          />
        </LinearGradient>
      </Entrance>

      <Entrance index={1} style={{ marginTop: theme.spacing.md }}>
        <Card onPress={() => router.push('/(customer)/(home)/project/new' as any)} accessibilityLabel={`${t('project.getWorkDone')}. ${t('project.getWorkDoneHint')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="business" size={30} color={theme.colors.primaryText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyLarge" weight="bold">{t('project.getWorkDone')}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('project.getWorkDoneHint')}</Text>
          </View>
          <DirIcon name="chevron-forward" size={22} color={theme.colors.textTertiary} />
        </Card>
      </Entrance>

      {trackingState.isTracking ? (
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('customerHome.liveTracking')}</Text>
          <LiveTrackerMap
            customerLocation={trackingState.customerLocation || undefined}
            workerLocation={trackingState.workerLocation || undefined}
            etaString={trackingState.etaString || undefined}
          />
        </View>
      ) : null}

      {current ? (
        <Entrance index={1} style={{ marginTop: theme.spacing['2xl'] }}>
          <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('customerHome.yourJob')}</Text>
          <JobCard job={current} viewer="customer" locale={locale} onPress={() => router.push(`/(customer)/(home)/job/${current.id}` as any)} />
        </Entrance>
      ) : null}

      <Text variant="h3" weight="bold" style={{ marginTop: theme.spacing['2xl'], marginBottom: theme.spacing.md }}>{t('home.categories')}</Text>
      {catalog.loading && !catalog.data ? (
        <LoadingState />
      ) : catalog.error && !catalog.data ? (
        <ErrorState message={catalog.error} onRetry={catalog.reload} />
      ) : !catalog.data?.length ? (
        <EmptyState icon="construct-outline" title={t('customerHome.noServicesAvailableYet')} message={t('customerHome.pleaseCheckBackSoon')} />
      ) : (
        <>
          <TextInput accessibilityLabel={t('customerHome.search')} placeholder={t('customerHome.search')} value={query} onChangeText={setQuery} returnKeyType="search" containerStyle={{ marginBottom: theme.spacing.md }} />
          {!tiles.length ? (
            <EmptyState icon="search-outline" title={t('customerHome.noMatch')} actionLabel={t('customerHome.getHelp')} onAction={() => router.push('/(customer)/(home)/request-service' as any)} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {tiles.map((cat, index) => (
                <Entrance key={cat.id} index={index}>
                  <CategoryTile
                    code={cat.name}
                    name={nameOf(cat)}
                    icon={(cat.iconName as any) ?? 'construct'}
                    style={{ width: tileWidth }}
                    onPress={() => router.push(`/(customer)/(home)/categories/${cat.id}` as any)}
                  />
                </Entrance>
              ))}
            </View>
          )}
          {!needle && matches.length > FIRST_TILES ? (
            <Button title={showAll ? t('customerHome.showLess') : t('customerHome.seeAll', { n: matches.length })} variant="ghost" onPress={() => setShowAll((v) => !v)} style={{ marginTop: theme.spacing.sm }} />
          ) : null}
        </>
      )}

      {favorites.data?.length ? (
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('customerHome.bookAgain')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: GAP }}>
            {favorites.data.slice(0, 10).map((f) => (
              <PressableScale
                key={f.id}
                onPress={() => router.push(`/worker/${f.worker.id}` as any)}
                accessibilityLabel={f.worker.user.name}
                style={{ width: 104, alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: theme.spacing.md }}
              >
                <Avatar name={f.worker.user.name} imageUrl={f.worker.user.profileImageUrl} size="lg" />
                <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={{ marginTop: 8 }}>{f.worker.user.name.split(' ')[0]}</Text>
                {f.worker.rating ? <Text variant="caption" color={theme.colors.textSecondary}>★ {f.worker.rating.toFixed(1)}</Text> : null}
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}
