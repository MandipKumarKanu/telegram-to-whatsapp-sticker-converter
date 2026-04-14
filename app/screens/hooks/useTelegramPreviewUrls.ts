import { useEffect, useState } from 'react';
import { TelegramApi } from '../../services/telegramApi';

export interface PreviewStickerRef {
  key: string;
  sourceFileId: string;
  previewFileId?: string;
}

interface UseTelegramPreviewUrlsParams {
  botToken?: string;
  selectedChunk: PreviewStickerRef[];
}

export function useTelegramPreviewUrls({
  botToken,
  selectedChunk,
}: UseTelegramPreviewUrlsParams) {
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!selectedChunk.length || !botToken) {
      return;
    }

    const missing = selectedChunk.filter((sticker) => !previewMap[sticker.key]);
    if (!missing.length) {
      return;
    }

    let cancelled = false;

    const loadPreviewUrls = async () => {
      setPreviewLoading(true);
      try {
        const api = new TelegramApi(botToken);

        // Fetch in small batches to reduce Telegram API 429s.
        const batchSize = 5;
        const pairs: [string, string][] = [];

        for (let i = 0; i < missing.length; i += batchSize) {
          if (cancelled) return;

          const batch = missing.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (sticker) => {
              const previewFileId = sticker.previewFileId || sticker.sourceFileId;
              const url = await api.getStickerDownloadUrlByFileId(previewFileId);
              return [sticker.key, url] as [string, string];
            }),
          );

          pairs.push(...batchResults);
        }

        if (cancelled) return;

        setPreviewMap((prev) => {
          const next = { ...prev };
          pairs.forEach(([key, url]) => {
            next[key] = url;
          });
          return next;
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load preview stickers', error);
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
  }, [botToken, previewMap, selectedChunk]);

  return {
    previewMap,
    setPreviewMap,
    previewLoading,
  };
}
