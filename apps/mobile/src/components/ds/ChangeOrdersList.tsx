import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import { useLiveReload } from '../../hooks/useRealtime';
import { Text } from './Text';
import { Button } from './Button';
import { formatMoney } from '../../utils/money';
import * as api from '../../services/api';
import { useI18n } from '../../hooks/useI18n';
import { t } from '../../i18n';

const STATUS_LABEL: Record<api.ChangeOrder['status'], string> = {
  PENDING: 'Waiting for the customer',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
};

/** Extra-work requests on a job. The customer approves or declines; the price changes only on approval. */
export function ChangeOrdersList({ jobId, viewer, currentMinor, onReloadRequested }: {
  jobId: string;
  viewer: 'customer' | 'worker';
  /** The job's agreed price, to show "from → to" on a pending request. */
  currentMinor?: number | null;
  onReloadRequested?: () => void;
}) {
  const theme = useTheme();
  const { locale, t } = useI18n();
  const [orders, setOrders] = useState<api.ChangeOrder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const fetchOrders = useCallback(async () => {
    try { setOrders(await api.getChangeOrders(jobId)); } catch (e) { setError(friendlyError(e)); }
  }, [jobId]);
  useEffect(() => { void fetchOrders(); }, [fetchOrders]);
  useLiveReload(fetchOrders, ['job.updated'], (e) => e.data?.jobId === jobId);

  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setBusyId(id);
    setError(undefined);
    try {
      await api.decideChangeOrder(id, decision);
      await fetchOrders();
      onReloadRequested?.();
    } catch (e) { setError(friendlyError(e)); } finally { setBusyId(null); }
  };

  if (!orders.length && !error) return null;

  return (
    <View style={{ marginTop: 24 }}>
      <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>{t('job.changeOrders')}</Text>
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 8 }}>{error}</Text> : null}
      {orders.map((o) => {
        const from = o.status === 'APPROVED' ? o.previousPrice : currentMinor;
        return (
          <View key={o.id} style={{ backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, marginTop: 12 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{t('job.additionalWork')}</Text>
            <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{o.reason}</Text>
            <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 2 }}>{o.addedScope}</Text>
            {o.photos?.length ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {o.photos.map((u) => <Image key={u} source={{ uri: u }} accessibilityLabel={t('changeOrdersList.photoOfTheExtra')} style={{ width: 64, height: 64, borderRadius: 8 }} />)}
              </View>
            ) : null}
            <Text variant="bodyLarge" weight="bold" color={theme.colors.primaryText} style={{ marginTop: 8 }}>
              {from != null && o.status !== 'REJECTED' ? `${formatMoney(from, o.currency, locale)} → ` : t('changeOrdersList.newTotal')}{formatMoney(o.revisedPrice, o.currency, locale)}
            </Text>
            <Text variant="bodySmall" weight="semibold" color={o.status === 'APPROVED' ? theme.colors.successText : o.status === 'REJECTED' ? theme.colors.textSecondary : theme.colors.warning} style={{ marginTop: 6 }}>
              {STATUS_LABEL[o.status]}
            </Text>
            {viewer === 'customer' && o.status === 'PENDING' ? (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                <View style={{ flex: 1 }}><Button title={t('changeOrdersList.keepOldPrice')} variant="secondary" disabled={!!busyId} onPress={() => decide(o.id, 'REJECTED')} /></View>
                <View style={{ flex: 1 }}><Button title={t('changeOrdersList.approve')} variant="primary" disabled={!!busyId} loading={busyId === o.id} onPress={() => decide(o.id, 'APPROVED')} /></View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
