import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { Button } from './Button';
import { ChipChoice } from './ChipChoice';
import * as api from '../../services/api';

const TAG_LABEL: Record<string, string> = {
  ON_TIME: 'On time', FRIENDLY: 'Friendly', CLEAN: 'Left it clean', FAIR_PRICE: 'Fair price', SKILLED: 'Skilled', EXPLAINED_WELL: 'Explained well',
  RESPECTFUL: 'Respectful', CLEAR_INSTRUCTIONS: 'Clear instructions', PAID_PROMPTLY: 'Paid promptly', EASY_ACCESS: 'Easy to find / access',
};

/**
 * Rate the other side of a completed job. The server decides who is reviewed (never sent from
 * here). A professional's review of a customer is private.
 */
export function ReviewForm({ jobId, targetName, reviewing, onSubmitted }: {
  jobId: string;
  targetName: string;
  /** Who is being reviewed: decides which tags make sense. */
  reviewing: 'worker' | 'customer';
  onSubmitted?: () => void;
}) {
  const theme = useTheme();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = (reviewing === 'worker' ? api.WORKER_REVIEW_TAGS : api.CUSTOMER_REVIEW_TAGS).map((id) => ({ id, label: TAG_LABEL[id] }));

  const handleSubmit = async () => {
    if (rating === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitReview({ jobRequestId: jobId, rating, comment: comment.trim() || undefined, tags: tags.length ? tags : undefined });
      onSubmitted?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.xl }]}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ textAlign: 'center' }}>
        How was it with {targetName}?
      </Text>
      {reviewing === 'customer' ? (
        <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ textAlign: 'center', marginTop: 4 }}>Only Fixli sees this.</Text>
      ) : null}
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity key={star} onPress={() => setRating(star)} style={styles.star} accessibilityRole="button" accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`} accessibilityState={{ selected: star <= rating }}>
            <Ionicons name={star <= rating ? 'star' : 'star-outline'} size={36} color={star <= rating ? theme.colors.warning : theme.colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
      {rating > 0 ? (
        <View style={{ marginTop: 16 }}>
          <ChipChoice options={options} selectedIds={tags} onChange={(v) => setTags(v.slice(0, 5))} multiSelect />
        </View>
      ) : null}
      <View style={{ marginTop: 16 }}>
        <TextInput label="Anything else? (optional)" value={comment} onChangeText={setComment} multiline maxLength={1000} />
      </View>
      {error ? <Text variant="caption" color={theme.colors.error} style={{ marginTop: 8 }} accessibilityRole="alert">{error}</Text> : null}
      <View style={{ marginTop: 16 }}>
        <Button title="Send review" variant="primary" disabled={rating === 0 || busy} loading={busy} onPress={handleSubmit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, marginTop: 24 },
  starsContainer: { flexDirection: 'row', justifyContent: 'center', marginTop: 16, gap: 8 },
  star: { padding: 4 },
});
