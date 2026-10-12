import React from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';

export interface ChipChoiceOption {
  id: string;
  label: string;
}

export interface ChipChoiceProps {
  options: ChipChoiceOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  multiSelect?: boolean;
}

export const ChipChoice = ({ options, selectedIds, onChange, multiSelect = false }: ChipChoiceProps) => {
  const theme = useTheme();

  const handlePress = (id: string) => {
    if (multiSelect) {
      if (selectedIds.includes(id)) {
        onChange(selectedIds.filter((item) => item !== id));
      } else {
        onChange([...selectedIds, id]);
      }
    } else {
      onChange([id]);
    }
  };

  return (
    <View style={styles.container}>
      {options.map((option) => {
        const isSelected = selectedIds.includes(option.id);
        return (
          <TouchableOpacity
            key={option.id}
            accessibilityRole={multiSelect ? 'checkbox' : 'radio'}
            accessibilityState={multiSelect ? { checked: isSelected } : { selected: isSelected }}
            activeOpacity={0.7}
            onPress={() => handlePress(option.id)}
            style={[
              styles.chip,
              {
                backgroundColor: isSelected ? theme.colors.primary : theme.colors.surfaceElevated,
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                borderWidth: 1,
                borderRadius: theme.borderRadius.lg,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
              },
            ]}
          >
            <Text
              variant="body"
              weight={isSelected ? 'semibold' : 'medium'}
              style={{ color: isSelected ? theme.colors.onPrimary : theme.colors.textPrimary }}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
