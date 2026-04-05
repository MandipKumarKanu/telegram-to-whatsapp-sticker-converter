import React, { useEffect, useState } from "react";
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
  Image,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  listStoredPacks,
  StoredPackRecord,
  touchStoredPack,
  upsertStoredPack,
} from "../services/packLibrary";
import { TelegramApi } from "../services/telegramApi";

const BOT_TOKEN = process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN;

type RootStackParamList = {
  Home: undefined;
  Preview: { packName: string; initialCustomPackName?: string };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "Home">;

export default function HomeScreen() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [storedPacks, setStoredPacks] = useState<StoredPackRecord[]>([]);
  const navigation = useNavigation<NavigationProp>();

  // Custom Dialog State
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogConfig, setDialogConfig] = useState({
    title: "",
    message: "",
    actions: [{ text: "OK", onPress: () => {} }] as {
      text: string;
      onPress?: () => void;
    }[],
  });

  const showCustomDialog = (
    title: string,
    message: string,
    actions?: { text: string; onPress?: () => void }[],
  ) => {
    setDialogConfig({
      title,
      message,
      actions: actions || [{ text: "OK", onPress: () => {} }],
    });
    setDialogVisible(true);
  };

  useEffect(() => {
    let cancelled = false;
    const loadLibrary = async () => {
      try {
        const records = await listStoredPacks();
        if (!cancelled) setStoredPacks(records);
      } catch (error) {}
    };
    loadLibrary();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPacks = storedPacks.length;
  const totalStickers = storedPacks.reduce(
    (sum, r) => sum + r.supportedCount,
    0,
  );

  const extractPackName = (input: string) => {
    const regex = /(?:addstickers\/|stickers\/|^)([a-zA-Z0-9_]+)$/;
    const match = input.match(regex);
    return match ? match[1] : input.trim();
  };

  const handleFetchPack = async () => {
    if (!url)
      return showCustomDialog(
        "Error",
        "Please enter a sticker pack URL or name.",
      );
    if (!BOT_TOKEN)
      return showCustomDialog("Configuration Error", "Please set BOT_TOKEN.");
    const packName = extractPackName(url);
    if (!packName)
      return showCustomDialog("Error", "Could not extract pack name.");

    setIsLoading(true);
    try {
      const api = new TelegramApi(BOT_TOKEN);
      const setInfo = await api.getStickerSet(packName);
      const supportedStickers = setInfo.stickers.filter((s) =>
        !s.is_animated && !s.is_video ? true : Boolean(s.thumbnail?.file_id),
      );

      if (supportedStickers.length === 0)
        return showCustomDialog("Error", "No usable stickers.");

      const existing = storedPacks.find(
        (record) => record.packName === packName,
      );

      let coverUrl = existing?.coverUrl;
      if (!coverUrl) {
        const firstSticker = supportedStickers[0];
        const fileId =
          firstSticker.is_animated || firstSticker.is_video
            ? firstSticker.thumbnail?.file_id
            : firstSticker.file_id;
        if (fileId) {
          coverUrl = await api.getStickerDownloadUrlByFileId(fileId);
        }
      }

      const nextRecords = await upsertStoredPack({
        packName,
        title: setInfo.title,
        customPackName: existing?.customPackName,
        totalCount: setInfo.stickers.length,
        supportedCount: supportedStickers.length,
        packChunks: Math.ceil(supportedStickers.length / 30),
        coverUrl,
      });
      setStoredPacks(nextRecords);
      setUrl("");
      navigation.navigate("Preview", { packName });
    } catch (e: any) {
      showCustomDialog("Error", e.message || "Failed to fetch the pack.");
    } finally {
      setIsLoading(false);
    }
  };

  const openPack = async (packName: string, initialCustomName?: string) => {
    try {
      const nextRecords = await touchStoredPack(packName);
      setStoredPacks(nextRecords);
    } catch (error) {}

    navigation.navigate("Preview", {
      packName,
      initialCustomPackName: initialCustomName,
    });
  };

  const getRelativeTime = (isoString?: string) => {
    if (!isoString) return "Just now";
    const then = new Date(isoString).getTime();
    const now = Date.now();
    const diffMins = Math.floor((now - then) / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  };

  const handleEasterEgg = () => {
    showCustomDialog(
      "You found the Secret Feature! 🎉",
      "Have a virtual cookie 🍪\n\nThanks for checking out StickerBridge!",
      [{ text: "Yum!" }],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header Section */}
          <View style={styles.headerContainer}>
            <TouchableOpacity
              activeOpacity={0.8}
              onLongPress={handleEasterEgg}
              delayLongPress={800}
            >
              <Text style={styles.mainTitle}>StickerBridge</Text>
            </TouchableOpacity>
            <Text style={styles.subTitle}>
              Your sticker collection, unified
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.statPill}>
                <Feather name="box" size={14} color="#34D399" />
                <Text style={styles.statPillText}>
                  {totalPacks || 24} Packs
                </Text>
              </View>
              <View style={styles.statPill}>
                <MaterialCommunityIcons
                  name="sticker-emoji"
                  size={14}
                  color="#34D399"
                />
                <Text style={styles.statPillText}>
                  {totalStickers || 384} Stickers
                </Text>
              </View>
            </View>
          </View>

          {/* Convert Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconWrapper}>
                <Feather name="refresh-cw" size={16} color="#34D399" />
              </View>
              <Text style={styles.cardTitle}>Convert New Pack</Text>
            </View>
            <Text style={styles.inputLabel}>TELEGRAM URL</Text>
            <View style={styles.inputContainer}>
              <Feather
                name="link"
                size={16}
                color="#4A5568"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="https://t.me/addstickers/..."
                placeholderTextColor="#4A5568"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!url && (
                <TouchableOpacity
                  onPress={() => setUrl("")}
                  style={{ paddingLeft: 8, marginRight: 4 }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="x-circle" size={16} color="#4A5568" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!url || !url.trim()) && { opacity: 0.5 },
              ]}
              onPress={handleFetchPack}
              disabled={isLoading || !url || !url.trim()}
            >
              {isLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialCommunityIcons
                    name="chart-line-variant"
                    size={20}
                    color="#000"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.primaryButtonText}>
                    Analyze & Convert
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Created Packs Header */}
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Created Packs</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>VIEW ALL</Text>
            </TouchableOpacity>
          </View>

          {/* Packs List */}
          {storedPacks.map((record, index) => (
            <TouchableOpacity
              key={record.packName}
              style={styles.packCard}
              onPress={() => openPack(record.packName, record.customPackName)}
              activeOpacity={0.9}
            >
              <View style={styles.packImagePlaceholder}>
                {record.coverUrl ? (
                  <Image
                    source={{ uri: record.coverUrl }}
                    style={{
                      width: "100%",
                      height: "100%",
                      resizeMode: "cover",
                    }}
                  />
                ) : (
                  <Text style={{ color: "#4A5568", fontSize: 24 }}>Image</Text>
                )}
                <View style={styles.readyBadge}>
                  <Text style={styles.readyBadgeText}>READY</Text>
                </View>
              </View>

              <View style={styles.packBody}>
                <View style={styles.packHeaderRow}>
                  <Text style={styles.packTitle} numberOfLines={1}>
                    {record.customPackName || record.title || "Summer Vibe"}
                  </Text>
                  <Text style={styles.packTime}>
                    {getRelativeTime(record.updatedAt)}
                  </Text>
                </View>
                <Text style={styles.packHandle}>@{record.packName}</Text>

                <View style={styles.packStatsRow}>
                  <View style={styles.packStatItem}>
                    <MaterialCommunityIcons
                      name="sticker-emoji"
                      size={14}
                      color="#718096"
                    />
                    <Text style={styles.packStatText}>
                      {record.supportedCount} Stickers
                    </Text>
                  </View>
                  <View style={styles.packStatItem}>
                    <Feather name="layers" size={14} color="#718096" />
                    <Text style={styles.packStatText}>
                      {record.packChunks} Chunks
                    </Text>
                  </View>
                </View>

                <View style={styles.openButton}>
                  <Text style={styles.openButtonText}>Open Stickers</Text>
                  <Feather
                    name="external-link"
                    size={14}
                    color="#FF8A65"
                    style={{ marginLeft: 6 }}
                  />
                </View>
              </View>
            </TouchableOpacity>
          ))}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Dialog Modal */}
      <Modal
        transparent
        visible={dialogVisible}
        animationType="fade"
        onRequestClose={() => setDialogVisible(false)}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogContainer}>
            <Text style={styles.dialogTitle}>{dialogConfig.title}</Text>
            <Text style={styles.dialogMessage}>{dialogConfig.message}</Text>
            <View style={styles.dialogActions}>
              {dialogConfig.actions.map((action, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.dialogButton, index > 0 && { marginLeft: 12 }]}
                  onPress={() => {
                    setDialogVisible(false);
                    if (action.onPress) action.onPress();
                  }}
                >
                  <Text style={styles.dialogButtonText}>{action.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0D14" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#0B0D14",
    borderBottomWidth: 1,
    borderBottomColor: "#1A1D2D",
  },
  topBarLeft: { flexDirection: "row", alignItems: "center" },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1A1D2D",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  topBarTitle: {
    color: "#34D399",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  scrollContent: { padding: 20 },
  headerContainer: { marginBottom: 24 },
  mainTitle: {
    color: "#FFF",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  subTitle: { color: "#A0AEC0", fontSize: 15, marginBottom: 16 },
  statsRow: { flexDirection: "row", gap: 12 },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#131620",
    borderWidth: 1,
    borderColor: "#1E2335",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  statPillText: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 6,
  },
  card: {
    backgroundColor: "#13151D",
    borderRadius: 20,
    padding: 20,
    marginBottom: 32,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  cardIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(52, 211, 153, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardTitle: { color: "#FFF", fontSize: 18, fontWeight: "bold" },
  inputLabel: {
    color: "#4A5568",
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 8,
    letterSpacing: 1,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1D24",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: "#FFF", fontSize: 15, height: "100%" },
  primaryButton: {
    backgroundColor: "#34D399",
    borderRadius: 14,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: "#000", fontSize: 16, fontWeight: "bold" },
  sectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: { color: "#FFF", fontSize: 20, fontWeight: "bold" },
  viewAllText: {
    color: "#34D399",
    fontSize: 13,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  packCard: {
    backgroundColor: "#13151D",
    borderRadius: 20,
    marginBottom: 16,
    overflow: "hidden",
  },
  packImagePlaceholder: {
    height: 120,
    backgroundColor: "#1A1D2D",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  readyBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "#34D399",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  readyBadgeText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  packBody: { padding: 16 },
  packHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  packTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    marginRight: 8,
  },
  packTime: { color: "#718096", fontSize: 12 },
  packHandle: { color: "#34D399", fontSize: 13, marginBottom: 12 },
  packStatsRow: { flexDirection: "row", marginBottom: 16 },
  packStatItem: { flexDirection: "row", alignItems: "center", marginRight: 16 },
  packStatText: { color: "#A0AEC0", fontSize: 13, marginLeft: 6 },
  openButton: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 138, 101, 0.1)",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 138, 101, 0.2)",
  },
  openButtonText: { color: "#FF8A65", fontSize: 15, fontWeight: "600" },
  fab: {
    position: "absolute",
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#34D399",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#34D399",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  bottomNav: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#050505",
    flexDirection: "row",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === "ios" ? 24 : 12,
    paddingTop: 12,
    paddingHorizontal: 16,
    justifyContent: "space-around",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: "#1A1D2D",
  },
  navItem: { alignItems: "center", justifyContent: "center", flex: 1 },
  navItemActiveBg: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  navItemActiveText: {
    color: "#34D399",
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  navItemText: {
    color: "#718096",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
  },

  // Custom Dialog Styles
  dialogOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dialogContainer: {
    backgroundColor: "#13151D",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: "#1E2335",
  },
  dialogTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },
  dialogMessage: {
    color: "#A0AEC0",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end" },
  dialogButton: {
    backgroundColor: "rgba(52, 211, 153, 0.1)",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  dialogButtonText: { color: "#34D399", fontSize: 15, fontWeight: "bold" },
});
