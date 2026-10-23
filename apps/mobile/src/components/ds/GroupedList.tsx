import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { DirIcon } from './DirIcon';

export interface ListRowItem {
  id: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Current value shown at the end of the row (e.g. "English", "3"). */
  value?: string | null;
  /** Small status text under the label. */
  hint?: string | null;
  onPress?: () => void;
  destructive?: boolean;
  /** Replaces the chevron, e.g. a status badge. */
  trailing?: React.ReactNode;
}

/** iOS-style inset grouped list: one rounded card, hairline separators, 56pt rows. */
export function GroupedList({ items, title }: { items: ListRowItem[]; title?: string }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 24 }}>
      {title ? <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginBottom: 8, marginStart: 4 }}>{title.toUpperCase()}</Text> : null}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, borderColor: theme.colors.border }]}>
        {items.map((item, i) => {
          const color = item.destructive ? theme.colors.error : theme.colors.textPrimary;
          return (
            <View key={item.id}>
              <TouchableOpacity
                style={styles.row}
                onPress={item.onPress}
                disabled={!item.onPress}
                activeOpacity={0.7}
                accessibilityRole={item.onPress ? 'button' : 'text'}
                accessibilityLabel={[item.label, item.value, item.hint].filter(Boolean).join(', ')}
              >
                {item.icon ? (
                  <View style={[styles.icon, { backgroundColor: (item.destructive ? theme.colors.error : theme.colors.primary) + '15' }]}>
                    <Ionicons name={item.icon} size={20} color={item.destructive ? theme.colors.error : theme.colors.primary} />
                  </View>
                ) : null}
                <View style={{ flex: 1, marginStart: item.icon ? 14 : 0 }}>
                  <Text variant="body" weight="medium" color={color}>{item.label}</Text>
                  {item.hint ? <Text variant="caption" color={theme.colors.textSecondary}>{item.hint}</Text> : null}
                </View>
                {item.value ? <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginEnd: 8 }}>{item.value}</Text> : null}
                {item.trailing ?? (item.onPress && !item.destructive ? <DirIcon name="chevron-forward" size={20} color={theme.colors.textTertiary} /> : null)}
              </TouchableOpacity>
              {i < items.length - 1 ? <View style={[styles.sep, { backgroundColor: theme.colors.border, marginStart: item.icon ? 70 : 16 }]} /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  icon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sep: { height: StyleSheet.hairlineWidth },
});
