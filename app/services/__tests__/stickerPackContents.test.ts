import { buildContentsJsonPayload } from '../stickerPackContents';

describe('buildContentsJsonPayload', () => {
  it('sets animated_sticker_pack when requested', () => {
    const payload = buildContentsJsonPayload({
      packId: 'test_pack',
      packName: 'Test Pack',
      trayIconFile: 'tray_icon.png',
      imageDataVersion: 'v_123',
      animatedStickerPack: true,
      stickers: [
        {
          fileName: '1.webp',
          emojis: ['😀', ' ', '🔥', '🚀'],
          accessibilityText: 'first sticker',
        },
      ],
    });

    const pack = payload.sticker_packs[0]!;
    expect(pack.animated_sticker_pack).toBe(true);
    expect(pack.stickers[0]).toEqual({
      image_file: '1.webp',
      emojis: ['😀', '🔥', '🚀'],
      accessibility_text: 'first sticker',
    });
  });

  it('defaults to static pack and normalizes empty emoji lists', () => {
    const payload = buildContentsJsonPayload({
      packId: 'test_pack',
      packName: 'Test Pack',
      trayIconFile: 'tray_icon.png',
      imageDataVersion: 'v_123',
      stickers: [
        {
          fileName: '2.webp',
          emojis: [],
        },
      ],
    });

    const pack = payload.sticker_packs[0]!;
    expect(pack.animated_sticker_pack).toBe(false);
    expect(pack.stickers[0]).toEqual({
      image_file: '2.webp',
      emojis: ['🙂'],
    });
  });
});
