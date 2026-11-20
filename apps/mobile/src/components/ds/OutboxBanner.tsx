import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { outbox } from '../../services/offline';
import { Text } from './Text';
import { useI18n } from '../../hooks/useI18n';

/** Thin strip: "2 items waiting to send". Shows only while something is queued for this user. */
export function OutboxBanner({ userId }: { userId: string }) {
  const theme = useTheme();
  const { tn } = useI18n();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => { void outbox.list(userId).then((l) => setCount(l.length)); };
    refresh();
    return outbox.subscribe(refresh);
  }, [userId]);
  if (count === 0) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: theme.colors.warning, paddingVertical: 6, paddingHorizontal: 16 }}>
      <Text variant="bodySmall" weight="semibold" color="#111827" style={{ textAlign: 'center' }}>
        {tn('outbox.waiting', count)}
      </Text>
    </View>
  );
}
