import { NativeModules, Platform } from 'react-native';

const { WhatsAppStickerModule } = NativeModules;

export interface WhatsAppDiagnostics {
  providerAuthority: string;
  hasForegroundActivity: boolean;
  whatsappInstalled: boolean;
  supportedTargets: string[];
  whitelistProviderReachable?: {
    [provider: string]: boolean;
  };
}

export interface WhatsAppStickerInterface {
  sendStickerPack(destDir: string, packId: string, packName: string): Promise<string>;
  runBasicDiagnostics(): Promise<WhatsAppDiagnostics>;
  transcodeVideoSticker(
    inputPathOrUri: string,
    outputPathOrUri: string,
    mode: 'animated-webp' | 'still-webp',
    preset: 'fast' | 'small' | 'best',
  ): Promise<string>;
  transcodeTgsSticker(
    inputPathOrUri: string,
    outputPathOrUri: string,
    mode: 'animated-webp' | 'still-webp',
    preset: 'fast' | 'small' | 'best',
  ): Promise<string>;
  generateTrayIcon(
    inputPathOrUri: string,
    outputPathOrUri: string
  ): Promise<string>;
}

const unsupportedPlatformError =
  'WhatsApp sticker export is only supported on Android in this app.';

const WhatsAppStickerBridge: WhatsAppStickerInterface = {
  async sendStickerPack(destDir: string, packId: string, packName: string): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error(unsupportedPlatformError);
    }
    if (!WhatsAppStickerModule?.sendStickerPack) {
      throw new Error('Native Android module (WhatsAppStickerModule) is not linked.');
    }
    return WhatsAppStickerModule.sendStickerPack(destDir, packId, packName);
  },

  async runBasicDiagnostics(): Promise<WhatsAppDiagnostics> {
    if (Platform.OS !== 'android') {
      return {
        providerAuthority: '',
        hasForegroundActivity: false,
        whatsappInstalled: false,
        supportedTargets: [],
        whitelistProviderReachable: {},
      };
    }
    if (!WhatsAppStickerModule?.runBasicDiagnostics) {
      throw new Error('Native diagnostics API is not available. Rebuild the Android app.');
    }
    return WhatsAppStickerModule.runBasicDiagnostics();
  },

  async transcodeVideoSticker(
    inputPathOrUri: string,
    outputPathOrUri: string,
    mode: 'animated-webp' | 'still-webp',
    preset: 'fast' | 'small' | 'best',
  ): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error(unsupportedPlatformError);
    }
    if (!WhatsAppStickerModule?.transcodeVideoSticker) {
      throw new Error('Native video transcoder API is not available. Rebuild the Android app.');
    }
    return WhatsAppStickerModule.transcodeVideoSticker(
      inputPathOrUri,
      outputPathOrUri,
      mode,
      preset,
    );
  },

  async transcodeTgsSticker(
    inputPathOrUri: string,
    outputPathOrUri: string,
    mode: 'animated-webp' | 'still-webp',
    preset: 'fast' | 'small' | 'best',
  ): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error(unsupportedPlatformError);
    }
    if (!WhatsAppStickerModule?.transcodeTgsSticker) {
      throw new Error('Native TGS transcoder API is not available. Rebuild the Android app.');
    }
    return WhatsAppStickerModule.transcodeTgsSticker(
      inputPathOrUri,
      outputPathOrUri,
      mode,
      preset,
    );
  },

  async generateTrayIcon(
    inputPathOrUri: string,
    outputPathOrUri: string,
  ): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error(unsupportedPlatformError);
    }
    if (!WhatsAppStickerModule?.generateTrayIcon) {
      throw new Error('Native generic image conversion API is not available. Rebuild the Android app.');
    }
    return WhatsAppStickerModule.generateTrayIcon(
      inputPathOrUri,
      outputPathOrUri,
    );
  },
};

export default WhatsAppStickerBridge;
