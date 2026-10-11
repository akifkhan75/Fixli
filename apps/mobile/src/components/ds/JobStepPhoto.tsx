import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { usePhotoUpload, type Uploaded } from '../../hooks/usePhotoUpload';
import { PhotoButtons } from './PhotoButtons';
import { ChipChoice } from './ChipChoice';
import { Button } from './Button';
import { Text } from './Text';

export type PhotoSkipReason = 'CAMERA_UNAVAILABLE' | 'CUSTOMER_DECLINED' | 'NOT_APPLICABLE';
const SKIP: { id: PhotoSkipReason; label: string }[] = [
  { id: 'CAMERA_UNAVAILABLE', label: "My camera isn't working" },
  { id: 'CUSTOMER_DECLINED', label: "The customer doesn't want photos" },
  { id: 'NOT_APPLICABLE', label: 'Nothing to photograph' },
];

/**
 * Before/after evidence for Start and Finish (doc 22): camera first, up to 4 photos, or say why
 * there can't be one. Photos protect both sides if there's a disagreement later.
 */
export function JobStepPhoto({ kind, busy, onSubmit, onCancel }: {
  kind: 'before' | 'after';
  busy?: boolean;
  onSubmit: (v: { photoUploadIds?: string[]; photoSkipReason?: PhotoSkipReason }) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const up = usePhotoUpload('JOB_PHOTO');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState<string[]>([]);

  return (
    <View style={{ marginTop: 20, backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, gap: 12 }}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{kind === 'before' ? 'Photo before you start' : 'Photo of the finished work'}</Text>
      <Text variant="body" color={theme.colors.textSecondary}>
        {kind === 'before' ? 'Show the problem as you found it.' : 'Show the work you did.'} Both of you can see these photos.
      </Text>
      {!skipping ? (
        <>
          {photos.length ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {photos.map((p) => <Image key={p.id} source={{ uri: p.localUri }} accessibilityLabel="Photo added" style={{ width: 72, height: 72, borderRadius: 8 }} />)}
            </View>
          ) : null}
          {photos.length < 4 ? (
            <PhotoButtons
              onPick={async (src) => { const u = await up.run(src); if (u) setPhotos((p) => [...p, u]); }}
              busy={up.busy} error={up.error} denied={up.denied}
              takeLabel={photos.length ? 'Add another photo' : 'Take a photo'}
            />
          ) : null}
          <Button
            title={kind === 'before' ? 'Start work' : 'Finish work'} variant="primary" size="lg"
            disabled={!photos.length || busy || up.busy} loading={busy}
            onPress={() => onSubmit({ photoUploadIds: photos.map((p) => p.id) })}
          />
          <Button title="I can't take a photo" variant="ghost" disabled={busy} onPress={() => setSkipping(true)} />
        </>
      ) : (
        <>
          <Text variant="body" weight="semibold" color={theme.colors.textPrimary}>Why not?</Text>
          <ChipChoice options={SKIP} selectedIds={reason} onChange={setReason} />
          <Button
            title={kind === 'before' ? 'Start without a photo' : 'Finish without a photo'} variant="primary" size="lg"
            disabled={!reason[0] || busy} loading={busy}
            onPress={() => onSubmit({ photoSkipReason: reason[0] as PhotoSkipReason })}
          />
          <Button title="Take a photo instead" variant="ghost" disabled={busy} onPress={() => setSkipping(false)} />
        </>
      )}
      <Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
    </View>
  );
}
