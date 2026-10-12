import React, { useState } from 'react';
import { View, Image, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../src/hooks/useTheme';
import { friendlyError } from '../../../src/hooks/useApi';
import { useWorkerMe } from '../../../src/hooks/useWorkerMe';
import { usePhotoUpload, type Uploaded } from '../../../src/hooks/usePhotoUpload';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { PhotoButtons } from '../../../src/components/ds/PhotoButtons';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

export default function PortfolioScreen() {
  const theme = useTheme();
  const { data: me, loading, error, reload, setData } = useWorkerMe();
  const [title, setTitle] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const upload = usePhotoUpload('PORTFOLIO');

  if (loading && !me) return <Screen title={t('workerSetupPortfolio.pastWork')} back><LoadingState /></Screen>;
  if (error && !me) return <Screen title={t('workerSetupPortfolio.pastWork')} back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!me) return null;

  const add = async () => {
    setSaving(true);
    setFormError(undefined);
    try {
      setData(await api.addPortfolioItem(title.trim(), photos.map((p) => p.id)));
      setTitle('');
      setPhotos([]);
    } catch (e) { setFormError(friendlyError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    try { setData(await api.removePortfolioItem(id)); } catch (e) { setFormError(friendlyError(e)); }
  };

  return (
    <Screen title={t('workerSetupPortfolio.pastWork')} back>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 16 }}>{t('workerSetupPortfolio.photosOfJobsYou')}</Text>

      {!me.portfolio.length ? <EmptyState icon="images-outline" title={t('workerSetupPortfolio.noPhotosYet')} message={t('workerSetupPortfolio.addYourFirstFinished')} /> : me.portfolio.map((p) => (
        <View key={p.id} style={{ marginBottom: 20 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {p.photos.map((uri) => <Image key={uri} source={{ uri }} accessibilityLabel={p.title} style={{ width: 180, height: 135, borderRadius: 12, marginEnd: 8, backgroundColor: theme.colors.surface }} />)}
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            <Text variant="body" weight="medium" color={theme.colors.textPrimary} style={{ flex: 1 }}>{p.title}</Text>
            <TouchableOpacity onPress={() => remove(p.id)} accessibilityRole="button" accessibilityLabel={t('workerSetupPortfolio.remove', { title: p.title })} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text variant="bodySmall" weight="semibold" color={theme.colors.errorText}>{t('sharedTrustedContacts.remove')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 12, marginBottom: 12 }}>{t('workerSetupPortfolio.addAFinishedJob')}</Text>
      <TextInput label={t('workerSetupPortfolio.whatDidYouDo')} placeholder={t('workerSetupPortfolio.eGReplacedKitchen')} value={title} onChangeText={setTitle} maxLength={80} />
      <ScrollView horizontal style={{ marginVertical: 12 }}>
        {photos.map((p) => <Image key={p.id} source={{ uri: p.localUri }} style={{ width: 90, height: 90, borderRadius: 10, marginEnd: 8 }} />)}
      </ScrollView>
      {photos.length < 6 ? <PhotoButtons onPick={async (s) => { const u = await upload.run(s); if (u) setPhotos((cur) => [...cur, u]); }} busy={upload.busy} error={upload.error} denied={upload.denied} takeLabel={t('workerSetupDocuments.takeAPhoto')} /> : null}
      <View style={{ marginTop: 16 }}><Button title={t('workerSetupPortfolio.addToMyProfile')} size="lg" variant="primary" loading={saving} disabled={saving || !title.trim() || photos.length === 0} onPress={add} /></View>
      {formError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 12 }}>{formError}</Text> : null}
    </Screen>
  );
}
