import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import WhatsAppStickerModule from '../native/WhatsAppStickerModule';
import { buildContentsJsonPayload } from './stickerPackContents';

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

export type StickerQualityPreset = 'fast' | 'small' | 'best';

const STICKER_SIZE = 512;
const TRAY_ICON_SIZE = 96;
export const STICKER_MAX_BYTES = 100000;
export const ANIMATED_STICKER_MAX_BYTES = 500000;
const TRAY_ICON_MAX_BYTES = 50000;

export class StickerConverter {

  private toFileUri(pathOrUri: string): string {
    if (pathOrUri.startsWith('file://')) {
      return pathOrUri;
    }
    return `file://${pathOrUri}`;
  }

  private async ensureStickerSize(outputUri: string, maxBytes: number, errorLabel: string): Promise<number> {
    const info = await FileSystem.getInfoAsync(outputUri);
    const fileSize = info.exists && typeof info.size === 'number' ? info.size : Number.MAX_SAFE_INTEGER;
    if (!info.exists || !info.size || fileSize <= 0 || fileSize > maxBytes) {
      throw new Error(`${errorLabel} exceeds WhatsApp size limit (${fileSize} bytes).`);
    }
    return fileSize;
  }
  
  // Create a temporary directory for raw downloads
  private async getRawDir() {
    const dir = `${FileSystem.cacheDirectory}raw_stickers/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  }

  // Optional: Clean up the raw directory after conversion sequence is complete
  async clearRawCache() {
    try {
      const dir = `${FileSystem.cacheDirectory}raw_stickers/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      }
    } catch (e) {
      console.warn("Failed to clear raw sticker cache:", e);
    }
  }

  // Converts a downloaded image to exactly 512x512 WebP with a quality preset.
  async convertToWhatsAppSticker(
    sourceUri: string,
    index: number,
    preset: StickerQualityPreset = 'best',
  ): Promise<StickerConversionResult> {
    const attemptsByPreset: Record<StickerQualityPreset, { size: number; quality: number }[]> = {
      fast: [
        { size: STICKER_SIZE, quality: 0.7 },
        { size: STICKER_SIZE, quality: 0.55 },
        { size: STICKER_SIZE, quality: 0.4 },
      ],
      small: [
        { size: STICKER_SIZE, quality: 0.55 },
        { size: STICKER_SIZE, quality: 0.4 },
        { size: STICKER_SIZE, quality: 0.3 },
        { size: STICKER_SIZE, quality: 0.25 },
        { size: STICKER_SIZE, quality: 0.2 },
      ],
      best: [
        { size: STICKER_SIZE, quality: 0.9 },
        { size: STICKER_SIZE, quality: 0.8 },
        { size: STICKER_SIZE, quality: 0.7 },
        { size: STICKER_SIZE, quality: 0.55 },
        { size: STICKER_SIZE, quality: 0.4 },
      ],
    };

    const attempts = attemptsByPreset[preset];

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

  async convertVideoToAnimatedSticker(
    sourceUri: string,
    index: number,
    preset: StickerQualityPreset = 'best',
  ): Promise<StickerConversionResult> {
    const rawDir = await this.getRawDir();
    const outputPath = `${rawDir}${index}_animated.webp`;

    const nativeOutputPath = await WhatsAppStickerModule.transcodeVideoSticker(
      sourceUri,
      outputPath,
      'animated-webp',
      preset,
    );

    const outputUri = this.toFileUri(nativeOutputPath);
    await this.ensureStickerSize(outputUri, ANIMATED_STICKER_MAX_BYTES, `Animated sticker ${index}`);

    return {
      uri: outputUri,
      fileName: `${index}.webp`,
    };
  }

  async convertVideoToStillSticker(
    sourceUri: string,
    index: number,
    preset: StickerQualityPreset = 'best',
  ): Promise<StickerConversionResult> {
    const rawDir = await this.getRawDir();
    const outputPath = `${rawDir}${index}_still.webp`;

    const nativeOutputPath = await WhatsAppStickerModule.transcodeVideoSticker(
      sourceUri,
      outputPath,
      'still-webp',
      preset,
    );

    const outputUri = this.toFileUri(nativeOutputPath);
    await this.ensureStickerSize(outputUri, STICKER_MAX_BYTES, `Video sticker fallback ${index}`);

    return {
      uri: outputUri,
      fileName: `${index}.webp`,
    };
  }

  async convertTgsToAnimatedSticker(
    sourceUri: string,
    index: number,
    preset: StickerQualityPreset = 'best',
  ): Promise<StickerConversionResult> {
    const rawDir = await this.getRawDir();
    const outputPath = `${rawDir}${index}_tgs_animated.webp`;

    const nativeOutputPath = await WhatsAppStickerModule.transcodeTgsSticker(
      sourceUri,
      outputPath,
      'animated-webp',
      preset,
    );

    const outputUri = this.toFileUri(nativeOutputPath);
    await this.ensureStickerSize(outputUri, ANIMATED_STICKER_MAX_BYTES, `Animated TGS sticker ${index}`);

    return {
      uri: outputUri,
      fileName: `${index}.webp`,
    };
  }

  async convertTgsToStillSticker(
    sourceUri: string,
    index: number,
    preset: StickerQualityPreset = 'best',
  ): Promise<StickerConversionResult> {
    const rawDir = await this.getRawDir();
    const outputPath = `${rawDir}${index}_tgs_still.webp`;

    const nativeOutputPath = await WhatsAppStickerModule.transcodeTgsSticker(
      sourceUri,
      outputPath,
      'still-webp',
      preset,
    );

    const outputUri = this.toFileUri(nativeOutputPath);
    await this.ensureStickerSize(outputUri, STICKER_MAX_BYTES, `TGS fallback sticker ${index}`);

    return {
      uri: outputUri,
      fileName: `${index}.webp`,
    };
  }

  // Create tray icon (96x96, <50KB)
  async createTrayIcon(sourceUri: string): Promise<StickerConversionResult> {
    const rawDir = await this.getRawDir();
    const outputPath = `${rawDir}tray_icon_temp.png`;

    try {
      const nativeOutputPath = await WhatsAppStickerModule.generateTrayIcon(
        sourceUri,
        outputPath
      );

      const outputUri = this.toFileUri(nativeOutputPath);
      await this.ensureStickerSize(outputUri, 50000, `Tray icon`);

      return {
        uri: outputUri,
        fileName: 'tray_icon.png',
      };
    } catch (e: any) {
      throw new Error(`Failed to generate tray icon natively: ${e.message}`);
    }
  }

  // Download a single file using expo file system
  async downloadFile(url: string, fileId: string, extension = 'webp'): Promise<string> {
    const rawDir = await this.getRawDir();
    const safeExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const destination = `${rawDir}${fileId}.${safeExt}`;
    
    const { uri } = await FileSystem.downloadAsync(url, destination);
    return uri;
  }

  async generateContentsJson(
    packId: string, 
    packName: string, 
    trayIconFile: string, 
    stickers: StickerMetadata[],
    imageDataVersion: string,
    animatedStickerPack = false,
  ) {
    const contentsObj = buildContentsJsonPayload({
      packId,
      packName,
      trayIconFile,
      stickers,
      imageDataVersion,
      animatedStickerPack,
    });

    const dest = `${FileSystem.documentDirectory}contents.json`;
    await FileSystem.writeAsStringAsync(dest, JSON.stringify(contentsObj, null, 2));
    return dest;
  }
}
