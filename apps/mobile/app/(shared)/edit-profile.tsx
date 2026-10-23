import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser, setCurrentUser } from '../../src/store/authSlice';
import { useTheme } from '../../src/hooks/useTheme';
import { usePhotoUpload } from '../../src/hooks/usePhotoUpload';
import { friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Avatar } from '../../src/components/ds/Avatar';
import { Button } from '../../src/components/ds/Button';
import { Text } from '../../src/components/ds/Text';
import { TextInput } from '../../src/components/ds/TextInput';
import { PhotoButtons } from '../../src/components/ds/PhotoButtons';
import * as api from '../../src/services/api';
import { formatPhoneDisplay } from '@fixli/shared';
import { t } from '../../src/i18n';

export default function EditProfileScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectCurrentUser);
  const [name, setName] = useState(user?.name ?? '');
  const [photo, setPhoto] = useState<{ id: string; localUri: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const upload = usePhotoUpload('AVATAR', { square: true });

  const nameError = name.trim().length < 2 ? 'Please enter your name.' : undefined;
  const dirty = name.trim() !== user?.name || !!photo;

  const pick = async (source: 'camera' | 'library') => {
    const up = await upload.run(source);
    if (up) setPhoto({ id: up.id, localUri: up.localUri });
  };

  const save = async () => {
    if (nameError) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.updateMe({ name: name.trim(), avatarUploadId: photo?.id });
      dispatch(setCurrentUser(updated));
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title={t('customerProfile.editProfile')}
      back
      footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={!dirty || !!nameError || saving} onPress={save} />}
    >
      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <Avatar name={name || user?.name} imageUrl={photo?.localUri ?? user?.profileImageUrl} size="xl" />
      </View>
      <PhotoButtons onPick={pick} busy={upload.busy} error={upload.error} denied={upload.denied} takeLabel={t('sharedEditProfile.takeANewPhoto')} />

      <View style={{ marginTop: 28 }}>
        <TextInput label={t('sharedEditProfile.fullName')} value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" error={dirty ? nameError : undefined} />
        <View style={{ height: 16 }} />
        <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary}>{t('sharedEditProfile.mobileNumber')}</Text>
        <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ marginTop: 6 }}>{formatPhoneDisplay(user?.phone)}</Text>
        <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 4 }}>{t('sharedEditProfile.yourNumberIsYour')}</Text>
      </View>
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
