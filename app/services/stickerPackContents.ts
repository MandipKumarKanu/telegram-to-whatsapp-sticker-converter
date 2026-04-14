export interface StickerMetadataInput {
  fileName: string;
  emojis: string[];
  accessibilityText?: string;
}

interface BuildContentsJsonPayloadParams {
  packId: string;
  packName: string;
  trayIconFile: string;
  stickers: StickerMetadataInput[];
  imageDataVersion: string;
  animatedStickerPack?: boolean;
}

export function buildContentsJsonPayload({
  packId,
  packName,
  trayIconFile,
  stickers,
  imageDataVersion,
  animatedStickerPack = false,
}: BuildContentsJsonPayloadParams) {
  return {
    image_data_version: imageDataVersion,
    android_play_store_link: '',
    ios_app_store_link: '',
    ios_app_download_link: '',
    sticker_packs: [
      {
        identifier: packId,
        name: packName,
        publisher: 'StickerBridge By Mandy',
        tray_image_file: trayIconFile,
        publisher_email: 'mandipshah3@gmail.com',
        publisher_website: 'https://mandipkk.com.np',
        privacy_policy_website: 'https://mandipkk.com.np',
        license_agreement_website: 'https://mandipkk.com.np',
        image_data_version: imageDataVersion,
        avoid_cache: false,
        animated_sticker_pack: animatedStickerPack,
        stickers: stickers.map((sticker) => {
          const normalizedEmojis = sticker.emojis
            .filter((emoji) => Boolean(emoji && emoji.trim()))
            .slice(0, 3);

          return {
            image_file: sticker.fileName,
            emojis: normalizedEmojis.length ? normalizedEmojis : ['🙂'],
            ...(sticker.accessibilityText ? { accessibility_text: sticker.accessibilityText } : {}),
          };
        }),
      },
    ],
  };
}
