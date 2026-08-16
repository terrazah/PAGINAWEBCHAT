export type GiftCategory = 'amor' | 'terror' | 'fuego' | 'divertido';

export type CustomGiftAsset = {
  id: string;
  category: GiftCategory;
  label: string;
  description: string;
  src: string;
  vip: boolean;
};

const categoryOrder: GiftCategory[] = ['amor', 'terror', 'fuego', 'divertido'];
const assetPath = (tier: 'free' | 'vip', filename: string) =>
  `${import.meta.env.BASE_URL}gifts/custom/${tier}/${filename}`;

function createAssets(tier: 'free' | 'vip', count: number): CustomGiftAsset[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    const vip = tier === 'vip';
    return {
      id: `custom-${tier}-${number}`,
      category: categoryOrder[index % categoryOrder.length],
      label: `${vip ? 'Regalo VIP' : 'Regalo libre'} ${number}`,
      description: vip ? 'Un detalle exclusivo para miembros VIP.' : 'Un detalle animado para compartir sin costo.',
      src: assetPath(tier, `gift-${tier}-${number}.gif`),
      vip,
    };
  });
}

export const CUSTOM_GIFT_ASSETS: CustomGiftAsset[] = [
  ...createAssets('free', 24),
  ...createAssets('vip', 19),
];