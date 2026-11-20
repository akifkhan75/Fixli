import React from 'react';
import { Modal, View, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CountryCode, CountryListItem } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';

export interface CountryPickerProps {
  visible: boolean;
  title: string;
  countries: CountryListItem[];
  selected: CountryCode;
  onSelect: (c: CountryCode) => void;
  onClose: () => void;
}

export const CountryPicker = ({ visible, title, countries, selected, onSelect, onClose }: CountryPickerProps) => {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={styles.header}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{title}</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={t('countryPicker.close')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={28} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <FlatList
          data={countries}
          keyExtractor={(c) => c.code}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: theme.colors.border }]}
              onPress={() => { onSelect(item.code); onClose(); }}
              accessibilityRole="button"
              accessibilityState={{ selected: item.code === selected }}
              accessibilityLabel={`${item.name}, +${item.dialCode}`}
            >
              <Text variant="h3">{item.flag}</Text>
              <View style={{ flex: 1, marginHorizontal: 14 }}>
                <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{item.name}</Text>
                <Text variant="bodySmall" color={theme.colors.textSecondary}>{item.nativeName}</Text>
              </View>
              <Text variant="body" color={theme.colors.textSecondary}>+{item.dialCode}</Text>
              {item.code === selected && <Ionicons name="checkmark" size={22} color={theme.colors.primary} style={{ marginStart: 10 }} />}
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth },
});
