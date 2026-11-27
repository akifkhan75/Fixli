import type { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import type { ProjectStatus, PropertyType, StageStatus, StartWhen, WorkType } from '../services/api';
import { t } from '../i18n';

type Icon = keyof typeof Ionicons.glyphMap;
export type Tone = 'neutral' | 'active' | 'good' | 'warn' | 'bad';

/** One plain sentence per state and viewer; raw enum names never reach the screen. */
export function projectSentence(status: ProjectStatus, viewer: 'customer' | 'worker'): string {
  const c = viewer === 'customer';
  switch (status) {
    case 'DRAFT': return t('project.status.draft');
    case 'OPEN': return c ? t('project.status.openCustomer') : t('project.status.openWorker');
    case 'AWARDED': return c ? t('project.status.awardedCustomer') : t('project.status.awardedWorker');
    case 'IN_PROGRESS': return t('project.status.inProgress');
    case 'COMPLETED': return t('project.status.completed');
    case 'CANCELLED': return t('project.status.cancelled');
  }
}

export function stageLook(status: StageStatus): { label: string; icon: Icon; tone: Tone } {
  switch (status) {
    case 'PENDING': return { label: t('stage.pending'), icon: 'ellipse-outline', tone: 'neutral' };
    case 'FUNDED': return { label: t('stage.funded'), icon: 'lock-closed', tone: 'active' };
    case 'IN_PROGRESS': return { label: t('stage.inProgress'), icon: 'hammer', tone: 'active' };
    case 'SUBMITTED': return { label: t('stage.submitted'), icon: 'eye', tone: 'warn' };
    case 'APPROVED': return { label: t('stage.approved'), icon: 'cash', tone: 'warn' };
    case 'RELEASED': return { label: t('stage.released'), icon: 'checkmark-circle', tone: 'good' };
    case 'DISPUTED': return { label: t('stage.disputed'), icon: 'alert-circle', tone: 'bad' };
    case 'CANCELLED': return { label: t('stage.cancelled'), icon: 'close-circle', tone: 'neutral' };
  }
}

export const WORK_TYPES = (): { id: WorkType; title: string; hint: string; icon: Icon }[] => [
  { id: 'NEW_BUILD', title: t('project.type.newBuild'), hint: t('project.type.newBuildHint'), icon: 'business' },
  { id: 'RENOVATION', title: t('project.type.renovation'), hint: t('project.type.renovationHint'), icon: 'color-fill' },
  { id: 'INSTALLATION', title: t('project.type.installation'), hint: t('project.type.installationHint'), icon: 'build' },
  { id: 'MAINTENANCE', title: t('project.type.maintenance'), hint: t('project.type.maintenanceHint'), icon: 'calendar' },
];

export const PROPERTY_TYPES = (): { id: PropertyType; label: string }[] => [
  { id: 'HOUSE', label: t('project.property.house') },
  { id: 'APARTMENT', label: t('project.property.apartment') },
  { id: 'SHOP', label: t('project.property.shop') },
  { id: 'OFFICE', label: t('project.property.office') },
  { id: 'OTHER', label: t('project.property.other') },
];

export const START_WHEN = (): { id: StartWhen; label: string }[] => [
  { id: 'ASAP', label: t('project.start.asap') },
  { id: 'THIS_MONTH', label: t('project.start.thisMonth') },
  { id: 'LATER', label: t('project.start.later') },
];

export const workTypeLabel = (id: WorkType) => WORK_TYPES().find((w) => w.id === id)!.title;

/** Split a total by percentages into whole currency units; the last stage takes the rounding. */
export function splitByPercent(totalMinor: number, stages: { title: string; percent: number }[], unit: number): { title: string; amount: number }[] {
  let left = totalMinor;
  return stages.map((s, i) => {
    const amount = i === stages.length - 1 ? left : Math.round((totalMinor * s.percent) / 100 / unit) * unit;
    left -= amount;
    return { title: s.title, amount };
  });
}
