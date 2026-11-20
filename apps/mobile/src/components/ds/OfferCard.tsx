import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { formatMoney } from '../../utils/money';
import type { OfferCard as Offer } from '../../services/api';
import { t, tn } from '../../i18n';

function useMinutesLeft(expiresAt: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

/** Everything needed to choose, before committing: who, trust signals, distance, when, and the price (doc 22 §5.1 step 8). */
export function OfferCard({ offer, locale, onChoose, busy, disabled }: { offer: Offer; locale: string; onChoose: () => void; busy?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  const w = offer.worker;
  const minutes = useMinutesLeft(offer.expiresAt);
  const eta = offer.etaMinutes == null ? null : offer.etaMinutes < 60 ? `${offer.etaMinutes} min` : offer.etaMinutes < 1440 ? `${Math.round(offer.etaMinutes / 60)} h` : 'tomorrow';

  return (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 14 }}>
      <TouchableOpacity onPress={() => router.push(`/worker/${w.id}` as any)} accessibilityRole="button" accessibilityLabel={t('customerJob.viewSProfile', { name: w.name })} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Avatar name={w.name} imageUrl={w.profileImageUrl} size="lg" />
        <View style={{ flex: 1, marginStart: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{w.name}</Text>
            {w.isVerified ? <Ionicons name="shield-checkmark" size={16} color={theme.colors.success} style={{ marginStart: 6 }} accessibilityLabel={t('customerJob.idChecked')} /> : null}
          </View>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            {w.ratingCount ? `★ ${w.rating.toFixed(1)} (${w.ratingCount})` : t('offerCard.newOnFixli')} · {tn('common.jobs', w.jobsCompleted)}{w.distanceKm != null ? ` · ${t('offerCard.kmAway', { km: w.distanceKm })}` : ''}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <Text variant="h2" weight="extrabold" color={theme.colors.textPrimary}>{formatMoney(offer.amount, offer.currency, locale)}</Text>
          {eta ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('offerCard.canCome', { eta })}</Text> : null}
        </View>
        <Text variant="caption" color={minutes <= 2 ? theme.colors.errorText : theme.colors.textTertiary}>{minutes ? t('offerCard.minLeft', { minutes }) : t('offerCard.expired')}</Text>
      </View>
      {offer.note ? <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 8 }}>"{offer.note}"</Text> : null}
      <View style={{ marginTop: 14 }}>
        <Button title={t('offerCard.choose', { name: w.name.split(' ')[0] })} variant="primary" size="lg" loading={busy} disabled={disabled || minutes === 0} onPress={onChoose} />
      </View>
    </View>
  );
}
