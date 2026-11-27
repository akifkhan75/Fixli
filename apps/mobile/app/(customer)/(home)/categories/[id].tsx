import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../../src/hooks/useTheme';
import { useI18n } from '../../../../src/hooks/useI18n';
import { useApi } from '../../../../src/hooks/useApi';
import { Screen } from '../../../../src/components/ds/Screen';
import { Text } from '../../../../src/components/ds/Text';
import { Card } from '../../../../src/components/ds/Card';
import { DirIcon } from '../../../../src/components/ds/DirIcon';
import { ErrorState, LoadingState } from '../../../../src/components/ds/EmptyState';
import { Entrance } from '../../../../src/components/motion/Entrance';
import { getCatalog } from '../../../../src/services/api';
import { categoryTint } from '../../../../src/utils/categoryTint';
import { humanize, localizedName } from '../../../../src/utils/catalog';

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { data, loading, error, reload } = useApi(getCatalog, [], { cacheKey: 'catalog' });
  const category = data?.find((c) => c.id === id);

  if (loading && !data) return <Screen title={t('customerHomeCategories.services')} back><LoadingState /></Screen>;
  if (error && !data) return <Screen title={t('customerHomeCategories.services')} back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!category) return <Screen title={t('customerHomeCategories.services')} back><Text variant="body" color={theme.colors.textSecondary}>{t('customerHomeCategories.weCouldntFindThat')}</Text></Screen>;

  const title = localizedName({ name: category.translations?.en?.name ?? humanize(category.name), translations: category.translations }, locale);
  const tint = categoryTint(category.name, theme.categoryColors);
  const start = (issueCode?: string) => router.push({ pathname: '/(customer)/(home)/request-service', params: { categoryId: category.id, ...(issueCode ? { issue: issueCode } : {}) } } as any);

  return (
    <Screen title={title} back>
      <Entrance style={{ alignItems: 'center', marginBottom: theme.spacing.xl }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={(category.iconName as keyof typeof Ionicons.glyphMap) ?? 'construct'} size={44} color={tint} />
        </View>
      </Entrance>
      <Text variant="bodyLarge" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('customerHomeCategories.whatsTheProblem')}</Text>
      {category.issues.map((issue, index) => (
        <Entrance key={issue.id} index={index}>
          <Card onPress={() => start(issue.code)} accessibilityLabel={localizedName(issue, locale)} style={{ minHeight: 60, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyLarge" style={{ flex: 1 }}>{localizedName(issue, locale)}</Text>
            <DirIcon name="chevron-forward" size={20} color={theme.colors.textTertiary} />
          </Card>
        </Entrance>
      ))}
      <Card onPress={() => start()} accessibilityLabel={t('customerHomeCategories.somethingElse')} tint={theme.colors.primarySoft} style={{ minHeight: 60, marginTop: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="mic" size={22} color={theme.colors.primaryText} />
        <Text variant="bodyLarge" color={theme.colors.primaryText} weight="semibold" style={{ flex: 1, marginStart: 12 }}>{t('customerHomeCategories.somethingElse')}</Text>
        <DirIcon name="chevron-forward" size={20} color={theme.colors.primaryText} />
      </Card>
    </Screen>
  );
}
