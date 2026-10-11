import React from 'react';
import { View, Image, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi } from '../../../src/hooks/useApi';
import { useI18n } from '../../../src/hooks/useI18n';
import { Screen } from '../../../src/components/ds/Screen';
import { Avatar } from '../../../src/components/ds/Avatar';
import { FavoriteHeart } from '../../../src/components/ds/FavoriteHeart';
import { useAppSelector } from '../../../src/hooks/useRedux';
import { selectCurrentUser } from '../../../src/store/authSlice';
import { Text } from '../../../src/components/ds/Text';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { localizedName } from '../../../src/utils/catalog';
import { formatMoney } from '../../../src/utils/money';
import * as api from '../../../src/services/api';

const BADGE_LABEL: Record<api.VerificationType, string> = {
  ID: 'ID checked', SELFIE: 'Face matches ID', TRADE_LICENSE: 'Trade licence checked', INSURANCE: 'Insurance checked',
};

export default function WorkerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { locale } = useI18n();
  const { data: w, loading, error, reload } = useApi(() => api.getPublicWorker(id), [id]);
  const viewer = useAppSelector(selectCurrentUser);

  if (loading && !w) return <Screen title="Professional" back><LoadingState /></Screen>;
  if (error && !w) return <Screen title="Professional" back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!w) return null;

  const price =
    w.pricingModel === 'HOURLY' && w.hourlyRate ? `${formatMoney(w.hourlyRate, w.currency, locale)} per hour`
    : w.minimumCallOutFee ? `Call-out from ${formatMoney(w.minimumCallOutFee, w.currency, locale)}`
    : 'Quote after inspection';

  return (
    <Screen title="Professional" back>
      <View style={{ alignItems: 'center' }}>
        <Avatar name={w.user.name} imageUrl={w.user.profileImageUrl} size="xl" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{w.user.name}</Text>
          {viewer?.type === 'customer' ? <FavoriteHeart workerId={w.id} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Ionicons name="star" size={16} color={theme.colors.accent} />
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginStart: 4 }}>
            {w.ratingCount > 0 ? `${w.rating.toFixed(1)} · ${w.ratingCount} reviews` : 'No reviews yet'}  ·  {w.jobsCompleted} jobs
          </Text>
        </View>
        {w.serviceAreaLabel ? <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginTop: 4 }}>{w.serviceAreaLabel}</Text> : null}
      </View>

      {w.badges.length ? (
        <View style={{ marginTop: 20, gap: 8 }}>
          {w.badges.map((b) => (
            <View key={b.type} style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={`${BADGE_LABEL[b.type]}${b.verifiedAt ? ` on ${new Date(b.verifiedAt).toLocaleDateString()}` : ''}`}>
              <Ionicons name="shield-checkmark" size={20} color={theme.colors.success} />
              <Text variant="body" color={theme.colors.textPrimary} style={{ marginStart: 8 }}>{BADGE_LABEL[b.type]}</Text>
              {b.verifiedAt ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginStart: 8 }}>{new Date(b.verifiedAt).toLocaleDateString()}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>PRICE</Text>
        <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{price}</Text>
      </View>

      {w.services.length ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>SKILLS</Text>
          <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{w.services.map((s) => localizedName(s.category, locale)).join(' · ')}</Text>
        </View>
      ) : null}

      {w.bio ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>ABOUT</Text>
          <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{w.bio}</Text>
          <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 4 }}>
            {w.experienceYears ? `${w.experienceYears} years experience` : ''}{w.languages.length ? `${w.experienceYears ? '  ·  ' : ''}${w.languages.join(', ')}` : ''}
          </Text>
        </View>
      ) : null}

      {w.portfolio.length ? (
        <View style={{ marginTop: 24 }}>
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginBottom: 8 }}>PAST WORK</Text>
          {w.portfolio.map((p) => (
            <View key={p.id} style={{ marginBottom: 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {p.photos.map((uri) => <Image key={uri} source={{ uri }} accessibilityLabel={p.title} style={{ width: 200, height: 150, borderRadius: 12, marginEnd: 8, backgroundColor: theme.colors.surface }} />)}
              </ScrollView>
              <Text variant="body" weight="medium" color={theme.colors.textPrimary} style={{ marginTop: 6 }}>{p.title}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
