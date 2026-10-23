import React, { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { usePhotoUpload } from '../../../src/hooks/usePhotoUpload';
import { useAppDispatch } from '../../../src/hooks/useRedux';
import { setCurrentUser } from '../../../src/store/authSlice';
import { Screen } from '../../../src/components/ds/Screen';
import { Avatar } from '../../../src/components/ds/Avatar';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { PhotoButtons } from '../../../src/components/ds/PhotoButtons';
import { LoadingState } from '../../../src/components/ds/EmptyState';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

const LANGUAGES = ['Urdu', 'English', 'Punjabi', 'Sindhi', 'Pashto', 'Arabic', 'Hindi', 'Bengali'].map((l) => ({ id: l, label: l }));
const GENDERS = () => ([{ id: 'FEMALE', label: t('workerSetupAbout.woman') }, { id: 'MALE', label: t('workerSetupAbout.man') }, { id: 'NONE', label: t('workerSetupAbout.preferNotToSay') }]);

export default function AboutScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const me = useApi(api.getWorkerMe);
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [gender, setGender] = useState<string[]>(['NONE']);
  const [hidePhoto, setHidePhoto] = useState(false);
  const [photo, setPhoto] = useState<{ id: string; localUri: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const upload = usePhotoUpload('AVATAR', { square: true });

  useEffect(() => {
    const w = me.data;
    if (!w) return;
    setBio(w.bio ?? '');
    setYears(w.experienceYears ? String(w.experienceYears) : '');
    setLanguages(w.languages);
    setGender([w.gender ?? 'NONE']);
    setHidePhoto(w.hidePhotoUntilBooked);
  }, [me.data]);

  if (me.loading && !me.data) return <Screen title={t('workerSetupAbout.aboutYou')} back><LoadingState /></Screen>;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      if (photo) dispatch(setCurrentUser(await api.updateMe({ avatarUploadId: photo.id })));
      await api.patchWorkerMe({
        bio: bio.trim() || undefined,
        experienceYears: years ? Math.min(60, parseInt(years, 10) || 0) : 0,
        languages,
        ...(gender[0] && gender[0] !== 'NONE' ? { gender: gender[0] as 'FEMALE' | 'MALE' } : {}),
        hidePhotoUntilBooked: hidePhoto,
      });
      router.back();
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };

  const w = me.data;
  return (
    <Screen title={t('workerSetupAbout.aboutYou')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving} onPress={save} />}>
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <Avatar name={w?.user.name} imageUrl={photo?.localUri ?? w?.user.profileImageUrl} size="xl" />
      </View>
      <PhotoButtons onPick={async (s) => { const u = await upload.run(s); if (u) setPhoto({ id: u.id, localUri: u.localUri }); }} busy={upload.busy} error={upload.error} denied={upload.denied} takeLabel={t('workerSetupAbout.takeAProfilePhoto')} />

      <View style={{ gap: 16, marginTop: 28 }}>
        <TextInput label={t('workerSetupAbout.tellCustomersAboutYour')} value={bio} onChangeText={setBio} multiline maxLength={600} style={{ minHeight: 90, textAlignVertical: 'top' }} />
        <TextInput label={t('workerSetupAbout.yearsOfExperience')} keyboardType="number-pad" value={years} onChangeText={(v) => setYears(v.replace(/\D/g, '').slice(0, 2))} />
      </View>

      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>{t('workerSetupAbout.languagesYouSpeak')}</Text>
      <ChipChoice multiSelect options={LANGUAGES} selectedIds={languages} onChange={setLanguages} />

      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>{t('workerSetupAbout.iAmAOptional')}</Text>
      <ChipChoice options={GENDERS()} selectedIds={gender} onChange={setGender} />
      <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 6 }}>{t('workerSetupAbout.someCustomersPreferA')}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24 }}>
        <View style={{ flex: 1, marginEnd: 12 }}>
          <Text variant="body" weight="medium" color={theme.colors.textPrimary}>{t('workerSetupAbout.hideMyPhotoUntil')}</Text>
          <Text variant="caption" color={theme.colors.textTertiary}>{t('workerSetupAbout.customersWillSeeYour')}</Text>
        </View>
        <Switch value={hidePhoto} onValueChange={setHidePhoto} accessibilityLabel={t('workerSetupAbout.hideMyPhotoUntil')} trackColor={{ true: theme.colors.primary, false: theme.colors.border }} />
      </View>
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
