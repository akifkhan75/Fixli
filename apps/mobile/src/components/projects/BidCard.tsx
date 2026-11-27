import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { formatMoney } from '../../utils/money';
import type { PaymentMode, ProjectBidCard } from '../../services/api';
import { Card } from '../ds/Card';
import { Text } from '../ds/Text';
import { Avatar } from '../ds/Avatar';
import { Button } from '../ds/Button';
import { ChoiceCard } from '../ds/ChoiceCard';
import { PressableScale } from '../motion/PressableScale';
import { Entrance } from '../motion/Entrance';

/** One professional's price for a project, and hiring them (which asks how the customer will pay). */
export function BidCard({ bid, cardAvailable, busy, onHire, index = 0 }: { bid: ProjectBidCard; cardAvailable: boolean; busy: boolean; onHire: (mode: PaymentMode) => void; index?: number }) {
  const theme = useTheme();
  const { t, tn, locale } = useI18n();
  const [hiring, setHiring] = useState(false);
  const [mode, setMode] = useState<PaymentMode>(cardAvailable ? 'ESCROW' : 'DIRECT');
  const w = bid.worker;
  const name = w.businessName ?? w.name;
  const money = (v: number) => formatMoney(v, bid.currency, locale);

  return (
    <Entrance index={index}>
      <Card style={{ marginBottom: theme.spacing.md }} highlight={hiring ? theme.colors.primary : undefined}>
        <PressableScale onPress={() => router.push(`/worker/${w.id}` as any)} accessibilityLabel={t('customerJob.viewSProfile', { name })} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={name} imageUrl={w.profileImageUrl} size="lg" />
          <View style={{ flex: 1, marginStart: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="bodyLarge" weight="bold" style={{ flexShrink: 1 }}>{name}</Text>
              {w.isVerified ? <Ionicons name="shield-checkmark" size={18} color={theme.colors.successText} style={{ marginStart: 6 }} accessibilityLabel={t('customerJob.idChecked')} /> : null}
            </View>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              {w.ratingCount ? `★ ${w.rating.toFixed(1)} (${w.ratingCount})` : t('offerCard.newOnFixli')} · {tn('common.jobs', w.jobsCompleted)}{w.teamSize ? ` · ${tn('project.team', w.teamSize)}` : ''}
            </Text>
          </View>
        </PressableScale>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
          <Text variant="h2" weight="extrabold" tabular>{money(bid.totalAmount)}</Text>
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>{tn('project.days', bid.durationDays)}</Text>
        </View>
        {bid.note ? <Text variant="body" style={{ marginTop: 6 }}>"{bid.note}"</Text> : null}
        <View style={{ marginTop: 10, gap: 6 }}>
          {bid.milestones.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>{i + 1}. {m.title}</Text>
              <Text variant="bodySmall" weight="semibold" tabular>{money(m.amount)}</Text>
            </View>
          ))}
        </View>

        {hiring ? (
          <View style={{ marginTop: 16 }}>
            <Text variant="bodyLarge" weight="bold" style={{ marginBottom: 10 }}>{t('project.howPay')}</Text>
            {cardAvailable ? <ChoiceCard icon="card" title={t('project.payCard')} hint={t('project.payCardHint')} selected={mode === 'ESCROW'} onPress={() => setMode('ESCROW')} speak /> : null}
            <ChoiceCard icon="cash" title={t('project.payDirect')} hint={t('project.payDirectHint')} selected={mode === 'DIRECT'} onPress={() => setMode('DIRECT')} speak />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
              <View style={{ flex: 1 }}><Button title={t('authSignup.back')} variant="secondary" disabled={busy} onPress={() => setHiring(false)} /></View>
              <View style={{ flex: 1 }}><Button title={t('project.hireNow')} loading={busy} disabled={busy} onPress={() => onHire(mode)} /></View>
            </View>
          </View>
        ) : (
          <View style={{ marginTop: 14 }}>
            <Button title={t('project.hire', { name: w.businessName ?? w.name.split(' ')[0] })} size="lg" disabled={busy} onPress={() => setHiring(true)} />
          </View>
        )}
      </Card>
    </Entrance>
  );
}
