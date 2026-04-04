export const TELEGRAM_API_URL = 'https://api.telegram.org/bot';

export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  is_animated: boolean;
  is_video: boolean;
  emoji?: string;
  thumbnail?: {
    file_id: string;
    file_unique_id?: string;
  };
}

export interface TelegramStickerSet {
  name: string;
  title: string;
  stickers: TelegramSticker[];
}

export class TelegramApi {
  private botToken: string;

  constructor(botToken: string) {
    if (!botToken || botToken === 'your_bot_token_here') {
      throw new Error('Invalid Telegram Bot Token. Please configure it in .env');
    }
    this.botToken = botToken;
  }

  async getStickerSet(name: string): Promise<TelegramStickerSet> {
    const url = `${TELEGRAM_API_URL}${this.botToken}/getStickerSet?name=${name}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.description || 'Failed to fetch sticker set');
    }

    return data.result as TelegramStickerSet;
  }

  async getStickerFilePath(fileId: string): Promise<string> {
    const url = `${TELEGRAM_API_URL}${this.botToken}/getFile?file_id=${fileId}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.description || 'Failed to get sticker file path');
    }

    return data.result.file_path;
  }

  getStickerDownloadUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
  }

  async getStickerDownloadUrlByFileId(fileId: string): Promise<string> {
    const filePath = await this.getStickerFilePath(fileId);
    return this.getStickerDownloadUrl(filePath);
  }
}
