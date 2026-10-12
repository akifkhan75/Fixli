import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../hooks/useI18n';

interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  beforeImageUrl?: string;
}

interface WorkerPortfolioProps {
  portfolio: PortfolioItem[];
}

export default function WorkerPortfolio({ portfolio }: WorkerPortfolioProps) {
  const [selectedItem, setSelectedItem] = useState<PortfolioItem | null>(null);
  const { t } = useI18n();

  if (!portfolio || portfolio.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="images-outline" size={32} color="#6B7280" />
        <Text style={styles.emptyText}>{t('portfolio.empty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{t('portfolio.title')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {portfolio.map((item) => (
          <TouchableOpacity
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => setSelectedItem(item)}
          >
            <Image source={{ uri: item.imageUrl }} style={styles.thumbnail} />
            <View style={styles.cardOverlay}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={!!selectedItem} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}>
        {selectedItem && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.close')} style={styles.closeButton} onPress={() => setSelectedItem(null)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </TouchableOpacity>
              
              {selectedItem.beforeImageUrl ? (
                <View style={styles.beforeAfterContainer}>
                  <View style={styles.imageWrapper}>
                    <Text style={styles.imageLabel}>{t('portfolio.before')}</Text>
                    <Image source={{ uri: selectedItem.beforeImageUrl }} style={styles.fullImage} />
                  </View>
                  <View style={styles.imageWrapper}>
                    <Text style={styles.imageLabel}>{t('portfolio.after')}</Text>
                    <Image source={{ uri: selectedItem.imageUrl }} style={styles.fullImage} />
                  </View>
                </View>
              ) : (
                <Image source={{ uri: selectedItem.imageUrl }} style={styles.singleFullImage} />
              )}
              
              <View style={styles.modalTextContainer}>
                <Text style={styles.modalTitle}>{selectedItem.title}</Text>
                <Text style={styles.modalDescription}>{selectedItem.description}</Text>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    width: 160,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#374151',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
  },
  cardTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    marginHorizontal: 16,
  },
  emptyText: {
    color: '#9CA3AF',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    backgroundColor: '#1E1E2D',
    borderRadius: 16,
    overflow: 'hidden',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 4,
  },
  beforeAfterContainer: {
    flexDirection: 'row',
    height: 300,
  },
  imageWrapper: {
    flex: 1,
    position: 'relative',
  },
  imageLabel: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#FFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontWeight: 'bold',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  singleFullImage: {
    width: '100%',
    height: 300,
  },
  modalTextContainer: {
    padding: 20,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalDescription: {
    color: '#D1D5DB',
    fontSize: 14,
    lineHeight: 20,
  },
});
