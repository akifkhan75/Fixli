import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../../src/hooks/useTheme';
import { useI18n } from '../../../../src/hooks/useI18n';
import { useApi } from '../../../../src/hooks/useApi';
import { Screen } from '../../../../src/components/ds/Screen';
import { Text } from '../../../../src/components/ds/Text';
import { ErrorState, LoadingState } from '../../../../src/components/ds/EmptyState';
import { getCatalog } from '../../../../src/services/api';
import { humanize, localizedName } from '../../../../src/utils/catalog';
import { DirIcon } from '../../../../src/components/ds/DirIcon';

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { locale } = useI18n();
  const { data, loading, error, reload } = useApi(getCatalog);
  const category = data?.find((c) => c.id === id);

  if (loading && !data) return <Screen title="Services" back><LoadingState /></Screen>;
  if (error && !data) return <Screen title="Services" back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!category) return <Screen title="Services" back><Text variant="body" color={theme.colors.textSecondary}>We couldn't find that service.</Text></Screen>;

  const title = localizedName({ name: category.translations?.en?.name ?? humanize(category.name), translations: category.translations }, locale);
  const start = (issueCode?: string) => router.push({ pathname: '/(customer)/request-service', params: { categoryId: category.id, ...(issueCode ? { issue: issueCode } : {}) } } as any);

  return (
    <Screen title={title} back>
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>What's the problem?</Text>
      {category.issues.map((issue) => (
        <TouchableOpacity
          key={issue.id}
          onPress={() => start(issue.code)}
          accessibilityRole="button"
          accessibilityLabel={localizedName(issue, locale)}
          activeOpacity={0.8}
          style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, paddingHorizontal: 16, minHeight: 56, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}
        >
          <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ flex: 1 }}>{localizedName(issue, locale)}</Text>
          <DirIcon name="chevron-forward" size={20} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      ))}
      <TouchableOpacity onPress={() => start()} accessibilityRole="button" activeOpacity={0.8}
        style={{ borderColor: theme.colors.border, borderWidth: 1.5, borderRadius: theme.borderRadius.xl, paddingHorizontal: 16, minHeight: 56, marginTop: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="bodyLarge" color={theme.colors.primary} weight="semibold" style={{ flex: 1 }}>Something else</Text>
        <DirIcon name="chevron-forward" size={20} color={theme.colors.primary} />
      </TouchableOpacity>
    </Screen>
  );
}
