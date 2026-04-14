export const TELEGRAM_API_URL = "https://api.telegram.org/bot";

const REQUEST_TIMEOUT_MS = 25000;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const REACHABILITY_TIMEOUT_MS = 5000;

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

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBackoffDelay = (attempt: number): number => {
  const jitter = Math.floor(Math.random() * 200);
  return BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
};

const probeTelegramReachability = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);

  try {
    await fetch("https://api.telegram.org", {
      method: "GET",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const mapTelegramErrorMessage = (
  message: string,
  status?: number,
): string => {
  const lower = message.toLowerCase();

  if (
    lower.includes("invalid telegram bot token") ||
    lower.includes("unauthorized")
  ) {
    return "Telegram bot token is invalid. Update EXPO_PUBLIC_TELEGRAM_BOT_TOKEN and try again.";
  }

  if (
    lower.includes("stickerset_invalid") ||
    lower.includes("sticker set not found")
  ) {
    return "Sticker pack was not found. Check the URL or pack name and try again.";
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Telegram request timed out. If your internet works, your network may be blocking api.telegram.org (try mobile data or VPN).";
  }

  if (lower.includes("network") || lower.includes("failed to fetch")) {
    return "Network error while contacting Telegram. Check your internet and try again.";
  }

  if (status === 429 || lower.includes("too many requests")) {
    return "Telegram is rate limiting requests. Please wait a moment and retry.";
  }

  if (typeof status === "number" && status >= 500) {
    return "Telegram is temporarily unavailable. Please try again shortly.";
  }

  return message || "Failed to communicate with Telegram.";
};

const isRetryableError = (message: string, status?: number): boolean => {
  const lower = message.toLowerCase();
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  return (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("failed to fetch")
  );
};

export class TelegramApi {
  private botToken: string;

  constructor(botToken: string) {
    const normalizedToken = botToken.trim().replace(/^['\"]+|['\"]+$/g, "");
    if (!normalizedToken || normalizedToken === "your_bot_token_here") {
      throw new Error(
        "Invalid Telegram Bot Token. Please configure it in .env",
      );
    }
    this.botToken = normalizedToken;
  }

  private async request<T>(
    method: string,
    params: Record<string, string>,
  ): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const url = `${TELEGRAM_API_URL}${this.botToken}/${method}?${query}`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal });
        const data = (await response.json()) as TelegramApiResponse<T>;

        if (!response.ok) {
          const rawMessage =
            data.description ||
            `Telegram request failed with HTTP ${response.status}`;
          const mapped = mapTelegramErrorMessage(rawMessage, response.status);
          const retryable = isRetryableError(rawMessage, response.status);

          if (retryable && attempt < MAX_RETRY_ATTEMPTS) {
            await sleep(getBackoffDelay(attempt));
            continue;
          }

          throw new Error(mapped);
        }

        if (!data.ok || data.result === undefined) {
          const rawMessage =
            data.description || "Telegram API returned an unexpected response.";
          const mapped = mapTelegramErrorMessage(rawMessage, data.error_code);
          const retryable = isRetryableError(rawMessage, data.error_code);

          if (retryable && attempt < MAX_RETRY_ATTEMPTS) {
            await sleep(getBackoffDelay(attempt));
            continue;
          }

          throw new Error(mapped);
        }

        return data.result;
      } catch (error: any) {
        const rawMessage =
          error?.name === "AbortError"
            ? "Request timed out."
            : error?.message || "Unknown network error.";
        const mapped = mapTelegramErrorMessage(rawMessage);
        const retryable = isRetryableError(rawMessage);
        lastError = new Error(mapped);

        if (retryable && attempt < MAX_RETRY_ATTEMPTS) {
          await sleep(getBackoffDelay(attempt));
          continue;
        }

        if (retryable && attempt === MAX_RETRY_ATTEMPTS) {
          const telegramReachable = await probeTelegramReachability();
          if (!telegramReachable) {
            throw new Error(
              "Could not reach api.telegram.org from this network. If internet works on your phone, switch network or enable VPN and try again.",
            );
          }
        }

        throw lastError;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error("Failed to communicate with Telegram.");
  }

  async getStickerSet(name: string): Promise<TelegramStickerSet> {
    return this.request<TelegramStickerSet>("getStickerSet", { name });
  }

  async getStickerFilePath(fileId: string): Promise<string> {
    const result = await this.request<{ file_path: string }>("getFile", {
      file_id: fileId,
    });
    return result.file_path;
  }

  getStickerDownloadUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
  }

  async getStickerDownloadUrlByFileId(fileId: string): Promise<string> {
    const filePath = await this.getStickerFilePath(fileId);
    return this.getStickerDownloadUrl(filePath);
  }
}
