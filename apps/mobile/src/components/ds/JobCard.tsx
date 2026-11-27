import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { categoryTint } from '../../utils/categoryTint';
import { statusIcon, statusSentence, type Viewer } from '../../utils/jobStatus';
import type { JobView } from '../../services/api';
import { Card } from './Card';
import { Text } from './Text';
import { DirIcon } from './DirIcon';

/** One job in a list: trade picture, what it is, and what is happening now in a plain sentence. */
export function JobCard({ job, viewer, locale, onPress }: { job: JobView; viewer: Viewer; locale: string; onPress: () => void }) {
  const theme = useTheme();
  const tint = categoryTint(job.category?.name, theme.categoryColors);
  const cancelled = job.status === 'CANCELLED';
  const done = job.status === 'COMPLETED';
  const statusColor = cancelled ? theme.colors.errorText : done ? theme.colors.successText : theme.colors.primaryText;

  return (
    <Card onPress={onPress} style={{ marginBottom: theme.spacing.md, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={(job.category?.iconName as keyof typeof Ionicons.glyphMap) ?? 'construct'} size={26} color={tint} />
      </View>
      <View style={{ flex: 1, marginHorizontal: theme.spacing.md }}>
        <Text variant="bodyLarge" weight="bold" numberOfLines={2}>{job.title ?? job.description}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 }}>
          <Ionicons name={statusIcon(job.status)} size={16} color={statusColor} style={{ marginTop: 2 }} />
          <Text variant="bodySmall" weight="medium" color={statusColor} style={{ flex: 1 }}>{statusSentence(job.status, viewer, viewer === 'customer' ? job.assignedWorker?.user.name : job.customer?.name)}</Text>
        </View>
        <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 4 }}>
          {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(job.createdAt))}
        </Text>
      </View>
      <DirIcon name="chevron-forward" size={20} color={theme.colors.textTertiary} />
    </Card>
  );
}
