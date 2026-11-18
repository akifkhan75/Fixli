import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';
import { useI18n } from '../../hooks/useI18n';

interface DocumentVerificationProps {
  onUploadSuccess?: () => void;
}

export default function DocumentVerification({ onUploadSuccess }: DocumentVerificationProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const { t } = useI18n();

  const handleUpload = () => {
    setIsUploading(true);
    // Simulate OCR upload delay
    setTimeout(() => {
      setIsUploading(false);
      setIsVerified(true);
      if (onUploadSuccess) onUploadSuccess();
    }, 2500);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('verify.title')}</Text>
      <Text style={styles.description}>
        Upload your government ID or professional license. Our AI verification system will process it instantly.
      </Text>

      {isVerified ? (
        <View style={styles.successBox}>
          <Ionicons name="checkmark-circle" size={32} color="#10B981" />
          <Text style={styles.successText}>{t('verify.success')}</Text>
        </View>
      ) : (
        <TouchableOpacity accessibilityRole="button" 
          style={styles.uploadArea} 
          activeOpacity={0.7} 
          onPress={handleUpload}
          disabled={isUploading}
        >
          {isUploading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={colors.dark.primary} />
              <Text style={styles.loadingText}>{t('verify.ocr')}</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="cloud-upload-outline" size={48} color={colors.dark.primary} />
              <Text style={styles.uploadText}>{t('verify.upload')}</Text>
              <Text style={styles.uploadSubtext}>{t('verify.uploadSub')}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E1E2D',
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginVertical: spacing.md,
  },
  title: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  description: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  uploadArea: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  emptyState: {
    alignItems: 'center',
  },
  uploadText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  uploadSubtext: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: spacing.xs,
  },
  loadingState: {
    alignItems: 'center',
  },
  loadingText: {
    color: colors.dark.primary,
    marginTop: spacing.md,
    fontWeight: '600',
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10B981',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  successText: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
