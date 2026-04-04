import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

export interface StickerConversionResult {
  uri: string; // The local file system URI of the converted generated webp
  fileName: string; // The file name without path
}

export interface WebPPaperPack {
  androidAssetsPath: string; // the path where the sticker assets are saved to
  contentsJsonUri: string; // Path to contents.json
  trayIconFileName: string;
}

export interface StickerMetadata {
  fileName: string;
  emojis: string[];
  accessibilityText?: string;
}

const STICKER_SIZE = 512;
const TRAY_ICON_SIZE = 96;
const STICKER_MAX_BYTES = 100000;
const TRAY_ICON_MAX_BYTES = 50000;

export class StickerConverter {
  
  // Create a temporary directory for raw downloads
  private async getRawDir() {
    const dir = `${FileSystem.cacheDirectory}raw_stickers/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  }

  // Converts a downloaded image to exactly 512x512 WebP (< 100KB is usually achieved with normal compression, but we can lower quality if needed)
  async convertToWhatsAppSticker(sourceUri: string, index: number): Promise<StickerConversionResult> {
    const attempts = [
      { size: STICKER_SIZE, quality: 0.85 },
      { size: STICKER_SIZE, quality: 0.7 },
      { size: STICKER_SIZE, quality: 0.55 },
      { size: STICKER_SIZE, quality: 0.4 },
      { size: STICKER_SIZE, quality: 0.3 },
      { size: STICKER_SIZE, quality: 0.25 },
    ];

    let smallestBytes = Number.MAX_SAFE_INTEGER;

    for (const attempt of attempts) {
      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: attempt.size, height: attempt.size } }],
        { compress: attempt.quality, format: ImageManipulator.SaveFormat.WEBP }
      );

      const info = await FileSystem.getInfoAsync(result.uri);
      const fileSize = info.exists && typeof info.size === 'number' ? info.size : Number.MAX_SAFE_INTEGER;
      if (fileSize < smallestBytes) {
        smallestBytes = fileSize;
      }

      if (info.exists && info.size && info.size <= STICKER_MAX_BYTES) {
        return {
          uri: result.uri,
          fileName: `${index}.webp`
        };
      }
    }

    throw new Error(`Sticker ${index} is too large for WhatsApp after conversion (${smallestBytes} bytes).`);
  }

  // Create tray icon (96x96, <50KB)
  async createTrayIcon(sourceUri: string): Promise<StickerConversionResult> {
    const traySizes = [TRAY_ICON_SIZE];
    let smallestBytes = Number.MAX_SAFE_INTEGER;

    for (const size of traySizes) {
      const attempt = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: size, height: size } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      const info = await FileSystem.getInfoAsync(attempt.uri);
      const fileSize = info.exists && typeof info.size === 'number' ? info.size : Number.MAX_SAFE_INTEGER;
      if (fileSize < smallestBytes) {
        smallestBytes = fileSize;
      }

      if (info.exists && info.size && info.size <= TRAY_ICON_MAX_BYTES) {
        return {
          uri: attempt.uri,
          fileName: 'tray_icon.png',
        };
      }
    }

    throw new Error(`Tray icon is too large for WhatsApp after conversion (${smallestBytes} bytes).`);
  }

  // Download a single file using expo file system
  async downloadFile(url: string, fileId: string): Promise<string> {
    const rawDir = await this.getRawDir();
    const destination = `${rawDir}${fileId}.webp`; // telegram static stickers are webp
    
    const { uri } = await FileSystem.downloadAsync(url, destination);
    return uri;
  }

  async generateContentsJson(
    packId: string, 
    packName: string, 
    trayIconFile: string, 
    stickers: StickerMetadata[],
    imageDataVersion: string
  ) {
    const contentsObj = {
      image_data_version: imageDataVersion,
      android_play_store_link: "",
      ios_app_store_link: "",
      ios_app_download_link: "",
      sticker_packs: [
        {
          identifier: packId,
          name: packName,
          publisher: "StickerBridge By Mandy",
          tray_image_file: trayIconFile,
          publisher_email: "mandipshah3@gmail.com",
          publisher_website: "https://mandipkk.com.np",
          privacy_policy_website: "https://mandipkk.com.np",
          license_agreement_website: "https://mandipkk.com.np",
          image_data_version: imageDataVersion,
          avoid_cache: false,
          animated_sticker_pack: false,
          stickers: stickers.map(sticker => {
            const normalizedEmojis = sticker.emojis.filter(emoji => Boolean(emoji && emoji.trim())).slice(0, 3);

            return {
              image_file: sticker.fileName,
              emojis: normalizedEmojis.length ? normalizedEmojis : ['🙂'],
              ...(sticker.accessibilityText ? { accessibility_text: sticker.accessibilityText } : {}),
            };
          })
        }
      ]
    };

    const dest = `${FileSystem.documentDirectory}contents.json`;
    await FileSystem.writeAsStringAsync(dest, JSON.stringify(contentsObj, null, 2));
    return dest;
  }
}
