export type StickerSourceKind = 'static' | 'animated' | 'video';

export function shouldUseAnimatedPack(sourceKinds: StickerSourceKind[]): boolean {
  if (!sourceKinds.length) {
    return false;
  }

  // Video-derived animated WebP is still rejected by many WhatsApp clients.
  // Keep video selections on static export for reliable add-to-WhatsApp behavior.
  const hasVideo = sourceKinds.some(kind => kind === 'video');
  if (hasVideo) {
    return false;
  }

  const hasStatic = sourceKinds.some(kind => kind === 'static');
  const hasAnimated = sourceKinds.some(kind => kind === 'animated');

  // WhatsApp strictly rejects sticker packs that mix animated and static stickers.
  // If the pack has a mix, we must fallback to static export to prevent "problem with sticker pack" errors.
  if (hasAnimated && !hasStatic) {
    return true;
  }
  
  return false;
}
