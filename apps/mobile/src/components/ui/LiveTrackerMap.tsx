import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../../hooks/useI18n';
import { t } from '../../i18n';

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface LiveTrackerMapProps {
  customerLocation?: Coordinates;
  workerLocation?: Coordinates;
  etaString?: string;
}

export default function LiveTrackerMap({ customerLocation, workerLocation, etaString }: LiveTrackerMapProps) {
  const { t } = useI18n();
  // Center map between both points or default to customer
  const initialRegion = {
    latitude: customerLocation?.latitude || workerLocation?.latitude || 37.78825,
    longitude: customerLocation?.longitude || workerLocation?.longitude || -122.4324,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={false}
      >
        {customerLocation && (
          <Marker coordinate={customerLocation} title={t('liveTrackerMap.yourLocation')}>
            <View style={styles.customerMarker}>
              <MaterialCommunityIcons name="home-map-marker" size={24} color="#FFF" />
            </View>
          </Marker>
        )}

        {workerLocation && (
          <Marker coordinate={workerLocation} title={t('liveTrackerMap.workerLocation')}>
            <View style={styles.workerMarker}>
              <MaterialCommunityIcons name="car" size={20} color="#FFF" />
            </View>
          </Marker>
        )}

        {customerLocation && workerLocation && (
          <Polyline
            coordinates={[workerLocation, customerLocation]}
            strokeColor="#00B4FF" // primary brand color
            strokeWidth={3}
            lineDashPattern={[5, 5]}
          />
        )}
      </MapView>
      
      {etaString && (
        <View style={styles.etaCard}>
          <Text style={styles.etaLabel}>{t('map.etaLabel')}</Text>
          <Text style={styles.etaText}>{etaString}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 300,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1E1E2D',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  customerMarker: {
    backgroundColor: '#10B981',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  workerMarker: {
    backgroundColor: '#00B4FF',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  etaCard: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(30, 30, 45, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  etaLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  etaText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
