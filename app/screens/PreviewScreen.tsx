import React, { useEffect, useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useKeepAwake } from 'expo-keep-awake';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  Platform,
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
  ANIMATED_STICKER_MAX_BYTES,
  StickerConverter,
  STICKER_MAX_BYTES,
  StickerQualityPreset,
  StickerMetadata,
} from "../services/stickerConverter";
import { shouldUseAnimatedPack, StickerSourceKind } from "../services/stickerExportMode";
import WhatsAppStickerModule from "../native/WhatsAppStickerModule";
import {
  getStoredPack,
  upsertStoredPack,
} from "../services/packLibrary";
import { useTelegramPreviewUrls } from "./hooks/useTelegramPreviewUrls";
import { useChunkQueue } from "./hooks/useChunkQueue";

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
  previewFileId: string;
  emoji: string;
  sourceKind: StickerSourceKind;
};

type ExportMode = "safe-static" | "experimental-animated";

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
  const source = `${chunk.map((sticker) => sticker.key).join("_")}`;
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `v_${Math.abs(hash).toString(16)}`;
};

export default function PreviewScreen() {
  useKeepAwake(); // Prevent screen sleep during downloading
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
  const [addedChunkIndexes, setAddedChunkIndexes] = useState<number[]>([]);
  const [animatedFallbackCount, setAnimatedFallbackCount] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [animationNoticeShown, setAnimationNoticeShown] = useState(false);
  const [qualityPreset, setQualityPreset] = useState<StickerQualityPreset>("best");
  const [exportMode, setExportMode] = useState<ExportMode>("safe-static");
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);

  const [customPackName, setCustomPackName] = useState("");
  const [selectedStickerKeysByChunk, setSelectedStickerKeysByChunk] = useState<
    Record<number, string[]>
  >({});
  
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewStickerUrl, setPreviewStickerUrl] = useState<string | null>(null);
  const [previewStickerEmoji, setPreviewStickerEmoji] = useState<string | null>(null);

  const {
    isRunning: isQueueRunning,
    progress: queueProgress,
    failedChunkIndexes,
    runQueue,
    cancelQueue,
    resetQueue,
  } = useChunkQueue();

  const selectedChunk = stickerChunks[selectedChunkIndex] ?? [];
  const { previewMap, setPreviewMap, previewLoading } = useTelegramPreviewUrls({
    botToken: BOT_TOKEN,
    selectedChunk,
  });

  useEffect(() => {
    void fetchPackData();
    // Route-level fetch: intentionally runs once for this screen instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  const persistChunkProgress = async (override?: {
    exportedChunkIndexes?: number[];
    selectedChunkIndex?: number;
    selectedCount?: number;
  }) => {
    if (!packData) return;

    try {
      const progressCoverKey = selectedChunkStickers[0]?.key;
      await upsertStoredPack({
        packName: packData.name,
        title: packData.title,
        customPackName,
        totalCount: packData.stickers.length,
        supportedCount: totalSupported,
        packChunks: stickerChunks.length,
        lastSelectedCount: override?.selectedCount ?? selectedChunkStickers.length,
        lastSelectedChunkIndex: override?.selectedChunkIndex ?? selectedChunkIndex,
        exportedChunkIndexes: override?.exportedChunkIndexes ?? addedChunkIndexes,
        coverUrl: progressCoverKey ? previewMap[progressCoverKey] || "" : "",
      });
    } catch (error) {
      console.warn("Failed to persist chunk progress", error);
    }
  };

  useEffect(() => {
    if (!packData || isLoading) return;
    void persistChunkProgress();
    // Persist on progress-related state changes; helper identity is intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addedChunkIndexes,
    customPackName,
    isLoading,
    packData,
    previewMap,
    selectedChunkIndex,
    selectedChunkStickers.length,
    stickerChunks.length,
    totalSupported,
  ]);

  const fetchPackData = async () => {
    try {
      if (!BOT_TOKEN) {
        throw new Error(
          "Missing Telegram bot token. Set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN.",
        );
      }

      const api = new TelegramApi(BOT_TOKEN!);
      const data = await api.getStickerSet(packName);
      const existingRecord = await getStoredPack(packName);

      const supported: PreparedSticker[] = [];
      let fallbackCount = 0;

      data.stickers.forEach((sticker: TelegramSticker) => {
        if (!sticker.is_animated && !sticker.is_video) {
          supported.push({
            key: sticker.file_unique_id,
            sourceFileId: sticker.file_id,
            previewFileId: sticker.file_id,
            emoji: sticker.emoji || "🙂",
            sourceKind: "static",
          });
          return;
        }

        if (sticker.is_video) {
          fallbackCount += 1;
          supported.push({
            key: sticker.file_unique_id,
            sourceFileId: sticker.file_id,
            previewFileId: sticker.thumbnail?.file_id || sticker.file_id,
            emoji: sticker.emoji || "🎬",
            sourceKind: "video",
          });
          return;
        }

        fallbackCount += 1;
        supported.push({
          key: sticker.file_unique_id,
          sourceFileId: sticker.file_id,
          previewFileId: sticker.thumbnail?.file_id || sticker.file_id,
          emoji: sticker.emoji || "✨",
          sourceKind: "animated",
        });
      });

      if (supported.length < 3) {
        throw new Error(
          "Not enough supported stickers. WhatsApp needs at least 3 stickers per pack.",
        );
      }

      const chunks = toChunks(supported, WHATSAPP_PACK_SIZE);
      const initialSelection: Record<number, string[]> = {};
      chunks.forEach((chunk, idx) => {
        const defaultKeys = chunk.map((s) => s.key);
        const isLastSelectedChunk = existingRecord?.lastSelectedChunkIndex === idx;
        const lastSelectedCount = existingRecord?.lastSelectedCount ?? defaultKeys.length;
        if (isLastSelectedChunk && lastSelectedCount > 0 && lastSelectedCount < defaultKeys.length) {
          initialSelection[idx] = defaultKeys.slice(0, lastSelectedCount);
        } else {
          initialSelection[idx] = defaultKeys;
        }
      });

      const restoredAdded = (existingRecord?.exportedChunkIndexes || []).filter(
        (index) => index >= 0 && index < chunks.length,
      );
      const firstNotAdded = chunks.findIndex((_, index) => !restoredAdded.includes(index));
      const fallbackChunkIndex = firstNotAdded >= 0 ? firstNotAdded : 0;
      const restoredChunkIndex =
        typeof existingRecord?.lastSelectedChunkIndex === "number" &&
        existingRecord.lastSelectedChunkIndex >= 0 &&
        existingRecord.lastSelectedChunkIndex < chunks.length
          ? existingRecord.lastSelectedChunkIndex
          : fallbackChunkIndex;

      setSelectedStickerKeysByChunk(initialSelection);
      setStickerChunks(chunks);
      setCustomPackName(existingRecord?.customPackName || data.title);

      setSelectedChunkIndex(restoredChunkIndex);
      setAddedChunkIndexes(restoredAdded);
      setPreviewMap({});
      setAnimatedFallbackCount(fallbackCount);
      setAnimationNoticeShown(false);
      setPackData(data);
    } catch (e: any) {
      Alert.alert("Error", e.message);
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  };

  const confirmReconvert = () =>
    new Promise<boolean>((resolve) => {
      Alert.alert(
        "Already exported",
        "This chunk was already exported previously. Re-convert and send again?",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Re-convert", onPress: () => resolve(true) },
        ],
      );
    });

  const processChunk = async (
    chunkIndex: number,
    options?: { skipDuplicatePrompt?: boolean; silentChunkAlert?: boolean },
  ) => {
    if (isProcessing) {
      return;
    }

    if (!packData) {
      throw new Error("Pack data missing.");
    }

    const chunk = stickerChunks[chunkIndex] || [];
    const selectedKeys = new Set(selectedStickerKeysByChunk[chunkIndex] || []);
    const selectedStickers = chunk.filter((sticker) => selectedKeys.has(sticker.key));

    if (selectedStickers.length < 3) {
      throw new Error("Select at least 3 stickers before exporting this chunk.");
    }

    const alreadyExported = addedChunkIndexes.includes(chunkIndex);
    if (alreadyExported && !options?.skipDuplicatePrompt) {
      const confirmed = await confirmReconvert();
      if (!confirmed) {
        return;
      }
    }

    setSelectedChunkIndex(chunkIndex);
    setIsProcessing(true);
    setHasError(false);
    setProcessingProgress(0);

    try {
      if (!BOT_TOKEN) {
        throw new Error(
          "Missing Telegram bot token. Set EXPO_PUBLIC_TELEGRAM_BOT_TOKEN.",
        );
      }

      const sourceKinds = selectedStickers.map((sticker) => sticker.sourceKind);
      const hasNonStaticSelection = sourceKinds.some((kind) => kind !== "static");
      const hasVideoSelection = sourceKinds.some((kind) => kind === "video");
      const canUseAnimatedPack = shouldUseAnimatedPack(sourceKinds);
      const animatedModeRequested = exportMode === "experimental-animated";
      const isAnimatedPack =
        animatedModeRequested && canUseAnimatedPack;

      if (hasNonStaticSelection && !animationNoticeShown) {
        if (isAnimatedPack) {
          Alert.alert(
            "Experimental Animated Mode",
            "Animated export is enabled. WhatsApp may reject some packs depending on source content and client version.",
          );
        } else if (animatedModeRequested && hasVideoSelection) {
          Alert.alert(
            "Video Fallback",
            "Video stickers are exported as static WebP for compatibility. Animated mode remains available for .tgs animated packs.",
          );
        } else if (animatedModeRequested && !canUseAnimatedPack) {
          Alert.alert(
            "Fallback to Static",
            "Mixed static+animated/video selections are exported as static for WhatsApp compatibility.",
          );
        } else {
          Alert.alert(
            "Safe Static Mode",
            "Video and animated stickers are converted to static WebP for maximum WhatsApp compatibility.",
          );
        }
        setAnimationNoticeShown(true);
      }

      const api = new TelegramApi(BOT_TOKEN);
      const converter = new StickerConverter();
      const cacheBase = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!cacheBase) {
        throw new Error("Could not resolve app storage directory.");
      }

      const destDir = `${cacheBase}wa_sticker_staging/`;
      const dirInfo = await FileSystem.getInfoAsync(destDir);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(destDir, { idempotent: true });
      }
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });

      const preparedStickers: StickerMetadata[] = [];
      let trayIconPath = "";
      const maxStickerBytes = isAnimatedPack
        ? ANIMATED_STICKER_MAX_BYTES
        : STICKER_MAX_BYTES;

      for (let i = 0; i < selectedStickers.length; i += 1) {
        setProcessingProgress(Math.round(((i + 1) / selectedStickers.length) * 100));

        const sticker = selectedStickers[i];
        if (!sticker) {
          continue;
        }
        const downloadUrl = await api.getStickerDownloadUrlByFileId(sticker.sourceFileId);
        const rawExtension =
          sticker.sourceKind === "video"
            ? "webm"
            : sticker.sourceKind === "animated"
              ? "tgs"
              : "webp";
        const rawUri = await converter.downloadFile(
          downloadUrl,
          `${chunkIndex + 1}_${sticker.key}`,
          rawExtension,
        );
        const result = isAnimatedPack
          ? sticker.sourceKind === "video"
            ? await converter.convertVideoToAnimatedSticker(rawUri, i + 1, qualityPreset)
            : sticker.sourceKind === "animated"
              ? await converter.convertTgsToAnimatedSticker(rawUri, i + 1, qualityPreset)
              : await converter.convertToWhatsAppSticker(rawUri, i + 1, qualityPreset)
          : sticker.sourceKind === "video"
            ? await converter.convertVideoToStillSticker(
                rawUri,
                i + 1,
                qualityPreset,
              )
            : sticker.sourceKind === "animated"
              ? await converter.convertTgsToStillSticker(
                  rawUri,
                  i + 1,
                  qualityPreset,
                )
              : await converter.convertToWhatsAppSticker(
                  rawUri,
                  i + 1,
                  qualityPreset,
                );

        const finalDest = `${destDir}${result.fileName}`;
        await FileSystem.copyAsync({ from: result.uri, to: finalDest });
        const stickerInfo = await FileSystem.getInfoAsync(finalDest);
        const stickerSize =
          stickerInfo.exists &&
          "size" in stickerInfo &&
          typeof stickerInfo.size === "number"
            ? stickerInfo.size
            : 0;

        if (!stickerInfo.exists || stickerSize <= 0 || stickerSize > maxStickerBytes) {
          throw new Error(
            `Sticker ${i + 1} is invalid for WhatsApp (${stickerSize} bytes, max ${maxStickerBytes}).`,
          );
        }

        preparedStickers.push({
          fileName: result.fileName,
          emojis: [sticker.emoji || "🙂"],
        });

        if (i === 0) {
          let traySourceUri = result.uri;
          if (isAnimatedPack) {
            if (sticker.sourceKind === "video") {
              const tempStill = await converter.convertVideoToStillSticker(
                rawUri,
                9999,
                qualityPreset,
              );
              traySourceUri = tempStill.uri;
            } else if (sticker.sourceKind === "animated") {
              const tempStill = await converter.convertTgsToStillSticker(
                rawUri,
                9999,
                qualityPreset,
              );
              traySourceUri = tempStill.uri;
            }
          }

          const trayResult = await converter.createTrayIcon(traySourceUri);
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
            throw new Error(`Tray icon is invalid for WhatsApp (${traySize} bytes).`);
          }
          trayIconPath = trayResult.fileName;
        }
      }

      const baseIdentifier = normalizeIdentifier(packData.name);
      const chunkSuffix = stickerChunks.length > 1 ? `_part${chunkIndex + 1}` : "";
      const identifier = `${baseIdentifier}${chunkSuffix}`.slice(0, 96);
      const packTitle =
        stickerChunks.length > 1
          ? `${customPackName || packData.title} (${chunkIndex + 1}/${stickerChunks.length})`
          : customPackName || packData.title;
      const imageDataVersion = buildImageDataVersion(selectedStickers);

      const contentsJsonPath = await converter.generateContentsJson(
        identifier,
        packTitle,
        trayIconPath,
        preparedStickers,
        imageDataVersion,
        isAnimatedPack,
      );

      await FileSystem.copyAsync({
        from: contentsJsonPath,
        to: `${destDir}contents.json`,
      });

      await converter.clearRawCache();
      await WhatsAppStickerModule.sendStickerPack(destDir, identifier, packTitle);

      const nextAdded = alreadyExported
        ? addedChunkIndexes
        : [...addedChunkIndexes, chunkIndex];
      setAddedChunkIndexes(nextAdded);

      const nextNotAdded = stickerChunks.findIndex((_, index) => !nextAdded.includes(index));
      if (nextNotAdded >= 0) {
        setSelectedChunkIndex(nextNotAdded);
      }

      await persistChunkProgress({
        exportedChunkIndexes: nextAdded,
        selectedChunkIndex: nextNotAdded >= 0 ? nextNotAdded : chunkIndex,
        selectedCount: selectedStickers.length,
      });

      if (nextAdded.length === stickerChunks.length) {
        const exportedStickerCount = nextAdded.reduce((sum, index) => {
          return sum + ((selectedStickerKeysByChunk[index] || []).length || 0);
        }, 0);
        const successCoverKey = selectedStickers[0]?.key;

        navigation.navigate("Success", {
          sentPackCount: stickerChunks.length,
          exportedStickerCount,
          packDisplayName: customPackName || packData.title,
          coverUrl: successCoverKey ? previewMap[successCoverKey] || "" : "",
        });
      } else if (!options?.silentChunkAlert) {
        Alert.alert(
          "Pack sent to WhatsApp",
          `Pack ${chunkIndex + 1}/${stickerChunks.length} was sent. In WhatsApp, tap "Add" when prompted, then return here for the next pack.`,
        );
      }
    } catch (e: any) {
      console.error(e);
      const rawMessage = e?.message || "Failed to prepare sticker pack.";
      const mappedMessage = rawMessage.includes("handleStickerPackPreviewResult/failed")
        ? "WhatsApp rejected this pack during validation. For video stickers, use SAFE STATIC mode. For .tgs animated stickers, retry ANIMATED EXPERIMENTAL with BEST quality and fewer stickers selected."
        : rawMessage;
      setHasError(true);
      setErrorMessage(mappedMessage);
      throw e;
    } finally {
      setIsProcessing(false);
    }
  };

  const retryNativeAddToWhatsApp = async () => {
    try {
      await processChunk(selectedChunkIndex, { skipDuplicatePrompt: true });
    } catch {
      // Error modal state is already set inside processChunk.
    }
  };

  const handleAddToWhatsApp = async () => {
    try {
      await processChunk(selectedChunkIndex);
    } catch {
      // Error modal state is already set inside processChunk.
    }
  };

  const queueChunks = async (chunkIndexes?: number[]) => {
    const queueTargets =
      chunkIndexes || stickerChunks.map((_, index) => index).filter((index) => !addedChunkIndexes.includes(index));

    if (!queueTargets.length) {
      Alert.alert("Queue", "No remaining chunks to queue.");
      return;
    }

    const result = await runQueue(queueTargets, async (chunkIndex) => {
      await processChunk(chunkIndex, {
        skipDuplicatePrompt: true,
        silentChunkAlert: true,
      });
    });

    if (result.cancelled) {
      Alert.alert("Queue stopped", "Background conversion queue was cancelled.");
      return;
    }

    if (result.failedChunkIndexes.length) {
      Alert.alert(
        "Queue completed with failures",
        `Failed chunks: ${result.failedChunkIndexes.map((idx) => idx + 1).join(", ")}. Use Retry Failed Chunks to re-run them.`,
      );
      return;
    }

    Alert.alert("Queue completed", "All queued chunks were processed.");
    resetQueue();
  };

  const retryFailedChunks = async () => {
    if (!failedChunkIndexes.length) {
      Alert.alert("Retry", "There are no failed chunks to retry.");
      return;
    }
    await queueChunks(failedChunkIndexes);
  };

  const runDiagnostics = async () => {
    setDiagnosticsMessage("");
    setIsRunningDiagnostics(true);

    try {
      const result = await WhatsAppStickerModule.runBasicDiagnostics();
      const targets = result.supportedTargets?.length
        ? result.supportedTargets.join(", ")
        : "none";
      setDiagnosticsMessage(
        `Authority: ${result.providerAuthority || "n/a"}\n` +
          `Foreground activity: ${result.hasForegroundActivity ? "yes" : "no"}\n` +
          `WhatsApp installed: ${result.whatsappInstalled ? "yes" : "no"}\n` +
          `Detected targets: ${targets}`,
      );
    } catch (error: any) {
      setDiagnosticsMessage(error?.message || "Diagnostics failed.");
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  if (Platform.OS !== "android") {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <Feather name="alert-triangle" size={32} color="#FBBF24" />
        <Text style={[styles.loadingText, { marginTop: 12 }]}>Android only</Text>
        <Text style={[styles.loadingText, { textAlign: "center", marginTop: 8 }]}>This screen requires Android native sticker APIs.</Text>
        <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 20, width: "90%" }]} onPress={() => navigation.navigate("Home")}>
          <Text style={styles.secondaryBtnText}>Back to Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

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

        <View style={styles.qualityRow}>
          <Text style={styles.qualityLabel}>QUALITY</Text>
          {(["fast", "small", "best"] as StickerQualityPreset[]).map((preset) => (
            <TouchableOpacity
              key={preset}
              style={[
                styles.qualityChip,
                qualityPreset === preset && styles.qualityChipActive,
              ]}
              onPress={() => setQualityPreset(preset)}
            >
              <Text
                style={[
                  styles.qualityChipText,
                  qualityPreset === preset && styles.qualityChipTextActive,
                ]}
              >
                {preset.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.modeRow}>
          <Text style={styles.modeLabel}>EXPORT MODE</Text>
          <TouchableOpacity
            style={[
              styles.modeChip,
              exportMode === "safe-static" && styles.modeChipActive,
            ]}
            onPress={() => {
              setExportMode("safe-static");
              setAnimationNoticeShown(false);
            }}
            disabled={isProcessing || isQueueRunning}
          >
            <Text
              style={[
                styles.modeChipText,
                exportMode === "safe-static" && styles.modeChipTextActive,
              ]}
            >
              SAFE STATIC
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeChip,
              exportMode === "experimental-animated" && styles.modeChipActive,
            ]}
            onPress={() => {
              setExportMode("experimental-animated");
              setAnimationNoticeShown(false);
            }}
            disabled={isProcessing || isQueueRunning}
          >
            <Text
              style={[
                styles.modeChipText,
                exportMode === "experimental-animated" && styles.modeChipTextActive,
              ]}
            >
              ANIMATED EXPERIMENTAL
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.queueRow}>
          <TouchableOpacity
            style={styles.queueButton}
            onPress={() => queueChunks()}
            disabled={isQueueRunning || isProcessing}
          >
            <Text style={styles.queueButtonText}>QUEUE REMAINING</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.queueButton}
            onPress={retryFailedChunks}
            disabled={isQueueRunning || isProcessing || !failedChunkIndexes.length}
          >
            <Text style={styles.queueButtonText}>RETRY FAILED</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.queueButton}
            onPress={cancelQueue}
            disabled={!isQueueRunning}
          >
            <Text style={styles.queueButtonText}>CANCEL</Text>
          </TouchableOpacity>
        </View>

        {(isQueueRunning || failedChunkIndexes.length > 0) && (
          <Text style={styles.queueStatusText}>
            {isQueueRunning
              ? `Queue: ${queueProgress.completed}/${queueProgress.total}`
              : `Failed chunks: ${failedChunkIndexes.map((idx) => idx + 1).join(", ")}`}
          </Text>
        )}

        <TouchableOpacity
          style={styles.diagnosticsButton}
          onPress={runDiagnostics}
          disabled={isRunningDiagnostics}
        >
          <Feather name="activity" size={14} color="#34D399" style={{ marginRight: 8 }} />
          <Text style={styles.diagnosticsButtonText}>
            {isRunningDiagnostics ? "Running diagnostics..." : "Run Diagnostics"}
          </Text>
        </TouchableOpacity>

        {!!diagnosticsMessage && (
          <View style={styles.diagnosticsCard}>
            <Text style={styles.diagnosticsText}>{diagnosticsMessage}</Text>
          </View>
        )}

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
                onLongPress={() => {
                  if (previewUrl) {
                    setPreviewStickerUrl(previewUrl);
                    setPreviewStickerEmoji(sticker.emoji);
                    setPreviewModalVisible(true);
                  }
                }}
                activeOpacity={0.7}
                delayLongPress={300}
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
          {previewLoading && (
            <Text style={styles.previewLoadingText}>Loading preview images...</Text>
          )}
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
            (isProcessing || isQueueRunning || selectedChunkStickers.length < 3) &&
              styles.primaryBtnDisabled,
          ]}
          onPress={handleAddToWhatsApp}
          disabled={isProcessing || isQueueRunning || selectedChunkStickers.length < 3}
        >
          {isProcessing ? (
            <Text style={styles.primaryBtnText}>
              Processing {processingProgress}%...
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <View style={styles.plusCircle}>
                <Feather name="plus" size={16} color="#34D399" />
              </View>
              <Text style={styles.primaryBtnText}>
                Add to WhatsApp ({selectedChunkStickers.length} selected)
              </Text>
            </View>
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

      {/* Sticker Preview Modal */}
      <Modal
        visible={previewModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.previewModalOverlay} 
          activeOpacity={1} 
          onPress={() => setPreviewModalVisible(false)}
        >
          <View style={styles.previewModalContent}>
            {previewStickerUrl && (
              <Image
                source={{ uri: previewStickerUrl }}
                style={styles.previewModalImage}
                contentFit="contain"
              />
            )}
            {previewStickerEmoji && (
              <View style={styles.previewModalEmojiBadge}>
                <Text style={styles.previewModalEmojiText}>{previewStickerEmoji}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
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
  qualityRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 12,
    gap: 8,
  },
  qualityLabel: {
    color: "#718096",
    fontSize: 11,
    fontWeight: "700",
    marginRight: 4,
    letterSpacing: 1,
  },
  qualityChip: {
    borderWidth: 1,
    borderColor: "#2A3148",
    backgroundColor: "#141925",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  qualityChipActive: {
    borderColor: "rgba(52, 211, 153, 0.45)",
    backgroundColor: "rgba(52, 211, 153, 0.18)",
  },
  qualityChipText: {
    color: "#A0AEC0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  qualityChipTextActive: {
    color: "#34D399",
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 12,
    gap: 8,
  },
  modeLabel: {
    color: "#718096",
    fontSize: 11,
    fontWeight: "700",
    marginRight: 4,
    letterSpacing: 1,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: "#2A3148",
    backgroundColor: "#141925",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modeChipActive: {
    borderColor: "rgba(52, 211, 153, 0.45)",
    backgroundColor: "rgba(52, 211, 153, 0.18)",
  },
  modeChipText: {
    color: "#A0AEC0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  modeChipTextActive: {
    color: "#34D399",
  },
  queueRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  queueButton: {
    borderWidth: 1,
    borderColor: "#2A3148",
    backgroundColor: "#141925",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  queueButtonText: {
    color: "#A0AEC0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  queueStatusText: {
    color: "#34D399",
    fontSize: 12,
    marginBottom: 10,
    fontWeight: "600",
  },
  diagnosticsButton: {
    borderWidth: 1,
    borderColor: "#1A3329",
    backgroundColor: "rgba(52, 211, 153, 0.12)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginBottom: 10,
  },
  diagnosticsButtonText: {
    color: "#34D399",
    fontSize: 13,
    fontWeight: "700",
  },
  diagnosticsCard: {
    borderWidth: 1,
    borderColor: "#2A3148",
    backgroundColor: "#141925",
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  diagnosticsText: {
    color: "#A0AEC0",
    fontSize: 12,
    lineHeight: 18,
  },
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
  previewLoadingText: {
    color: "#718096",
    fontSize: 12,
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
  previewModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  previewModalContent: {
    width: "80%",
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  previewModalImage: {
    width: "100%",
    height: "100%",
  },
  previewModalEmojiBadge: {
    position: "absolute",
    bottom: -75,
    backgroundColor: "#13151D",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "#34D399",
  },
  previewModalEmojiText: {
    fontSize: 32,
  },
});
