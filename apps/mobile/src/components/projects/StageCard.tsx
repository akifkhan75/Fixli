import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { friendlyError } from '../../hooks/useApi';
import { usePhotoUpload, type Uploaded } from '../../hooks/usePhotoUpload';
import { formatMoney } from '../../utils/money';
import { stageLook, type Tone } from '../../utils/projectStatus';
import * as api from '../../services/api';
import { Card } from '../ds/Card';
import { Text } from '../ds/Text';
import { TextInput } from '../ds/TextInput';
import { Button } from '../ds/Button';
import { ConfirmButton } from '../ds/ConfirmButton';
import { PhotoButtons } from '../ds/PhotoButtons';
import { PhotoStrip } from '../ds/PhotoStrip';
import { Entrance } from '../motion/Entrance';

type Form = 'submit' | 'changes' | 'problem' | null;

/** One payment stage and the single next thing this person can do with it. */
export function StageCard({ project, stage, current, onChanged, index }: {
  project: api.ProjectView; stage: api.ProjectStage; current: boolean; onChanged: () => unknown; index: number;
}) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const isCustomer = project.viewer === 'customer';
  const escrow = project.paymentMode === 'ESCROW';
  const live = project.status === 'AWARDED' || project.status === 'IN_PROGRESS';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [form, setForm] = useState<Form>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const upload = usePhotoUpload('JOB_PHOTO');

  const look = stageLook(stage.status);
  const toneColor: Record<Tone, string> = { neutral: theme.colors.textTertiary, active: theme.colors.primaryText, good: theme.colors.successText, warn: theme.colors.warningText, bad: theme.colors.errorText };
  const money = formatMoney(stage.amount, project.currency, locale);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      setForm(null);
      setText('');
      setPhotos([]);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
      await onChanged();
    } finally { setBusy(false); }
  };

  const pay = () => run(async () => {
    const { checkoutUrl } = await api.fundStage(stage.id);
    await Linking.openURL(checkoutUrl);
  });

  const note = (message: string) => <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 10 }}>{message}</Text>;

  const action = () => {
    if (!live || !current) return null;
    switch (stage.status) {
      case 'PENDING':
        if (isCustomer) {
          return escrow
            ? <View style={{ marginTop: 12, gap: 6 }}><Button title={t('stage.pay', { amount: money })} variant="accent" size="lg" loading={busy} disabled={busy} onPress={pay} leftIcon={<Ionicons name="lock-closed" size={20} color={theme.colors.onAccent} />} />{note(t('stage.payHint'))}</View>
            : note(t('stage.waitStart'));
        }
        return escrow ? note(t('stage.waitMoney')) : <View style={{ marginTop: 12 }}><Button title={t('stage.start')} size="lg" loading={busy} disabled={busy} onPress={() => run(() => api.startStage(stage.id))} /></View>;
      case 'FUNDED':
        return isCustomer ? note(t('stage.waitStart')) : <View style={{ marginTop: 12 }}><Button title={t('stage.start')} size="lg" loading={busy} disabled={busy} onPress={() => run(() => api.startStage(stage.id))} /></View>;
      case 'IN_PROGRESS':
        if (isCustomer) return note(t('stage.beingDone'));
        return form === 'submit' ? (
          <View style={{ marginTop: 12, gap: 10 }}>
            <PhotoStrip photos={photos.map((p) => ({ id: p.id, uri: p.localUri }))} label={t('stage.workPhoto')} onRemove={(id) => setPhotos((all) => all.filter((p) => p.id !== id))} />
            {photos.length < 6 ? <PhotoButtons onPick={async (src) => { const u = await upload.run(src); if (u) setPhotos((all) => [...all, u]); }} busy={upload.busy} error={upload.error} denied={upload.denied} /> : null}
            <TextInput label={t('stage.whatDone')} value={text} onChangeText={setText} maxLength={1000} multiline />
            <Button title={t('stage.sendForApproval')} size="lg" loading={busy} disabled={busy || upload.busy || (!photos.length && !text.trim())} onPress={() => run(() => api.submitStage(stage.id, { note: text.trim() || undefined, photoUploadIds: photos.map((p) => p.id) }))} />
          </View>
        ) : <View style={{ marginTop: 12 }}><Button title={t('stage.finished')} size="lg" onPress={() => setForm('submit')} /></View>;
      case 'SUBMITTED':
        if (!isCustomer) return note(t('stage.waitApproval'));
        return form === 'changes' ? (
          <View style={{ marginTop: 12, gap: 10 }}>
            <TextInput label={t('stage.whatChange')} value={text} onChangeText={setText} maxLength={1000} multiline />
            <Button title={t('stage.sendBack')} loading={busy} disabled={busy || text.trim().length < 3} onPress={() => run(() => api.requestStageChanges(stage.id, text.trim()))} />
          </View>
        ) : (
          <View style={{ marginTop: 12, gap: 10 }}>
            <ConfirmButton title={t('stage.approve')} question={escrow ? t('stage.approveCard', { amount: money }) : t('stage.approveDirect', { amount: money })} busy={busy} onConfirm={() => run(() => api.approveStage(stage.id))} />
            <Button title={t('stage.askChanges')} variant="secondary" disabled={busy} onPress={() => setForm('changes')} />
            {note(t('stage.autoApprove'))}
          </View>
        );
      case 'APPROVED':
        return isCustomer ? note(t('stage.payNow', { amount: money })) : (
          <View style={{ marginTop: 12 }}>
            <ConfirmButton title={t('stage.received', { amount: money })} question={t('stage.receivedQuestion', { amount: money })} busy={busy} onConfirm={() => run(() => api.markStagePaid(stage.id))} />
          </View>
        );
      case 'DISPUTED':
        return note(t('stage.supportLooking'));
      default:
        return null;
    }
  };

  const canReport = live && current && (['FUNDED', 'IN_PROGRESS', 'SUBMITTED'].includes(stage.status) || (stage.status === 'APPROVED' && !escrow));

  return (
    <Entrance index={index}>
      <Card highlight={current && live ? theme.colors.primary : undefined} style={{ marginBottom: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Ionicons name={look.icon} size={26} color={toneColor[look.tone]} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyLarge" weight="bold">{stage.position + 1}. {stage.title}</Text>
            <Text variant="bodySmall" weight="semibold" color={toneColor[look.tone]}>{look.label}</Text>
          </View>
          <Text variant="bodyLarge" weight="bold" tabular>{money}</Text>
        </View>
        {stage.submittedNote && ['SUBMITTED', 'APPROVED', 'RELEASED', 'DISPUTED'].includes(stage.status) ? <Text variant="body" style={{ marginTop: 10 }}>"{stage.submittedNote}"</Text> : null}
        {stage.changesNote && stage.status === 'IN_PROGRESS' ? (
          <View style={{ backgroundColor: theme.colors.warningSoft, borderRadius: theme.borderRadius.md, padding: 10, marginTop: 10 }}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.warningText}>{t('stage.changesAsked', { note: stage.changesNote })}</Text>
          </View>
        ) : null}
        {stage.evidence.length ? <View style={{ marginTop: 10 }}><PhotoStrip photos={stage.evidence.map((uri) => ({ id: uri, uri }))} label={t('stage.workPhoto')} size={96} /></View> : null}
        {action()}
        {canReport ? (form === 'problem' ? (
          <View style={{ marginTop: 12, gap: 10 }}>
            <TextInput label={t('stage.whatWrong')} value={text} onChangeText={setText} maxLength={120} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button title={t('authSignup.back')} variant="secondary" onPress={() => setForm(null)} /></View>
              <View style={{ flex: 1 }}><Button title={t('cashConfirmCard.tellFixli')} variant="danger" loading={busy} disabled={busy || text.trim().length < 3} onPress={() => run(() => api.disputeStage(stage.id, text.trim()))} /></View>
            </View>
          </View>
        ) : <Button title={t('stage.problem')} variant="ghost" onPress={() => { setForm('problem'); setText(''); }} style={{ marginTop: 6 }} />) : null}
        {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 8 }}>{error}</Text> : null}
      </Card>
    </Entrance>
  );
}
