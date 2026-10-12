import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { usePhotoUpload, type Uploaded } from '../../hooks/usePhotoUpload';
import { PhotoButtons } from './PhotoButtons';
import { ChipChoice } from './ChipChoice';
import { Button } from './Button';
import { Text } from './Text';
import { t } from '../../i18n';

export type PhotoSkipReason = 'CAMERA_UNAVAILABLE' | 'CUSTOMER_DECLINED' | 'NOT_APPLICABLE';
const SKIP = (): { id: PhotoSkipReason; label: string }[] => ([
  { id: 'CAMERA_UNAVAILABLE', label: t('jobStepPhoto.myCameraIsntWorking') },
  { id: 'CUSTOMER_DECLINED', label: t('jobStepPhoto.theCustomerDoesntWant') },
  { id: 'NOT_APPLICABLE', label: t('jobStepPhoto.nothingToPhotograph') },
]);

/**
 * Before/after evidence for Start and Finish (doc 22): camera first, up to 4 photos, or say why
 * there can't be one. Photos protect both sides if there's a disagreement later.
 */
export function JobStepPhoto({ kind, busy, onSubmit, onCancel }: {
  kind: 'before' | 'after';
  busy?: boolean;
  onSubmit: (v: { photoUploadIds?: string[]; localPhotoUris?: string[]; photoSkipReason?: PhotoSkipReason }) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const up = usePhotoUpload('JOB_PHOTO', { keepIfOffline: true });
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState<string[]>([]);

  return (
    <View style={{ marginTop: 20, backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, gap: 12 }}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{kind === 'before' ? t('jobStepPhoto.photoBeforeYouStart') : t('jobStepPhoto.photoOfTheFinished')}</Text>
      <Text variant="body" color={theme.colors.textSecondary}>
        {kind === 'before' ? t('jobStepPhoto.showProblem') : t('jobStepPhoto.showWork')} {t('jobStepPhoto.bothSee')}
      </Text>
      {!skipping ? (
        <>
          {photos.length ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {photos.map((p) => <Image key={p.id || p.localUri} source={{ uri: p.localUri }} accessibilityLabel={t('jobStepPhoto.photoAdded')} style={{ width: 72, height: 72, borderRadius: 8 }} />)}
            </View>
          ) : null}
          {photos.some((p) => p.pending) ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('offline.photoSaved')}</Text> : null}
          {photos.length < 4 ? (
            <PhotoButtons
              onPick={async (src) => { const u = await up.run(src); if (u) setPhotos((p) => [...p, u]); }}
              busy={up.busy} error={up.error} denied={up.denied}
              takeLabel={photos.length ? t('jobStepPhoto.addAnotherPhoto') : t('workerSetupDocuments.takeAPhoto')}
            />
          ) : null}
          <Button
            title={kind === 'before' ? t('workerJob.startWork') : t('workerJob.finishWork')} variant="primary" size="lg"
            disabled={!photos.length || busy || up.busy} loading={busy}
            onPress={() => onSubmit({
              photoUploadIds: photos.filter((p) => !p.pending).map((p) => p.id),
              ...(photos.some((p) => p.pending) ? { localPhotoUris: photos.filter((p) => p.pending).map((p) => p.localUri) } : {}),
            })}
          />
          <Button title={t('jobStepPhoto.iCantTakeA')} variant="ghost" disabled={busy} onPress={() => setSkipping(true)} />
        </>
      ) : (
        <>
          <Text variant="body" weight="semibold" color={theme.colors.textPrimary}>{t('jobStepPhoto.whyNot')}</Text>
          <ChipChoice options={SKIP()} selectedIds={reason} onChange={setReason} />
          <Button
            title={kind === 'before' ? t('jobStepPhoto.startWithoutAPhoto') : t('jobStepPhoto.finishWithoutAPhoto')} variant="primary" size="lg"
            disabled={!reason[0] || busy} loading={busy}
            onPress={() => onSubmit({ photoSkipReason: reason[0] as PhotoSkipReason })}
          />
          <Button title={t('jobStepPhoto.takeAPhotoInstead')} variant="ghost" disabled={busy} onPress={() => setSkipping(false)} />
        </>
      )}
      <Button title={t('changeOrderForm.cancel')} variant="secondary" disabled={busy} onPress={onCancel} />
    </View>
  );
}
