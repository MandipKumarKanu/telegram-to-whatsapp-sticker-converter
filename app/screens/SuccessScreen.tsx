import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

type RootStackParamList = {
  Home: undefined;
  Preview: { packName: string };
  Success: {
    sentPackCount?: number;
    exportedStickerCount?: number;
    packDisplayName?: string;
    coverUrl?: string;
  };
};

export default function SuccessScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Success'>>();
  
  const {
    sentPackCount = 2,
    exportedStickerCount = 120,
    packDisplayName = 'Cyber Pack v2.0',
    coverUrl = ''
  } = route.params ?? {};

  const handleBackToPackList = () => {
    navigation.navigate('Home');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackToPackList}>
          <Feather name="arrow-left" size={24} color="#34D399" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>StickerBridge</Text>
        <View style={{ width: 40, height: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconCircleGlow}>
          <View style={styles.iconCircle}>
            <Feather name="check" size={48} color="#000" style={{ fontWeight: 'bold' }} />
          </View>
        </View>
        
        <Text style={styles.title}>Packs Ready in{'\n'}WhatsApp</Text>
        <Text style={styles.subtitle}>
          Head over to WhatsApp to confirm and start{'\n'}using your new stickers.
        </Text>

        {/* Stats row */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <View style={styles.statIconContainerGreen}>
              <Feather name="package" size={24} color="#34D399" />
            </View>
            <Text style={styles.statValue}>{sentPackCount} Packs</Text>
            <Text style={styles.statLabel}>PACKS SENT</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconContainerPink}>
              <Ionicons name="sparkles" size={24} color="#FB7185" />
            </View>
            <Text style={styles.statValue}>{exportedStickerCount}</Text>
            <Text style={styles.statLabel}>STICKERS{'\n'}EXPORTED</Text>
          </View>
        </View>
        
        {/* Pack Info List Item */}
        <View style={styles.packListItem}>
          <View style={styles.packGridThumb}>
             {coverUrl ? (
                <Image source={{ uri: coverUrl }} style={styles.packThumbImage} contentFit="contain" />
             ) : (
                <View style={styles.packThumbPlaceholder}>
                  <Text style={{fontSize:24}}>😁</Text>
                </View>
             )}
          </View>
          <View style={styles.packListCenter}>
            <Text style={styles.packListTitle}>{packDisplayName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <View style={styles.readyBadge}>
                <Text style={styles.readyBadgeText}>READY</Text>
              </View>
              <Text style={styles.lastUpdatedText}>Last updated 2m ago</Text>
            </View>
          </View>
          <Feather name="more-vertical" size={20} color="#718096" />
        </View>

        <View style={{ flex: 1 }} />

        {/* Buttons */}
        <TouchableOpacity
          style={styles.primaryBtn} 
          onPress={() => navigation.navigate('Home')}
        >
          <Feather name="plus-square" size={20} color="#000" style={{ marginRight: 8 }} />
          <Text style={styles.primaryBtnText}>Convert Another Pack</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={handleBackToPackList}>
          <Feather name="list" size={20} color="#FB7185" style={{ marginRight: 8 }} />
          <Text style={styles.secondaryBtnText}>Back to Pack List</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D14' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { color: '#34D399', fontSize: 20, fontWeight: 'bold', letterSpacing: -0.5 },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  iconCircleGlow: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(52, 211, 153, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.1)',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#34D399',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#A0AEC0',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  statsContainer: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#13151D',
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1A1D2D',
  },
  statIconContainerGreen: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  statIconContainerPink: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(251, 113, 133, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#718096',
    letterSpacing: 1,
    textAlign: 'center',
  },
  packListItem: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#13151D',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1A1D2D',
  },
  packGridThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#0B0D14',
    marginRight: 16,
    overflow: 'hidden',
  },
  packThumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  packThumbImage: {
    width: '100%',
    height: '100%',
  },
  packListCenter: {
    flex: 1,
    justifyContent: 'center',
  },
  packListTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  readyBadge: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 8,
  },
  readyBadgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: 'bold',
  },
  lastUpdatedText: {
    color: '#718096',
    fontSize: 12,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#34D399',
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    marginTop: 12,
  },
  primaryBtnText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  secondaryBtn: {
    width: '100%',
    backgroundColor: '#13151D',
    borderWidth: 1,
    borderColor: '#FB7185',
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // marginTop: 16,
  },
  secondaryBtnText: { color: '#FB7185', fontSize: 16, fontWeight: 'bold' },
});
