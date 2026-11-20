import React, { useState } from 'react';
import { View, Image, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { friendlyError } from '../../../src/hooks/useApi';
import { useWorkerMe } from '../../../src/hooks/useWorkerMe';
import { usePhotoUpload, type Uploaded } from '../../../src/hooks/usePhotoUpload';
import { useCountry } from '../../../src/hooks/useCountry';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { PhotoButtons } from '../../../src/components/ds/PhotoButtons';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { formatCnic, isCompleteCnic } from '../../../src/utils/cnic';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

const STATUS_TEXT = { SUBMITTED: 'Being checked', APPROVED: 'Approved', REJECTED: 'Needs to be redone', NEEDS_INFO: 'Needs to be redone' } as const;

export default function DocumentsScreen() {
  const theme = useTheme();
  const { country } = useCountry();
  const { data: me, loading, error, reload, setData } = useWorkerMe();
  const [front, setFront] = useState<Uploaded | null>(null);
  const [back, setBack] = useState<Uploaded | null>(null);
  const [selfie, setSelfie] = useState<Uploaded | null>(null);
  const [idNumber, setIdNumber] = useState('');
  const [busy, setBusy] = useState<'ID' | 'SELFIE' | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const frontUp = usePhotoUpload('VERIFICATION');
  const backUp = usePhotoUpload('VERIFICATION');
  const selfieUp = usePhotoUpload('VERIFICATION', { frontCamera: true });

  if (loading && !me) return <Screen title={t('workerAccount.idAndSelfie')} back><LoadingState /></Screen>;
  if (error && !me) return <Screen title={t('workerAccount.idAndSelfie')} back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!me) return null;

  const idCase = me.verifications.find((v) => v.type === 'ID');
  const selfieCase = me.verifications.find((v) => v.type === 'SELFIE');
  const cnic = country === 'PK';
  const redo = (c?: { status: string }) => !c || c.status === 'REJECTED' || c.status === 'NEEDS_INFO';

  const submit = async (type: 'ID' | 'SELFIE') => {
    setFormError(undefined);
    setMessage(undefined);
    if (type === 'ID' && cnic && !isCompleteCnic(idNumber)) { setFormError(t('workerSetupDocuments.enterYour13Digit')); return; }
    setBusy(type);
    try {
      const next = type === 'ID'
        ? await api.submitWorkerDocument('ID', [front!.id, back!.id], idNumber || undefined)
        : await api.submitWorkerDocument('SELFIE', [selfie!.id]);
      setData(next);
      setMessage(type === 'ID' ? 'ID sent. We will check it soon.' : 'Selfie sent. We will check it soon.');
      if (type === 'ID') { setFront(null); setBack(null); } else setSelfie(null);
    } catch (e) { setFormError(friendlyError(e)); } finally { setBusy(null); }
  };

  const slot = ({ title, photo, up, onDone, frontCam }: { title: string; photo: Uploaded | null; up: ReturnType<typeof usePhotoUpload>; onDone: (u: Uploaded) => void; frontCam?: boolean }) => (
    <View style={{ marginBottom: 16 }}>
      <Text variant="body" weight="medium" color={theme.colors.textPrimary} style={{ marginBottom: 8 }}>{title}</Text>
      {photo ? (
        <View>
          <Image source={{ uri: photo.localUri }} accessibilityLabel={title} style={{ width: '100%', height: 180, borderRadius: 12, backgroundColor: theme.colors.surface }} />
          <TouchableOpacity onPress={async () => { const u = await up.run('camera'); if (u) onDone(u); }} accessibilityRole="button" style={{ marginTop: 8 }}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.primaryText}>{t('workerSetupDocuments.retake')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <PhotoButtons onPick={async (src) => { const u = await up.run(src); if (u) onDone(u); }} busy={up.busy} error={up.error} denied={up.denied} takeLabel={frontCam ? t('workerSetupDocuments.takeASelfie') : t('workerSetupDocuments.takeAPhoto')} />
      )}
    </View>
  );

  return (
    <Screen title={t('workerAccount.idAndSelfie')} back>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 20 }}>{t('workerSetupDocuments.weCheckYourId')}</Text>

      <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{cnic ? t('workerSetupDocuments.nationalIdCardCnic') : t('workerSetupDocuments.nationalIdCard')}</Text>
      {idCase ? <Text variant="bodySmall" color={idCase.status === 'APPROVED' ? theme.colors.successText : redo(idCase) ? theme.colors.error : theme.colors.textSecondary} style={{ marginTop: 4 }}>{STATUS_TEXT[idCase.status]}{idCase.reason ? `: ${idCase.reason}` : ''}</Text> : null}
      {redo(idCase) ? (
        <View style={{ marginTop: 12 }}>
          {slot({ title: t('workerSetupDocuments.frontOfTheCard'), photo: front, up: frontUp, onDone: setFront })}
          {slot({ title: t('workerSetupDocuments.backOfTheCard'), photo: back, up: backUp, onDone: setBack })}
          {cnic ? <TextInput label={t('workerSetupDocuments.cnicNumber')} placeholder="12345-1234567-1" keyboardType="number-pad" value={idNumber} onChangeText={(v) => setIdNumber(formatCnic(v))} maxLength={15} /> : null}
          <View style={{ marginTop: 16 }}><Button title={t('workerSetupDocuments.sendId')} size="lg" variant="primary" loading={busy === 'ID'} disabled={!front || !back || !!busy} onPress={() => submit('ID')} /></View>
        </View>
      ) : null}

      <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 32 }}>{t('workerSetupDocuments.selfie')}</Text>
      {selfieCase ? <Text variant="bodySmall" color={selfieCase.status === 'APPROVED' ? theme.colors.successText : redo(selfieCase) ? theme.colors.error : theme.colors.textSecondary} style={{ marginTop: 4 }}>{STATUS_TEXT[selfieCase.status]}{selfieCase.reason ? `: ${selfieCase.reason}` : ''}</Text> : null}
      {redo(selfieCase) ? (
        <View style={{ marginTop: 12 }}>
          {slot({ title: t('workerSetupDocuments.aClearPhotoOf'), photo: selfie, up: selfieUp, onDone: setSelfie, frontCam: true })}
          <Button title={t('workerSetupDocuments.sendSelfie')} size="lg" variant="primary" loading={busy === 'SELFIE'} disabled={!selfie || !!busy} onPress={() => submit('SELFIE')} />
        </View>
      ) : null}

      {formError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{formError}</Text> : null}
      {message ? <Text variant="bodySmall" color={theme.colors.successText} accessibilityRole="alert" style={{ marginTop: 16 }}>{message}</Text> : null}
      {idCase && selfieCase ? <View style={{ marginTop: 24 }}><Button title={t('workerSetupDocuments.backToChecklist')} variant="secondary" onPress={() => router.back()} /></View> : null}
    </Screen>
  );
}
