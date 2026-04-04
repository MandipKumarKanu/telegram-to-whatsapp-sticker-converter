import { NativeModules } from 'react-native';

const { WhatsAppStickerModule } = NativeModules;

export interface WhatsAppStickerInterface {
  sendStickerPack(destDir: string, packId: string, packName: string): Promise<string>;
}

export default WhatsAppStickerModule as WhatsAppStickerInterface;
