import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TelegramApi } from '../services/telegramApi';

// You can access public env variables in Expo directly
const BOT_TOKEN = process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN;

type RootStackParamList = {
  Home: undefined;
  Preview: { packName: string };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

type PackSummary = {
  packName: string;
  title: string;
  totalCount: number;
  supportedCount: number;
  animatedOrVideoCount: number;
  packChunks: number;
};

export default function HomeScreen() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [packSummary, setPackSummary] = useState<PackSummary | null>(null);
  const navigation = useNavigation<NavigationProp>();

  const extractPackName = (input: string) => {
    // try to match t.me/addstickers/PACK_NAME
    const regex = /(?:addstickers\/|stickers\/|^)([a-zA-Z0-9_]+)$/;
    const match = input.match(regex);
    return match ? match[1] : input.trim();
  };

  const handleFetchPack = async () => {
    if (!url) {
      Alert.alert('Error', 'Please enter a sticker pack URL or name.');
      return;
    }

    if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here') {
      Alert.alert('Configuration Error', 'Please set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN in your .env file.');
      return;
    }

    const packName = extractPackName(url);
    if (!packName) {
      Alert.alert('Error', 'Could not extract pack name from URL.');
      return;
    }

    setIsLoading(true);
    setPackSummary(null);
    
    try {
      const api = new TelegramApi(BOT_TOKEN);
      const setInfo = await api.getStickerSet(packName);
      
      const supportedStickers = setInfo.stickers.filter(sticker => {
        if (!sticker.is_animated && !sticker.is_video) {
          return true;
        }

        return Boolean(sticker.thumbnail?.file_id);
      });

      if (supportedStickers.length === 0) {
        Alert.alert('Error', 'This pack has no usable stickers for WhatsApp conversion.');
        return;
      }
      
      if (supportedStickers.length < 3) {
         Alert.alert('Error', 'WhatsApp requires at least 3 stickers per pack.');
         return;
      }

      const animatedOrVideoCount = setInfo.stickers.filter(
        sticker => sticker.is_animated || sticker.is_video
      ).length;

      setPackSummary({
        packName,
        title: setInfo.title,
        totalCount: setInfo.stickers.length,
        supportedCount: supportedStickers.length,
        animatedOrVideoCount,
        packChunks: Math.ceil(supportedStickers.length / 30),
      });
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to fetch the pack.');
    } finally {
      setIsLoading(false);
    }
  };

  const summaryRows = useMemo(() => {
    if (!packSummary) {
      return [];
    }

    return [
      { label: 'Total Telegram stickers', value: String(packSummary.totalCount) },
      { label: 'Usable for conversion', value: String(packSummary.supportedCount) },
      { label: 'Animated/video source', value: String(packSummary.animatedOrVideoCount) },
      { label: 'WhatsApp packs to create', value: String(packSummary.packChunks) },
    ];
  }, [packSummary]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.headerContainer}>
            <Text style={styles.kicker}>StickerBridge By Mandy</Text>
            <Text style={styles.logoText}>Telegram to WhatsApp</Text>
            <Text style={styles.subtitleText}>Paste one sticker URL and split it into WhatsApp-ready packs of 30.</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Telegram sticker URL or pack name</Text>
            <TextInput
              style={styles.input}
              placeholder="https://t.me/addstickers/Cats"
              placeholderTextColor="#777A9A"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
            
            <TouchableOpacity 
              style={[styles.button, isLoading && styles.buttonDisabled]} 
              onPress={handleFetchPack}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#08131F" />
              ) : (
                <Text style={styles.buttonText}>Analyze Pack</Text>
              )}
            </TouchableOpacity>
          </View>

          {packSummary ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{packSummary.title}</Text>
              <Text style={styles.summarySubtitle}>@{packSummary.packName}</Text>

              {summaryRows.map(row => (
                <View key={row.label} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{row.label}</Text>
                  <Text style={styles.summaryValue}>{row.value}</Text>
                </View>
              ))}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('Preview', { packName: packSummary.packName })}
              >
                <Text style={styles.secondaryButtonText}>Open Pack List</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08131F',
  },
  glowTop: {
    position: 'absolute',
    top: -80,
    right: -30,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(14, 165, 233, 0.2)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -110,
    left: -60,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(251, 146, 60, 0.14)',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 36,
  },
  headerContainer: {
    marginTop: 12,
    marginBottom: 26,
  },
  kicker: {
    color: '#7DD3FC',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  logoText: {
    fontSize: 38,
    lineHeight: 40,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 10,
    letterSpacing: -0.8,
  },
  subtitleText: {
    fontSize: 15,
    color: '#B8C1D5',
    marginTop: 10,
    maxWidth: 360,
    lineHeight: 22,
  },
  inputContainer: {
    backgroundColor: '#111F31',
    padding: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1F3652',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  label: {
    color: '#C8D7EE',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#091526',
    color: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#264260',
  },
  button: {
    backgroundColor: '#FB923C',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.75,
  },
  buttonText: {
    color: '#08131F',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  summaryCard: {
    marginTop: 16,
    backgroundColor: '#101C2D',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#223954',
    padding: 20,
  },
  summaryTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  summarySubtitle: {
    color: '#7DD3FC',
    marginTop: 4,
    marginBottom: 14,
    fontSize: 13,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1D2F46',
  },
  summaryLabel: {
    color: '#B7C5DA',
    fontSize: 14,
  },
  summaryValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 18,
    backgroundColor: '#0EA5E9',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
});
