import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system/legacy';
import { TelegramApi, TelegramStickerSet, TelegramSticker } from '../services/telegramApi';
import { StickerConverter, StickerMetadata } from '../services/stickerConverter';
import WhatsAppStickerModule from '../native/WhatsAppStickerModule';

const BOT_TOKEN = process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN;

type RootStackParamList = {
  Home: undefined;
  Preview: { packName: string };
  Success: undefined;
};

type PreviewRouteProp = RouteProp<RootStackParamList, 'Preview'>;

type PreparedSticker = {
  key: string;
  sourceFileId: string;
  emoji: string;
  sourceKind: 'static' | 'animated' | 'video';
};

const WHATSAPP_PACK_SIZE = 30;

const toChunks = <T,>(input: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) {
    return [input];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    chunks.push(input.slice(i, i + chunkSize));
  }
  return chunks;
};

const normalizeIdentifier = (input: string): string => {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) {
    return `pack_${Date.now()}`;
  }

  return cleaned.slice(0, 42);
};

const buildImageDataVersion = (chunk: PreparedSticker[]): string => {
  const source = `${Date.now()}_${chunk.map(sticker => sticker.key).join('_')}`;
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `${Date.now()}_${hash.toString(16)}`;
};
  
export default function PreviewScreen() {
  const route = useRoute<PreviewRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { packName } = route.params;

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [packData, setPackData] = useState<TelegramStickerSet | null>(null);
  const [stickerChunks, setStickerChunks] = useState<PreparedSticker[][]>([]);
  const [selectedChunkIndex, setSelectedChunkIndex] = useState(0);
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [addedChunkIndexes, setAddedChunkIndexes] = useState<number[]>([]);
  const [animatedFallbackCount, setAnimatedFallbackCount] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [packSessionToken, setPackSessionToken] = useState(
    () => Date.now().toString(36).slice(-8)
  );
  const [animationNoticeShown, setAnimationNoticeShown] = useState(false);

  useEffect(() => {
    fetchPackData();
  }, []);

  useEffect(() => {
    const chunk = stickerChunks[selectedChunkIndex];
    if (!chunk || chunk.length === 0 || !BOT_TOKEN) {
      return;
    }

    const missing = chunk.filter(sticker => !previewMap[sticker.key]);
    if (missing.length === 0) {
      return;
    }

    let cancelled = false;

    const loadPreviewUrls = async () => {
      setPreviewLoading(true);
      try {
        const api = new TelegramApi(BOT_TOKEN);
        const pairs = await Promise.all(
          missing.map(async sticker => {
            const url = await api.getStickerDownloadUrlByFileId(sticker.sourceFileId);
            return [sticker.key, url] as const;
          })
        );

        if (cancelled) {
          return;
        }

        setPreviewMap(prev => {
          const next = { ...prev };
          pairs.forEach(([key, url]) => {
            next[key] = url;
          });
          return next;
        });
      } catch (e) {
        if (!cancelled) {
          console.warn('Failed to load preview stickers', e);
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    loadPreviewUrls();

    return () => {
      cancelled = true;
    };
  }, [previewMap, selectedChunkIndex, stickerChunks]);

  const selectedChunk = stickerChunks[selectedChunkIndex] ?? [];
  const totalSupported = useMemo(
    () => stickerChunks.reduce((sum, chunk) => sum + chunk.length, 0),
    [stickerChunks]
  );

  const fetchPackData = async () => {
    try {
      if (!BOT_TOKEN) {
        throw new Error('Missing Telegram bot token. Set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN.');
      }

      const api = new TelegramApi(BOT_TOKEN!);
      const data = await api.getStickerSet(packName);
      
      const supported: PreparedSticker[] = [];
      let fallbackCount = 0;

      data.stickers.forEach((sticker: TelegramSticker) => {
        if (!sticker.is_animated && !sticker.is_video) {
          supported.push({
            key: sticker.file_unique_id,
            sourceFileId: sticker.file_id,
            emoji: sticker.emoji || '🙂',
            sourceKind: 'static',
          });
          return;
        }

        if (sticker.thumbnail?.file_id) {
          fallbackCount += 1;
          supported.push({
            key: sticker.file_unique_id,
            sourceFileId: sticker.thumbnail.file_id,
            emoji: sticker.emoji || '✨',
            sourceKind: sticker.is_video ? 'video' : 'animated',
          });
        }
      });

      if (supported.length < 3) {
        throw new Error('Not enough supported stickers. WhatsApp needs at least 3 stickers per pack.');
      }

      setStickerChunks(toChunks(supported, WHATSAPP_PACK_SIZE));
      setSelectedChunkIndex(0);
      setAddedChunkIndexes([]);
      setPreviewMap({});
      setAnimatedFallbackCount(fallbackCount);
      setPackSessionToken(Date.now().toString(36).slice(-8));
      setAnimationNoticeShown(false);
      setPackData(data);
    } catch (e: any) {
      Alert.alert('Error', e.message);
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToWhatsApp = async () => {
    if (!selectedChunk.length || !packData || isProcessing) {
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);

    try {
      if (!BOT_TOKEN) {
        throw new Error('Missing Telegram bot token. Set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN.');
      }

      if (animatedFallbackCount > 0 && !animationNoticeShown) {
        Alert.alert(
          'Animated Sticker Note',
          'Telegram animated/video stickers are currently exported as static images for WhatsApp. True animated conversion (TGS/WEBM to animated WebP) is not implemented yet.'
        );
        setAnimationNoticeShown(true);
      }

      const api = new TelegramApi(BOT_TOKEN!);
      const converter = new StickerConverter();
      
      const cacheBase = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!cacheBase) {
        throw new Error('Could not resolve app storage directory.');
      }

      // Stage in cache so source and native target are always different directories.
      const destDir = `${cacheBase}wa_sticker_staging/`;
      const dirInfo = await FileSystem.getInfoAsync(destDir);
      if (dirInfo.exists) {
         await FileSystem.deleteAsync(destDir, { idempotent: true });
      }
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });

      const preparedStickers: StickerMetadata[] = [];
      let trayIconPath = '';

      for (let i = 0; i < selectedChunk.length; i++) {
        setProcessingProgress(Math.round(((i + 1) / selectedChunk.length) * 100));
        
        const sticker = selectedChunk[i];
        const downloadUrl = await api.getStickerDownloadUrlByFileId(sticker.sourceFileId);
        
        const rawUri = await converter.downloadFile(
          downloadUrl,
          `${selectedChunkIndex + 1}_${sticker.key}`
        );
        
        const result = await converter.convertToWhatsAppSticker(rawUri, i + 1);
        
        const finalDest = `${destDir}${result.fileName}`;
        await FileSystem.copyAsync({ from: result.uri, to: finalDest });
        const stickerInfo = await FileSystem.getInfoAsync(finalDest);
        const stickerSize =
          stickerInfo.exists && 'size' in stickerInfo && typeof stickerInfo.size === 'number'
            ? stickerInfo.size
            : 0;
        if (!stickerInfo.exists || stickerSize <= 0 || stickerSize > 100000) {
          throw new Error(`Sticker ${i + 1} is invalid for WhatsApp (${stickerSize} bytes).`);
        }
        preparedStickers.push({
          fileName: result.fileName,
          emojis: [sticker.emoji || '🙂'],
        });

        if (i === 0) {
          const trayResult = await converter.createTrayIcon(rawUri);
          const trayDest = `${destDir}${trayResult.fileName}`;
          await FileSystem.copyAsync({ from: trayResult.uri, to: trayDest });
          const trayInfo = await FileSystem.getInfoAsync(trayDest);
          const traySize =
            trayInfo.exists && 'size' in trayInfo && typeof trayInfo.size === 'number'
              ? trayInfo.size
              : 0;
          if (!trayInfo.exists || traySize <= 0 || traySize > 50000) {
            throw new Error(`Tray icon is invalid for WhatsApp (${traySize} bytes).`);
          }
          trayIconPath = trayResult.fileName;
        }
      }

      const baseIdentifier = normalizeIdentifier(packData.name);
      const chunkSuffix = stickerChunks.length > 1 ? `_part${selectedChunkIndex + 1}` : '';
      const identifier = `${baseIdentifier}_${packSessionToken}${chunkSuffix}`.slice(0, 96);
      const packTitle =
        stickerChunks.length > 1
          ? `${packData.title} (${selectedChunkIndex + 1}/${stickerChunks.length})`
          : packData.title;
      const imageDataVersion = buildImageDataVersion(selectedChunk);

      const contentsJsonPath = await converter.generateContentsJson(
        identifier,
        packTitle,
        trayIconPath,
        preparedStickers,
        imageDataVersion
      );
      
      await FileSystem.copyAsync({ from: contentsJsonPath, to: `${destDir}contents.json` });
      const stagedFiles = await FileSystem.readDirectoryAsync(destDir);
      console.log('Staged sticker asset files:', stagedFiles);

      console.log('Finished processing assets locally. Handing off to native module for WhatsApp.');
      
      if (!WhatsAppStickerModule) {
         throw new Error("Native Android module (WhatsAppStickerModule) is not properly linked.");
      }
      
      await WhatsAppStickerModule.sendStickerPack(destDir, identifier, packTitle);

      const alreadyAdded = addedChunkIndexes.includes(selectedChunkIndex);
      const nextAdded = alreadyAdded
        ? addedChunkIndexes
        : [...addedChunkIndexes, selectedChunkIndex];
      setAddedChunkIndexes(nextAdded);

      const nextNotAdded = stickerChunks.findIndex((_, index) => !nextAdded.includes(index));
      if (nextNotAdded >= 0) {
        setSelectedChunkIndex(nextNotAdded);
      }

      if (nextAdded.length === stickerChunks.length) {
        navigation.navigate('Success');
      } else {
        Alert.alert(
          'Pack sent to WhatsApp',
          `Pack ${selectedChunkIndex + 1}/${stickerChunks.length} was sent. In WhatsApp, tap "Add" when prompted, then return here for the next pack.`
        );
      }
      
    } catch (e: any) {
      console.error(e);
      Alert.alert('Processing Error', e.message || 'Failed to prepare sticker pack.');
    } finally {
      setIsProcessing(false);
    }
  };

  const renderStickerItem = ({ item }: { item: PreparedSticker }) => {
    const previewUrl = previewMap[item.key];

    return (
      <View style={styles.stickerBox}>
        {previewUrl ? (
          <Image source={previewUrl} style={styles.stickerImage} contentFit="contain" transition={160} />
        ) : (
          <View style={styles.stickerPlaceholder}>
            <Text style={styles.stickerPlaceholderText}>{item.emoji}</Text>
          </View>
        )}

        {item.sourceKind !== 'static' ? (
          <View style={styles.sourceTag}>
            <Text style={styles.sourceTagText}>{item.sourceKind === 'animated' ? 'A' : 'V'}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Fetching pack data...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.header}>
        <Text style={styles.title}>{packData?.title}</Text>
        <Text style={styles.subtitle}>
          {totalSupported} usable stickers • {stickerChunks.length} WhatsApp packs
        </Text>
        {animatedFallbackCount > 0 ? (
          <Text style={styles.noteText}>
            {animatedFallbackCount} animated/video Telegram stickers are exported as static thumbnails for WhatsApp.
          </Text>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chunkScrollContent}>
        {stickerChunks.map((chunk, index) => {
          const isSelected = index === selectedChunkIndex;
          const isAdded = addedChunkIndexes.includes(index);
          return (
            <TouchableOpacity
              key={`chunk-${index}`}
              style={[styles.chunkCard, isSelected && styles.chunkCardSelected]}
              onPress={() => setSelectedChunkIndex(index)}
              disabled={isProcessing}
            >
              <Text style={[styles.chunkTitle, isSelected && styles.chunkTitleSelected]}>
                Pack {index + 1}
              </Text>
              <Text style={[styles.chunkMeta, isSelected && styles.chunkMetaSelected]}>
                {chunk.length} stickers
              </Text>
              <Text style={[styles.chunkState, isAdded && styles.chunkStateAdded]}>
                {isAdded ? 'Added' : 'Pending'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {previewLoading ? (
        <View style={styles.previewLoadingRow}>
          <ActivityIndicator size="small" color="#7DD3FC" />
          <Text style={styles.previewLoadingText}>Loading sticker previews...</Text>
        </View>
      ) : null}

      <FlatList
        data={selectedChunk}
        keyExtractor={item => item.key}
        numColumns={3}
        contentContainerStyle={styles.gridContainer}
        renderItem={renderStickerItem}
      />

      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.button, isProcessing && styles.buttonDisabled]} 
          onPress={handleAddToWhatsApp}
          disabled={isProcessing || selectedChunk.length === 0}
        >
          {isProcessing ? (
            <Text style={styles.buttonText}>Processing: {processingProgress}%</Text>
          ) : (
            <Text style={styles.buttonText}>
              Add Pack {selectedChunkIndex + 1} of {stickerChunks.length} to WhatsApp
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08131F' },
  centerContainer: {
    flex: 1,
    backgroundColor: '#08131F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowTop: {
    position: 'absolute',
    top: -100,
    left: -20,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(14, 165, 233, 0.18)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -120,
    right: -50,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(251, 146, 60, 0.16)',
  },
  loadingText: { color: '#D8E4F2', marginTop: 16, fontSize: 16 },
  header: { padding: 20, paddingBottom: 10 },
  title: {
    fontSize: 29,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.4,
  },
  subtitle: { fontSize: 15, color: '#AFC2D8', marginTop: 6 },
  noteText: {
    fontSize: 13,
    color: '#7DD3FC',
    marginTop: 8,
    lineHeight: 19,
  },
  chunkScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  chunkCard: {
    width: 116,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#112036',
    borderWidth: 1,
    borderColor: '#20354E',
  },
  chunkCardSelected: {
    backgroundColor: '#0E7490',
    borderColor: '#67E8F9',
  },
  chunkTitle: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 14,
  },
  chunkTitleSelected: {
    color: '#ECFEFF',
  },
  chunkMeta: {
    marginTop: 5,
    color: '#90A9C5',
    fontSize: 12,
  },
  chunkMetaSelected: {
    color: '#CFFAFE',
  },
  chunkState: {
    marginTop: 8,
    color: '#FB923C',
    fontWeight: '700',
    fontSize: 12,
  },
  chunkStateAdded: {
    color: '#4ADE80',
  },
  previewLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  previewLoadingText: {
    marginLeft: 8,
    color: '#9FB6CF',
    fontSize: 13,
  },
  gridContainer: { paddingHorizontal: 12, paddingBottom: 12 },
  stickerBox: {
    flex: 1,
    margin: 7,
    aspectRatio: 1,
    backgroundColor: '#122136',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E3553',
  },
  stickerImage: {
    width: '86%',
    height: '86%',
  },
  stickerPlaceholder: {
    width: '82%',
    height: '82%',
    borderRadius: 12,
    backgroundColor: '#1A314B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickerPlaceholderText: {
    fontSize: 28,
  },
  sourceTag: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FB923C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceTagText: {
    fontSize: 10,
    color: '#08131F',
    fontWeight: '900',
  },
  footer: {
    padding: 20,
    backgroundColor: '#08131F',
    borderTopWidth: 1,
    borderColor: '#1A2E45',
  },
  button: {
    backgroundColor: '#25D366',
    paddingVertical: 16,
    borderRadius: 13,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#128C7E', opacity: 0.7 },
  buttonText: { color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
});
