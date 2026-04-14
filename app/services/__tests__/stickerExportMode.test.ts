import { shouldUseAnimatedPack } from '../stickerExportMode';

describe('shouldUseAnimatedPack', () => {
  it('returns false for empty chunks', () => {
    expect(shouldUseAnimatedPack([])).toBe(false);
  });

  it('returns false for static-only chunks', () => {
    expect(shouldUseAnimatedPack(['static', 'static'])).toBe(false);
  });

  it('returns true for animated-only chunks', () => {
    expect(shouldUseAnimatedPack(['animated', 'animated'])).toBe(true);
  });

  it('returns false for video-only chunks', () => {
    expect(shouldUseAnimatedPack(['video', 'video'])).toBe(false);
  });

  it('returns false for mixed animated/video chunks', () => {
    expect(shouldUseAnimatedPack(['animated', 'video'])).toBe(false);
  });

  it('returns false when static stickers are mixed with animated/video', () => {
    expect(shouldUseAnimatedPack(['video', 'static'])).toBe(false);
    expect(shouldUseAnimatedPack(['animated', 'static'])).toBe(false);
  });
});
