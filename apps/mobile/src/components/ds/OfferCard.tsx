import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Card } from './Card';
import { PressableScale } from '../motion/PressableScale';
import { Entrance } from '../motion/Entrance';
import { formatMoney } from '../../utils/money';
import type { OfferCard as Offer } from '../../services/api';
import { t, tn } from '../../i18n';

function useMinutesLeft(expiresAt: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

function etaText(minutes: number) {
  if (minutes < 60) return t('offerCard.etaMinutes', { n: minutes });
  if (minutes < 1440) return t('offerCard.etaHours', { n: Math.round(minutes / 60) });
  return t('offerCard.etaTomorrow');
}

function Fact({ icon, color, text }: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.full, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Ionicons name={icon} size={14} color={color} />
      <Text variant="caption" weight="semibold" color={theme.colors.textSecondary}>{text}</Text>
    </View>
  );
}

/** Everything needed to choose, before committing: who, trust signals, distance, when, and the price (doc 22 §5.1 step 8). */
export function OfferCard({ offer, locale, onChoose, busy, disabled, index = 0 }: { offer: Offer; locale: string; onChoose: () => void; busy?: boolean; disabled?: boolean; index?: number }) {
  const theme = useTheme();
  const w = offer.worker;
  const minutes = useMinutesLeft(offer.expiresAt);
  const urgent = minutes <= 2;

  return (
    <Entrance index={index}>
      <Card style={{ marginBottom: 14 }}>
        <PressableScale onPress={() => router.push(`/worker/${w.id}` as any)} accessibilityRole="button" accessibilityLabel={t('customerJob.viewSProfile', { name: w.name })} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={w.name} imageUrl={w.profileImageUrl} size="lg" />
          <View style={{ flex: 1, marginStart: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="bodyLarge" weight="bold" style={{ flexShrink: 1 }}>{w.name}</Text>
              {w.isVerified ? <Ionicons name="shield-checkmark" size={18} color={theme.colors.successText} style={{ marginStart: 6 }} accessibilityLabel={t('customerJob.idChecked')} /> : null}
            </View>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{tn('common.jobs', w.jobsCompleted)}</Text>
          </View>
        </PressableScale>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Fact icon="star" color={theme.colors.accent} text={w.ratingCount ? `${w.rating.toFixed(1)} (${w.ratingCount})` : t('offerCard.newOnFixli')} />
          {w.distanceKm != null ? <Fact icon="location" color={theme.colors.primaryText} text={t('offerCard.kmAway', { km: w.distanceKm })} /> : null}
          {offer.etaMinutes != null ? <Fact icon="time" color={theme.colors.successText} text={t('offerCard.canCome', { eta: etaText(offer.etaMinutes) })} /> : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 }}>
          <Text variant="h1" weight="extrabold" tabular>{formatMoney(offer.amount, offer.currency, locale)}</Text>
          <Text variant="caption" weight="semibold" color={urgent ? theme.colors.errorText : theme.colors.textTertiary}>{minutes ? t('offerCard.minLeft', { minutes }) : t('offerCard.expired')}</Text>
        </View>
        {offer.note ? <Text variant="body" style={{ marginTop: 8 }}>"{offer.note}"</Text> : null}
        <View style={{ marginTop: 14 }}>
          <Button title={t('offerCard.choose', { name: w.name.split(' ')[0] })} variant="primary" size="lg" loading={busy} disabled={disabled || minutes === 0} onPress={onChoose} />
        </View>
      </Card>
    </Entrance>
  );
}
