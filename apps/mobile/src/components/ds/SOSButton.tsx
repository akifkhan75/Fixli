import React, { useRef, useState } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { View, Animated, StyleSheet, TouchableWithoutFeedback, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';

export interface SOSButtonProps {
  onSOSTriggered: () => void;
}

export const SOSButton = ({ onSOSTriggered }: SOSButtonProps) => {
  const theme = useTheme();
  const [isPressing, setIsPressing] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion(); // the 2 s hold is a safeguard and stays; only the growing ring is skipped

  const handlePressIn = () => {
    setIsPressing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 2000, // 2 seconds to trigger
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onSOSTriggered();
        progressAnim.setValue(0);
        setIsPressing(false);
      }
    });
  };

  const handlePressOut = () => {
    setIsPressing(false);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const ringWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, reduceMotion ? 0 : 10], // Ring expands as user holds
  });

  return (
    <TouchableWithoutFeedback
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={t('sOSButton.sosEmergencyButtonPress')}
    >
      <View style={[styles.container, { backgroundColor: theme.colors.sos }]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: 30,
              borderWidth: ringWidth,
              borderColor: 'rgba(255,255,255,0.4)',
            },
          ]}
        />
        <Ionicons name="warning" size={28} color="#FFF" />
        <Text variant="h3" weight="extrabold" style={{ color: '#FFF' }}>
          {isPressing ? t('sOSButton.hold') : t('sOSButton.sos')}
        </Text>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 40,
    shadowColor: '#E5392F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});
