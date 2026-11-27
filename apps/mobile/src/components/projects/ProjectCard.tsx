import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { routes } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { categoryTint } from '../../utils/categoryTint';
import { projectSentence, stageLook, workTypeLabel } from '../../utils/projectStatus';
import { catalogName } from '../../utils/catalog';
import { formatMoney } from '../../utils/money';
import type { ProjectFeedItem, ProjectListItem } from '../../services/api';
import { Card } from '../ds/Card';
import { Text } from '../ds/Text';
import { ProgressBar } from '../motion/ProgressBar';
import { Entrance } from '../motion/Entrance';

export function budgetText(min: number | null, max: number | null, currency: string, locale: string, unknown: string) {
  if (min && max) return `${formatMoney(min, currency, locale)} – ${formatMoney(max, currency, locale)}`;
  const one = min ?? max;
  return one ? formatMoney(one, currency, locale) : unknown;
}

/** A project in a list: the trade, what it is, where it stands, and the money. */
export function ProjectCard({ project, viewer, index = 0 }: { project: ProjectListItem | ProjectFeedItem; viewer: 'customer' | 'worker'; index?: number }) {
  const theme = useTheme();
  const { t, tn, locale } = useI18n();
  const tint = categoryTint(project.category?.name, theme.categoryColors);
  const mine = 'status' in project ? project : null;
  const feed = 'myBid' in project ? project : null;
  const place = [project.area, project.city].filter(Boolean).join(', ');
  // A budget is labelled as one, so it is never mistaken for an agreed price.
  const money = mine?.agreedAmount ? formatMoney(mine.agreedAmount, project.currency, locale)
    : project.budgetMin || project.budgetMax ? `${t('project.budget')}: ${budgetText(project.budgetMin, project.budgetMax, project.currency, locale, '')}`
    : t('project.budgetOpen');

  return (
    <Entrance index={index}>
      <Card onPress={() => router.push((viewer === 'customer' ? routes.customerProject(project.id) : routes.workerProject(project.id)) as any)} accessibilityLabel={project.title} style={{ marginBottom: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={(project.category?.iconName as keyof typeof Ionicons.glyphMap) ?? 'business'} size={26} color={tint} />
          </View>
          <View style={{ flex: 1, marginStart: 12 }}>
            <Text variant="bodyLarge" weight="bold" numberOfLines={2}>{project.title}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{catalogName(project.category, locale)} · {workTypeLabel(project.workType)}</Text>
          </View>
        </View>
        {mine ? <Text variant="bodySmall" weight="medium" color={theme.colors.primaryText} style={{ marginTop: 10 }}>{projectSentence(mine.status, viewer)}</Text> : null}
        {mine && mine.stages.total > 0 ? (
          <View style={{ marginTop: 8, gap: 6 }}>
            <ProgressBar value={mine.stages.done / mine.stages.total} color={theme.colors.success} label={t('project.stagesDone', { done: mine.stages.done, total: mine.stages.total })} />
            <Text variant="caption" color={theme.colors.textSecondary}>
              {t('project.stagesDone', { done: mine.stages.done, total: mine.stages.total })}{mine.currentStage ? ` · ${mine.currentStage.title}: ${stageLook(mine.currentStage.status).label}` : ''}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <Text variant="body" weight="bold" tabular>{money}</Text>
          {mine?.bidCount && mine.status === 'OPEN' ? <Text variant="bodySmall" weight="bold" color={theme.colors.successText}>{tn('project.pricesIn', mine.bidCount)}</Text> : null}
          {feed?.myBid?.status === 'PENDING' ? <Text variant="bodySmall" weight="bold" color={theme.colors.successText}>{t('workerJobs.priceSent')}</Text> : null}
        </View>
        {place ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>
            {place}{feed?.distanceKm != null ? ` · ${t('offerCard.kmAway', { km: feed.distanceKm })}` : ''}
          </Text>
        ) : null}
      </Card>
    </Entrance>
  );
}
