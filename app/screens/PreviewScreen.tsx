import React, { useEffect, useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import {
  TelegramApi,
  TelegramStickerSet,
  TelegramSticker,
} from "../services/telegramApi";
import {
  StickerConverter,
  StickerMetadata,
} from "../services/stickerConverter";
import WhatsAppStickerModule from "../native/WhatsAppStickerModule";

const BOT_TOKEN = process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN;

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

type PreviewRouteProp = RouteProp<RootStackParamList, "Preview">;

type PreparedSticker = {
  key: string;
  sourceFileId: string;
  emoji: string;
  sourceKind: "static" | "animated" | "video";
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
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!cleaned) {
    return `pack_${Date.now()}`;
  }

  return cleaned.slice(0, 42);
};

const buildImageDataVersion = (chunk: PreparedSticker[]): string => {
  const source = `${Date.now()}_${chunk.map((sticker) => sticker.key).join("_")}`;
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `${Date.now()}_${hash.toString(16)}`;
};

export default function PreviewScreen() {
  const route = useRoute<PreviewRouteProp>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { packName } = route.params;

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [packData, setPackData] = useState<TelegramStickerSet | null>(null);
  const [stickerChunks, setStickerChunks] = useState<PreparedSticker[][]>([]);
  const [selectedChunkIndex, setSelectedChunkIndex] = useState(0);
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [addedChunkIndexes, setAddedChunkIndexes] = useState<number[]>([]);
  const [animatedFallbackCount, setAnimatedFallbackCount] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [packSessionToken, setPackSessionToken] = useState(() =>
    Date.now().toString(36).slice(-8),
  );
  const [animationNoticeShown, setAnimationNoticeShown] = useState(false);

  const [customPackName, setCustomPackName] = useState("");
  const [selectedStickerKeysByChunk, setSelectedStickerKeysByChunk] = useState<
    Record<number, string[]>
  >({});

  useEffect(() => {
    fetchPackData();
  }, []);

  useEffect(() => {
    const chunk = stickerChunks[selectedChunkIndex];
    if (!chunk || chunk.length === 0 || !BOT_TOKEN) {
      return;
    }

    const missing = chunk.filter((sticker) => !previewMap[sticker.key]);
    if (missing.length === 0) {
      return;
    }

    let cancelled = false;

    const loadPreviewUrls = async () => {
      setPreviewLoading(true);
      try {
        const api = new TelegramApi(BOT_TOKEN);
        const pairs = await Promise.all(
          missing.map(async (sticker) => {
            const url = await api.getStickerDownloadUrlByFileId(
              sticker.sourceFileId,
            );
            return [sticker.key, url] as const;
          }),
        );

        if (cancelled) {
          return;
        }

        setPreviewMap((prev) => {
          const next = { ...prev };
          pairs.forEach(([key, url]) => {
            next[key] = url;
          });
          return next;
        });
      } catch (e) {
        if (!cancelled) {
          console.warn("Failed to load preview stickers", e);
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
    [stickerChunks],
  );

  const selectedChunkKeySet = useMemo(() => {
    return new Set(selectedStickerKeysByChunk[selectedChunkIndex] || []);
  }, [selectedStickerKeysByChunk, selectedChunkIndex]);

  const selectedChunkStickers = useMemo(() => {
    const chunk = stickerChunks[selectedChunkIndex] || [];
    return chunk.filter((s) => selectedChunkKeySet.has(s.key));
  }, [stickerChunks, selectedChunkIndex, selectedChunkKeySet]);

  const toggleStickerSelection = (key: string) => {
    setSelectedStickerKeysByChunk((prev) => {
      const current = prev[selectedChunkIndex] || [];
      if (current.includes(key)) {
        return {
          ...prev,
          [selectedChunkIndex]: current.filter((k) => k !== key),
        };
      }
      return { ...prev, [selectedChunkIndex]: [...current, key] };
    });
  };

  const selectAllInChunk = () => {
    setSelectedStickerKeysByChunk((prev) => ({
      ...prev,
      [selectedChunkIndex]: (stickerChunks[selectedChunkIndex] || []).map(
        (s) => s.key,
      ),
    }));
  };

  const clearChunkSelection = () => {
    setSelectedStickerKeysByChunk((prev) => ({
      ...prev,
      [selectedChunkIndex]: [],
    }));
  };

  const restoreChunkDefaults = selectAllInChunk;

  const fetchPackData = async () => {
    try {
      if (!BOT_TOKEN) {
        throw new Error(
          "Missing Telegram bot token. Set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN.",
        );
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
            emoji: sticker.emoji || "🙂",
            sourceKind: "static",
          });
          return;
        }

        if (sticker.thumbnail?.file_id) {
          fallbackCount += 1;
          supported.push({
            key: sticker.file_unique_id,
            sourceFileId: sticker.thumbnail.file_id,
            emoji: sticker.emoji || "✨",
            sourceKind: sticker.is_video ? "video" : "animated",
          });
        }
      });

      if (supported.length < 3) {
        throw new Error(
          "Not enough supported stickers. WhatsApp needs at least 3 stickers per pack.",
        );
      }

      const chunks = toChunks(supported, WHATSAPP_PACK_SIZE);
      const initialSelection: Record<number, string[]> = {};
      chunks.forEach((chunk, idx) => {
        initialSelection[idx] = chunk.map((s) => s.key);
      });
      setSelectedStickerKeysByChunk(initialSelection);
      setStickerChunks(chunks);
      setCustomPackName(data.title);

      setSelectedChunkIndex(0);
      setAddedChunkIndexes([]);
      setPreviewMap({});
      setAnimatedFallbackCount(fallbackCount);
      setPackSessionToken(Date.now().toString(36).slice(-8));
      setAnimationNoticeShown(false);
      setPackData(data);
    } catch (e: any) {
      Alert.alert("Error", e.message);
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  };


  const retryNativeAddToWhatsApp = async () => {
    setIsProcessing(true);
    setHasError(false);

    try {
      if (!packData) throw new Error("Pack data missing.");
      const cacheBase = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      const destDir = `${cacheBase}wa_sticker_staging/`;

      const baseIdentifier = normalizeIdentifier(packData.name);
      const chunkSuffix = stickerChunks.length > 1 ? `_part${selectedChunkIndex + 1}` : "";
      const identifier = `${baseIdentifier}_${packSessionToken}${chunkSuffix}`.slice(0, 96);
      const packTitle = stickerChunks.length > 1
          ? `${customPackName || packData.title} (${selectedChunkIndex + 1}/${stickerChunks.length})`
          : customPackName || packData.title;

      if (!WhatsAppStickerModule) {
        throw new Error("Native Android module (WhatsAppStickerModule) is not properly linked.");
      }

      await WhatsAppStickerModule.sendStickerPack(destDir, identifier, packTitle);

      const alreadyAdded = addedChunkIndexes.includes(selectedChunkIndex);
      const nextAdded = alreadyAdded
        ? addedChunkIndexes
        : [...addedChunkIndexes, selectedChunkIndex];
      setAddedChunkIndexes(nextAdded);

      const nextNotAdded = stickerChunks.findIndex(
        (_, index) => !nextAdded.includes(index),
      );
      if (nextNotAdded >= 0) {
        setSelectedChunkIndex(nextNotAdded);
      }

      if (nextAdded.length === stickerChunks.length) {
        navigation.navigate("Success", {
          sentPackCount: stickerChunks.length,
          exportedStickerCount:
            selectedChunkStickers.length * stickerChunks.length, // approximation
          packDisplayName: customPackName || packData.title,
          coverUrl: previewMap[selectedChunkStickers[0]?.key] || "",
        });
      } else {
        Alert.alert(
          "Pack sent to WhatsApp",
          `Pack ${selectedChunkIndex + 1}/${stickerChunks.length} was sent. In WhatsApp, tap "Add" when prompted, then return here for the next pack.`,
        );
      }
    } catch (e: any) {
      console.error(e);
      setHasError(true);
      setErrorMessage(e.message || "Failed to prepare sticker pack.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddToWhatsApp = async () => {
    if (!selectedChunkStickers.length || !packData || isProcessing) {
      return;
    }

    setIsProcessing(true);
    setHasError(false);
    setProcessingProgress(0);

    try {
      if (!BOT_TOKEN) {
        throw new Error(
          "Missing Telegram bot token. Set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN.",
        );
      }

      if (animatedFallbackCount > 0 && !animationNoticeShown) {
        Alert.alert(
          "Animated Sticker Note",
          "Telegram animated/video stickers are currently exported as static images for WhatsApp. True animated conversion (TGS/WEBM to animated WebP) is not implemented yet.",
        );
        setAnimationNoticeShown(true);
      }

      const api = new TelegramApi(BOT_TOKEN!);
      const converter = new StickerConverter();

      const cacheBase =
        FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!cacheBase) {
        throw new Error("Could not resolve app storage directory.");
      }

      // Stage in cache so source and native target are always different directories.
      const destDir = `${cacheBase}wa_sticker_staging/`;
      const dirInfo = await FileSystem.getInfoAsync(destDir);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(destDir, { idempotent: true });
      }
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });

      const preparedStickers: StickerMetadata[] = [];
      let trayIconPath = "";

      for (let i = 0; i < selectedChunkStickers.length; i++) {
        setProcessingProgress(
          Math.round(((i + 1) / selectedChunkStickers.length) * 100),
        );

        const sticker = selectedChunkStickers[i];
        const downloadUrl = await api.getStickerDownloadUrlByFileId(
          sticker.sourceFileId,
        );

        const rawUri = await converter.downloadFile(
          downloadUrl,
          `${selectedChunkIndex + 1}_${sticker.key}`,
        );

        const result = await converter.convertToWhatsAppSticker(rawUri, i + 1);

        const finalDest = `${destDir}${result.fileName}`;
        await FileSystem.copyAsync({ from: result.uri, to: finalDest });
        const stickerInfo = await FileSystem.getInfoAsync(finalDest);
        const stickerSize =
          stickerInfo.exists &&
          "size" in stickerInfo &&
          typeof stickerInfo.size === "number"
            ? stickerInfo.size
            : 0;
        if (!stickerInfo.exists || stickerSize <= 0 || stickerSize > 100000) {
          throw new Error(
            `Sticker ${i + 1} is invalid for WhatsApp (${stickerSize} bytes).`,
          );
        }
        preparedStickers.push({
          fileName: result.fileName,
          emojis: [sticker.emoji || "🙂"],
        });

        if (i === 0) {
          const trayResult = await converter.createTrayIcon(rawUri);
          const trayDest = `${destDir}${trayResult.fileName}`;
          await FileSystem.copyAsync({ from: trayResult.uri, to: trayDest });
          const trayInfo = await FileSystem.getInfoAsync(trayDest);
          const traySize =
            trayInfo.exists &&
            "size" in trayInfo &&
            typeof trayInfo.size === "number"
              ? trayInfo.size
              : 0;
          if (!trayInfo.exists || traySize <= 0 || traySize > 50000) {
            throw new Error(
              `Tray icon is invalid for WhatsApp (${traySize} bytes).`,
            );
          }
          trayIconPath = trayResult.fileName;
        }
      }

      const baseIdentifier = normalizeIdentifier(packData.name);
      const chunkSuffix =
        stickerChunks.length > 1 ? `_part${selectedChunkIndex + 1}` : "";
      const identifier =
        `${baseIdentifier}_${packSessionToken}${chunkSuffix}`.slice(0, 96);
      const packTitle =
        stickerChunks.length > 1
          ? `${customPackName || packData.title} (${selectedChunkIndex + 1}/${stickerChunks.length})`
          : customPackName || packData.title;
      const imageDataVersion = buildImageDataVersion(selectedChunkStickers);

      const contentsJsonPath = await converter.generateContentsJson(
        identifier,
        packTitle,
        trayIconPath,
        preparedStickers,
        imageDataVersion,
      );

      await FileSystem.copyAsync({
        from: contentsJsonPath,
        to: `${destDir}contents.json`,
      });
      const stagedFiles = await FileSystem.readDirectoryAsync(destDir);
      console.log("Staged sticker asset files:", stagedFiles);

      console.log(
        "Finished processing assets locally. Handing off to native module for WhatsApp.",
      );

      if (!WhatsAppStickerModule) {
        throw new Error(
          "Native Android module (WhatsAppStickerModule) is not properly linked.",
        );
      }

      await WhatsAppStickerModule.sendStickerPack(
        destDir,
        identifier,
        packTitle,
      );

      const alreadyAdded = addedChunkIndexes.includes(selectedChunkIndex);
      const nextAdded = alreadyAdded
        ? addedChunkIndexes
        : [...addedChunkIndexes, selectedChunkIndex];
      setAddedChunkIndexes(nextAdded);

      const nextNotAdded = stickerChunks.findIndex(
        (_, index) => !nextAdded.includes(index),
      );
      if (nextNotAdded >= 0) {
        setSelectedChunkIndex(nextNotAdded);
      }

      if (nextAdded.length === stickerChunks.length) {
        navigation.navigate("Success", {
          sentPackCount: stickerChunks.length,
          exportedStickerCount:
            selectedChunkStickers.length * stickerChunks.length, // approximation
          packDisplayName: customPackName || packData.title,
          coverUrl: previewMap[selectedChunkStickers[0]?.key] || "",
        });
      } else {
        Alert.alert(
          "Pack sent to WhatsApp",
          `Pack ${selectedChunkIndex + 1}/${stickerChunks.length} was sent. In WhatsApp, tap "Add" when prompted, then return here for the next pack.`,
        );
      }
    } catch (e: any) {
      console.error(e);
      setHasError(true);
      setErrorMessage(e.message || "Failed to prepare sticker pack.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Fetching pack data...</Text>
        {/* Error Bottom Dialog Modal */}
        <Modal
          visible={hasError}
          transparent
          animationType="slide"
          onRequestClose={() => setHasError(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalIconContainer}>
                <Feather name="alert-triangle" size={32} color="#FB7185" />
              </View>
              <Text style={styles.modalTitle}>Something went wrong</Text>
              <Text style={styles.modalMessage}>{errorMessage}</Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { marginBottom: 12 }]}
                onPress={() => {
                  setHasError(false);
                  handleAddToWhatsApp();
                }}
              >
                <Feather
                  name="refresh-cw"
                  size={20}
                  color="#000"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setHasError(false)}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <View style={styles.backIcon}>
            <Feather
              name="arrow-left"
              size={24}
              color="#34D399"
              style={{ alignSelf: "center" }}
            />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>StickerBridge</Text>
        <View style={{ width: 40, height: 40 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View
          style={[
            styles.progressBarFilled,
            {
              width: `${Math.max(10, ((selectedChunkIndex + 1) / stickerChunks.length) * 100)}%`,
            },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Badge */}
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <Text style={styles.mainTitle}>{packData?.title}</Text>
            <Text style={styles.packHandle}>@{packData?.name}</Text>
          </View>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>ACTIVE PACK</Text>
          </View>
        </View>

        {/* Input */}
        <Text style={styles.inputLabel}>PACK NAME IN WHATSAPP</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={customPackName}
            onChangeText={setCustomPackName}
            placeholder="Custom Pack Name"
            placeholderTextColor="#718096"
          />
          <Text style={{ color: "#718096", fontSize: 16 }}>✎</Text>
        </View>

        {/* Chunks (Pack Tabs) */}
        {stickerChunks.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chunksScroll}
          >
            <View style={styles.chunksContainer}>
              {stickerChunks.map((_, index) => {
                const isActive = index === selectedChunkIndex;
                const isAdded = addedChunkIndexes.includes(index);
                const chunkKeys = selectedStickerKeysByChunk[index] || [];

                return (
                  <TouchableOpacity
                    key={index}
                    style={[styles.chunkTab, isActive && styles.chunkTabActive]}
                    onPress={() => setSelectedChunkIndex(index)}
                  >
                    <Text
                      style={[
                        styles.chunkTabText,
                        isActive && styles.chunkTabTextActive,
                      ]}
                    >
                      Pack {index + 1} ({chunkKeys.length})
                    </Text>
                    <View
                      style={[
                        styles.chunkBadge,
                        isAdded
                          ? styles.chunkBadgeAdded
                          : styles.chunkBadgePending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chunkBadgeText,
                          isAdded
                            ? styles.chunkBadgeTextAdded
                            : styles.chunkBadgeTextPending,
                        ]}
                      >
                        {isAdded ? "Added" : "Pending"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* Selection Actions Row */}
        <View style={styles.actionRow}>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <TouchableOpacity onPress={selectAllInChunk}>
              <Text style={styles.actionTextMint}>SELECT ALL</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearChunkSelection}>
              <Text style={styles.actionTextGrey}>CLEAR</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={restoreChunkDefaults}>
            <Text style={styles.actionTextGrey}>RESTORE DEFAULTS</Text>
          </TouchableOpacity>
        </View>

        {/* Sticker Grid */}
        <View style={styles.grid}>
          {selectedChunk.map((sticker) => {
            const isSelected = selectedChunkKeySet.has(sticker.key);
            const previewUrl = previewMap[sticker.key];
            const isAnimated = sticker.sourceKind !== "static";

            return (
              <TouchableOpacity
                key={sticker.key}
                style={[styles.gridItem, isSelected && styles.gridItemActive]}
                onPress={() => toggleStickerSelection(sticker.key)}
                activeOpacity={0.8}
              >
                {/* Top Left Indicator */}
                {isAnimated && (
                  <View style={styles.animatedIndicator}>
                    <Text style={styles.animatedIndicatorText}>
                      {sticker.sourceKind === "video" ? "V" : "A"}
                    </Text>
                  </View>
                )}

                {/* Top Right Checkbox */}
                <View
                  style={[styles.checkbox, isSelected && styles.checkboxActive]}
                >
                  {isSelected && (
                    <Text
                      style={{
                        color: "#000",
                        fontSize: 10,
                        fontWeight: "bold",
                      }}
                    >
                      ✓
                    </Text>
                  )}
                </View>

                {/* Image */}
                <View style={styles.imageContainer}>
                  {previewUrl ? (
                    <Image
                      source={{ uri: previewUrl }}
                      style={styles.stickerImage}
                      contentFit="contain"
                    />
                  ) : (
                    <ActivityIndicator color="#34D399" />
                  )}
                </View>

                {/* Bottom Right Emoji */}
                <View style={styles.emojiBadge}>
                  <Text style={styles.emojiText}>{sticker.emoji}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bottom Status */}
        <View style={styles.bottomStatus}>
          <Text style={styles.selectedCountText}>
            Selected: {selectedChunkStickers.length}/{selectedChunk.length}
          </Text>
          {selectedChunkStickers.length < 3 && (
            <View style={styles.warningRow}>
              <Text style={styles.warningIcon}>⚠</Text>
              <Text style={styles.warningText}>
                Minimum 3 stickers required
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom Button */}
      <View style={styles.bottomActionContainer}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (isProcessing || selectedChunkStickers.length < 3) &&
              styles.primaryBtnDisabled,
          ]}
          onPress={handleAddToWhatsApp}
          disabled={isProcessing || selectedChunkStickers.length < 3}
        >
          {isProcessing ? (
            <Text style={styles.primaryBtnText}>
              Processing {processingProgress}%...
            </Text>
          ) : (
            <>
              <View style={styles.plusCircle}>
                <Feather name="plus" size={16} color="#34D399" />
              </View>
              <Text style={styles.primaryBtnText}>
                Add to WhatsApp ({selectedChunkStickers.length} selected)
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      {/* Error Bottom Dialog Modal */}
      <Modal
        visible={hasError}
        transparent
        animationType="slide"
        onRequestClose={() => setHasError(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalIconContainer}>
              <Feather name="alert-triangle" size={32} color="#FB7185" />
            </View>
            <Text style={styles.modalTitle}>Something went wrong</Text>
            <Text style={styles.modalMessage}>{errorMessage}</Text>

            <TouchableOpacity
              style={[styles.primaryBtn, { marginBottom: 12 }]}
              onPress={() => {
                setHasError(false);
                retryNativeAddToWhatsApp();
              }}
            >
              <Feather
                name="refresh-cw"
                size={20}
                color="#000"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setHasError(false)}
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0D14" },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0B0D14",
    justifyContent: "center",
    alignItems: "center",
  },
  centerContainer: {
    flex: 1,
    backgroundColor: "#0B0D14",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { color: "#718096", marginTop: 16, fontSize: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#0B0D14",
  },
  backButton: { width: 40, height: 40, justifyContent: "center" },
  backIcon: {
    /* placeholder for native text matching arrow */
  },
  headerTitle: {
    color: "#34D399",
    fontSize: 20,
    fontWeight: "bold",
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  progressContainer: {
    height: 4,
    backgroundColor: "#1A1D2D",
    marginHorizontal: 20,
    borderRadius: 2,
    marginBottom: 10,
    overflow: "hidden",
  },
  progressBarFilled: {
    height: "100%",
    backgroundColor: "#34D399",
    borderRadius: 2,
  },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 10,
    marginBottom: 24,
  },
  titleLeft: { flex: 1 },
  mainTitle: {
    color: "#FFF",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 4,
  },
  packHandle: { color: "#34D399", fontSize: 15 },
  activeBadge: {
    backgroundColor: "rgba(52, 211, 153, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1A3329",
  },
  activeBadgeText: {
    color: "#34D399",
    fontSize: 11,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  inputLabel: {
    color: "#718096",
    fontSize: 11,
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#13151D",
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#1A1D2D",
  },
  input: { flex: 1, color: "#FFF", fontSize: 16, fontWeight: "500" },
  chunksScroll: { marginBottom: 24 },
  chunksContainer: {
    flexDirection: "row",
    backgroundColor: "#050505",
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: "#1A1D2D",
  },
  chunkTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  chunkTabActive: { backgroundColor: "#13151D" },
  chunkTabText: {
    color: "#718096",
    fontSize: 14,
    fontWeight: "bold",
    marginRight: 8,
  },
  chunkTabTextActive: { color: "#FFF" },
  chunkBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  chunkBadgeAdded: { backgroundColor: "rgba(52, 211, 153, 0.15)" },
  chunkBadgePending: { backgroundColor: "#1A1D2D" },
  chunkBadgeText: { fontSize: 10, fontWeight: "bold" },
  chunkBadgeTextAdded: { color: "#34D399" },
  chunkBadgeTextPending: { color: "#718096" },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  actionTextMint: {
    color: "#34D399",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  actionTextGrey: {
    color: "#718096",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  gridItem: {
    width: "31%",
    aspectRatio: 1,
    backgroundColor: "#13151D",
    borderRadius: 16,
    marginBottom: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#13151D",
  },
  gridItemActive: {
    borderColor: "#34D399",
    backgroundColor: "rgba(52,211,153,0.05)",
  },
  animatedIndicator: { position: "absolute", top: 8, left: 8, zIndex: 2 },
  animatedIndicatorText: { color: "#FFF", fontSize: 10, fontWeight: "bold" },
  checkbox: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4A5568",
    backgroundColor: "#1A1D2D",
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: { borderColor: "#34D399", backgroundColor: "#34D399" },
  imageContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  stickerImage: { width: "80%", height: "80%" },
  emojiBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#1A1D2D",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  emojiText: { fontSize: 10 },
  bottomStatus: { alignItems: "center", marginTop: 16, marginBottom: 16 },
  selectedCountText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 6,
  },
  warningRow: { flexDirection: "row", alignItems: "center" },
  warningIcon: { color: "#FC8181", fontSize: 12, marginRight: 6 },
  warningText: { color: "#FC8181", fontSize: 13, fontWeight: "bold" },
  bottomActionContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 10,
    backgroundColor: "#0B0D14",
  },
  primaryBtn: {
    backgroundColor: "#34D399",
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  plusCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  primaryBtnText: { color: "#000", fontSize: 16, fontWeight: "bold" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#13151D",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: "#1A1D2D",
    alignItems: "center",
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(251, 113, 133, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 15,
    color: "#A0AEC0",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  tryAgain:{},
  secondaryBtn: {
    width: "100%",
    backgroundColor: "#13151D",
    borderWidth: 1,
    borderColor: "#1A1D2D",
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: "#718096", fontSize: 16, fontWeight: "bold" },
});
