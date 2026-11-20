import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useApi } from '../../src/hooks/useApi';
import { useLiveReload } from '../../src/hooks/useRealtime';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { ChipChoice } from '../../src/components/ds/ChipChoice';
import { SettleUpForm } from '../../src/components/ds/SettleUpForm';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { formatMoney } from '../../src/utils/money';
import * as api from '../../src/services/api';
import { t, tn } from '../../src/i18n';

const ENTRY_LABEL: Record<api.LedgerItem['type'], string> = {
  COMMISSION_OWED: 'Fixli fee',
  COMMISSION_SETTLED: 'You paid Fixli',
  ADJUSTMENT: 'Correction',
};

/** Real numbers only: what customers paid you, Fixli's fee, and what you still owe Fixli. */
export default function WorkerEarningsScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const summary = useApi(() => api.getWorkerEarnings(period), [period]);
  const ledger = useApi(() => api.getLedger(), []);
  const [more, setMore] = useState<api.LedgerItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [settling, setSettling] = useState(false);

  const reloadAll = useCallback(() => { summary.reload(); ledger.reload(); setMore([]); setCursor(undefined); }, [summary.reload, ledger.reload]);
  useFocusEffect(useCallback(() => { reloadAll(); }, [reloadAll]));
  // Payments confirmed, settlements checked: refresh without pulling.
  useLiveReload(reloadAll, ['notification.created'], (e) => /^(payment|settlement|balance)\./.test(String(e.data?.type)));

  const s = summary.data;
  if (summary.loading && !s) return <Screen title={t('worker.earnings')}><LoadingState /></Screen>;
  if (summary.error && !s) return <Screen title={t('worker.earnings')}><ErrorState message={summary.error} onRetry={summary.reload} /></Screen>;
  if (!s) return null;

  const m = (v: number) => formatMoney(v, s.currency, locale);
  const items = [...(ledger.data?.items ?? []), ...more];
  const next = cursor === undefined ? ledger.data?.nextCursor : cursor;
  const loadMore = async () => {
    if (!next) return;
    const page = await api.getLedger(next);
    setMore((x) => [...x, ...page.items]);
    setCursor(page.nextCursor);
  };

  return (
    <Screen title={t('worker.earnings')} onRefresh={reloadAll} refreshing={summary.loading && !!s}>
      <ChipChoice options={[{ id: 'week', label: t('workerEarnings.thisWeek') }, { id: 'month', label: t('workerEarnings.thisMonth') }]} selectedIds={[period]} onChange={(v) => v[0] && setPeriod(v[0] as 'week' | 'month')} />

      <View style={{ backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.xl, padding: 20, marginTop: 16 }}>
        <Text variant="bodySmall" color="rgba(255,255,255,0.85)">{t('workerEarnings.customersPaidYou')}</Text>
        <Text variant="h1" weight="extrabold" color="#FFFFFF" style={{ marginTop: 4 }}>{m(s.gross)}</Text>
        <Text variant="bodySmall" color="rgba(255,255,255,0.85)" style={{ marginTop: 8 }}>
          {tn('common.jobs', s.jobs)} · {t('workerEarnings.feeAndNet', { fee: m(s.commission), net: m(s.net) })}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.75)" style={{ marginTop: 6 }}>{t('workerEarnings.today', { amount: m(s.today.gross) })}</Text>
      </View>

      <View style={{ backgroundColor: s.limits.blocked ? theme.colors.error + '18' : theme.colors.surface, borderColor: s.limits.blocked ? theme.colors.error : s.limits.overSoft ? theme.colors.warning : theme.colors.border, borderWidth: 1.5, borderRadius: theme.borderRadius.xl, padding: 16, marginTop: 16 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>{t('workerEarnings.youOweFixli')}</Text>
        <Text variant="h2" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{m(s.owed)}</Text>
        <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>
          {t('workerEarnings.feeRule', { percent: (s.commissionRule.rateBps / 100).toFixed(0), min: m(s.commissionRule.minMinor), max: m(s.commissionRule.maxMinor) })}
        </Text>
        {s.limits.blocked ? (
          <Text variant="body" weight="semibold" color={theme.colors.errorText} style={{ marginTop: 8 }} accessibilityRole="alert">
            {t('workerEarnings.newRequestsArePaused')}
          </Text>
        ) : s.limits.overSoft ? (
          <Text variant="body" color={theme.colors.warningText} style={{ marginTop: 8 }}>
            {t('workerEarnings.paySoon', { amount: m(s.limits.hardMinor), days: s.limits.maxDaysOwed })}
          </Text>
        ) : null}
        {s.pendingSettlement ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
            {t('workerEarnings.checkingPayment', { amount: m(s.pendingSettlement.amount) })}
          </Text>
        ) : s.owed > 0 && !settling ? (
          <View style={{ marginTop: 12 }}><Button title={t('workerEarnings.ivePaidFixli')} variant="secondary" onPress={() => setSettling(true)} /></View>
        ) : null}
        {settling && !s.pendingSettlement ? (
          <SettleUpForm owed={s.owed} currency={s.currency} rails={s.settlementRails} locale={locale} onDone={() => { setSettling(false); reloadAll(); }} />
        ) : null}
      </View>

      <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 28, marginBottom: 8 }}>{t('workerEarnings.feesAndPayments')}</Text>
      {!items.length && !ledger.loading ? (
        <EmptyState icon="receipt-outline" title={t('sharedNotifications.nothingYet')} message={t('workerEarnings.fixlisFeeAppearsHere')} />
      ) : null}
      {items.map((it) => (
        <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Ionicons name={it.type === 'COMMISSION_SETTLED' ? 'checkmark-circle-outline' : it.type === 'ADJUSTMENT' ? 'swap-horizontal-outline' : 'receipt-outline'} size={22} color={theme.colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold" color={theme.colors.textPrimary}>{ENTRY_LABEL[it.type] ?? t('workerEarnings.entry')}{it.jobTitle ? ` · ${it.jobTitle}` : ''}</Text>
            <Text variant="caption" color={theme.colors.textTertiary}>{new Date(it.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}{it.note && it.type === 'ADJUSTMENT' ? ` · ${it.note}` : ''}</Text>
          </View>
          <Text variant="body" weight="bold" color={it.amount > 0 ? theme.colors.textPrimary : theme.colors.successText}>
            {it.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(it.amount), it.currency, locale)}
          </Text>
        </View>
      ))}
      {next ? <View style={{ marginTop: 12 }}><Button title={t('workerEarnings.showOlder')} variant="ghost" onPress={loadMore} /></View> : null}
    </Screen>
  );
}
