import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { Button } from './Button';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../services/api';

interface ReviewFormProps {
  jobId: string;
  targetId: string;
  targetName: string;
  onSubmitted?: () => void;
}

export function ReviewForm({ jobId, targetId, targetName, onSubmitted }: ReviewFormProps) {
  const theme = useTheme();
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitReview({ jobRequestId: jobId, targetId, rating, comment: comment.trim() || undefined });
      if (onSubmitted) onSubmitted();
    } catch (e: any) {
      setError(e.message || 'Failed to submit review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.xl }]}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ textAlign: 'center' }}>
        How was your experience with {targetName}?
      </Text>
      
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map(star => (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}`} accessibilityState={{ selected: star === rating }} key={star} onPress={() => setRating(star)} style={styles.star}>
            <Ionicons 
              name={star <= rating ? 'star' : 'star-outline'} 
              size={36} 
              color={star <= rating ? theme.colors.warning : theme.colors.textTertiary} 
            />
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ marginTop: 16 }}>
        <TextInput 
          label="Any comments? (Optional)" 
          value={comment} 
          onChangeText={setComment} 
          multiline
        />
      </View>

      {error && (
        <Text variant="caption" color={theme.colors.error} style={{ marginTop: 8 }}>{error}</Text>
      )}

      <View style={{ marginTop: 16 }}>
        <Button 
          title="Submit Review" 
          variant="primary" 
          disabled={rating === 0 || busy} 
          loading={busy} 
          onPress={handleSubmit} 
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    marginTop: 24,
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    gap: 8,
  },
  star: {
    padding: 4,
  }
});
