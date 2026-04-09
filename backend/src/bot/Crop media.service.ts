import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CropMedia {
  emoji: string;
  imageUrl: string | null;
}

@Injectable()
export class CropMediaService {
  private readonly logger = new Logger(CropMediaService.name);

  // Cache to avoid hitting API on every listing
  private readonly imageCache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  // ─── Get emoji + image URL for a crop ────────────────────
  async getMedia(product: string): Promise<CropMedia> {
    const emoji = this.getEmoji(product);
    const imageUrl = await this.getImage(product);
    return { emoji, imageUrl };
  }

  // ─── Dynamic emoji per crop ───────────────────────────────
  getEmoji(product: string): string {
    const lower = product.toLowerCase();

    const emojiMap: Record<string, string> = {
      // Grains & cereals
      maize: '🌽',
      corn: '🌽',
      rice: '🍚',
      wheat: '🌾',
      millet: '🌾',
      sorghum: '🌾',

      // Roots & tubers
      cassava: '🥔',
      manioc: '🥔',
      yam: '🍠',
      potato: '🥔',
      'sweet potato': '🍠',
      macabo: '🥔',
      cocoyam: '🥔',

      // Vegetables
      tomatoes: '🍅',
      tomato: '🍅',
      tomate: '🍅',
      pepper: '🌶️',
      piment: '🌶️',
      onion: '🧅',
      oignon: '🧅',
      garlic: '🧄',
      ail: '🧄',
      eggplant: '🍆',
      aubergine: '🍆',
      cucumber: '🥒',
      concombre: '🥒',
      okra: '🥬',
      gombo: '🥬',
      cabbage: '🥬',
      chou: '🥬',
      carrot: '🥕',
      carotte: '🥕',
      spinach: '🥬',
      lettuce: '🥬',

      // Fruits
      plantain: '🍌',
      banana: '🍌',
      banane: '🍌',
      mango: '🥭',
      mangue: '🥭',
      avocado: '🥑',
      avocat: '🥑',
      pineapple: '🍍',
      ananas: '🍍',
      papaya: '🍈',
      orange: '🍊',
      lemon: '🍋',
      citron: '🍋',
      watermelon: '🍉',
      pasteque: '🍉',
      coconut: '🥥',
      noix: '🥜',

      // Legumes
      beans: '🫘',
      haricot: '🫘',
      groundnuts: '🥜',
      arachide: '🥜',
      peanut: '🥜',
      soybean: '🫘',
      cowpea: '🫘',

      // Animal products
      chicken: '🐔',
      poulet: '🐔',
      fish: '🐟',
      poisson: '🐟',
      pork: '🥩',
      porc: '🥩',
      beef: '🥩',
      boeuf: '🥩',
      egg: '🥚',
      oeuf: '🥚',
      milk: '🥛',
      lait: '🥛',

      // Other
      'palm oil': '🛢️',
      palme: '🛢️',
      coffee: '☕',
      cafe: '☕',
      cocoa: '🍫',
      cacao: '🍫',
      sugar: '🍬',
      sucre: '🍬',
      'njama njama': '🥬',
    };

    // Direct match
    if (emojiMap[lower]) return emojiMap[lower];

    // Partial match
    for (const [key, emoji] of Object.entries(emojiMap)) {
      if (lower.includes(key) || key.includes(lower)) return emoji;
    }

    // Default
    return '🌿';
  }

  // ─── Get real image URL using Unsplash free API ───────────
  async getImage(product: string): Promise<string | null> {
    const cacheKey = product.toLowerCase();
    if (this.imageCache.has(cacheKey)) {
      return this.imageCache.get(cacheKey)!;
    }

    const accessKey = this.config.get<string>('UNSPLASH_ACCESS_KEY');
    if (!accessKey) {
      this.logger.warn('UNSPLASH_ACCESS_KEY not set — no crop images');
      return null;
    }

    try {
      const query = encodeURIComponent(`${product} crop farm fresh`);
      const url = `https://api.unsplash.com/photos/random?query=${query}&orientation=landscape&client_id=${accessKey}`;
      const res = await fetch(url);

      if (!res.ok) {
        this.logger.warn(`Unsplash failed for "${product}": ${res.status}`);
        return null;
      }

      const data = (await res.json()) as { urls?: { regular?: string } };
      const imageUrl = data?.urls?.regular ?? null;

      if (imageUrl) {
        this.imageCache.set(cacheKey, imageUrl);
        this.logger.log(`Unsplash image fetched for "${product}"`);
      }

      return imageUrl;
    } catch (err: any) {
      this.logger.warn(`Unsplash error for "${product}": ${err?.message}`);
      return null;
    }
  }

  // ─── Build listing confirmed message with correct emoji ───
  buildListingConfirmedMessage(
    product: string,
    productDisplay: string,
    quantity: number,
    unit: string,
    price: string,
    lang: 'english' | 'french' | 'pidgin',
    emoji: string,
  ): string {
    const displayName = productDisplay || product;

    const msgs: Record<string, string> = {
      english: `✅ *Listing Created!*\n\n${emoji} ${displayName}\n📦 ${quantity} ${unit}\n💰 ${price}\n\nBuyers will be notified.`,
      french: `✅ *Annonce créée!*\n\n${emoji} ${displayName}\n📦 ${quantity} ${unit}\n💰 ${price}\n\nLes acheteurs seront notifiés.`,
      pidgin: `✅ *Listing don create!*\n\n${emoji} ${displayName}\n📦 ${quantity} ${unit}\n💰 ${price}\n\nBuyers go see am.`,
    };

    return msgs[lang] ?? msgs['english'];
  }
}
