import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { TextInput, TextInputProps } from './TextInput';

/** Password input with a show/hide toggle (people mistype on small keyboards). */
export const PasswordField = ({ isNew, textContentType, autoComplete, ...props }: TextInputProps & { isNew?: boolean }) => {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <TextInput
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete={autoComplete ?? (isNew ? 'off' : 'current-password')}
      textContentType={textContentType ?? 'password'}
      rightIcon={
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={22} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      }
      {...props}
    />
  );
};
