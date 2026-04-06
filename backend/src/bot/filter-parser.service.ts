import { Injectable } from '@nestjs/common';

export interface ParsedBuyCommand {
  product:  string;
  quantity: number;
  unit:     string;
  location?: string;   // from @yaounde
  minPrice?: number;   // from #10000-20000
  maxPrice?: number;
}

@Injectable()
export class FilterParserService {

  // ─── Parse BUY command with optional filters ──────────────
  // Supports:
  //   BUY maize 20 bags
  //   BUY maize 20 bags @yaounde
  //   BUY maize 20 bags #10000-20000
  //   BUY maize 20 bags @yaounde #10000-20000
  //   ACHETER maïs 20 sacs @yaounde
  parse(command: string): ParsedBuyCommand | null {
    const normalized = this.normalizeCommand(command.trim());
    const parts      = normalized.toLowerCase().split(/\s+/);

    if (parts.length < 3) return null;

    // Remove command keyword (buy/sell)
    const keyword = parts[0];
    if (keyword !== 'buy' && keyword !== 'sell') return null;

    let location: string | undefined;
    let minPrice: number | undefined;
    let maxPrice: number | undefined;

    // ── Extract filters (@location, #price) ──────────────
    const cleanParts: string[] = [];

    for (const part of parts.slice(1)) {
      // @location filter
      if (part.startsWith('@')) {
        location = this.normalizeLocation(part.slice(1));
        continue;
      }

      // #min-max price filter
      if (part.startsWith('#')) {
        const range = part.slice(1).split('-');
        if (range.length === 2) {
          minPrice = parseInt(range[0], 10) || undefined;
          maxPrice = parseInt(range[1], 10) || undefined;
        } else if (range.length === 1) {
          // #20000 means max price
          maxPrice = parseInt(range[0], 10) || undefined;
        }
        continue;
      }

      cleanParts.push(part);
    }

    // ── Extract quantity (last number in cleanParts) ──────
    let quantityIndex = -1;
    for (let i = cleanParts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(cleanParts[i])) {
        quantityIndex = i;
        break;
      }
    }

    if (quantityIndex === -1) return null;

    // ── Extract product (everything between keyword and qty)
    const productParts = cleanParts.slice(0, quantityIndex);
    const product      = this.normalizeProduct(productParts.join(' '));
    const quantity     = parseInt(cleanParts[quantityIndex], 10);
    const unit         = cleanParts[quantityIndex + 1] || 'bags';

    if (!product || quantity <= 0) return null;

    return { product, quantity, unit, location, minPrice, maxPrice };
  }

  // ─── Check if command has filters ────────────────────────
  hasFilters(command: string): boolean {
    return command.includes('@') || command.includes('#');
  }

  // ─── Build filter summary for user confirmation ───────────
  buildFilterSummary(
    parsed: ParsedBuyCommand,
    lang: 'english' | 'french' | 'pidgin',
  ): string {
    const filters: string[] = [];

    if (parsed.location) {
      const labels = { english: `📍 Location: ${parsed.location}`, french: `📍 Localité: ${parsed.location}`, pidgin: `📍 Side: ${parsed.location}` };
      filters.push(labels[lang]);
    }

    if (parsed.minPrice && parsed.maxPrice) {
      const labels = {
        english: `💰 Price: ${parsed.minPrice.toLocaleString()} – ${parsed.maxPrice.toLocaleString()} FCFA`,
        french:  `💰 Prix: ${parsed.minPrice.toLocaleString()} – ${parsed.maxPrice.toLocaleString()} FCFA`,
        pidgin:  `💰 Price: ${parsed.minPrice.toLocaleString()} – ${parsed.maxPrice.toLocaleString()} FCFA`,
      };
      filters.push(labels[lang]);
    } else if (parsed.maxPrice) {
      const labels = {
        english: `💰 Max price: ${parsed.maxPrice.toLocaleString()} FCFA`,
        french:  `💰 Prix max: ${parsed.maxPrice.toLocaleString()} FCFA`,
        pidgin:  `💰 Max price: ${parsed.maxPrice.toLocaleString()} FCFA`,
      };
      filters.push(labels[lang]);
    }

    return filters.join('\n');
  }

  // ─── Normalize location name ──────────────────────────────
  // yaounde → Yaoundé, bafoussam → Bafoussam
  private normalizeLocation(loc: string): string {
    const locationMap: Record<string, string> = {
      'yaounde':    'Yaoundé',
      'yaoundé':    'Yaoundé',
      'douala':     'Douala',
      'bafoussam':  'Bafoussam',
      'bamenda':    'Bamenda',
      'garoua':     'Garoua',
      'maroua':     'Maroua',
      'ngaoundere': 'Ngaoundéré',
      'bertoua':    'Bertoua',
      'ebolowa':    'Ebolowa',
      'buea':       'Buea',
      'limbe':      'Limbe',
      'kumba':      'Kumba',
    };
    const key = loc.toLowerCase().replace(/[éèê]/g, 'e');
    return locationMap[key] ?? loc.charAt(0).toUpperCase() + loc.slice(1);
  }

  // ─── Normalize product name to English ───────────────────
  private normalizeProduct(product: string): string {
    const productMap: Record<string, string> = {
      'maïs':     'maize',
      'mais':     'maize',
      'manioc':   'cassava',
      'tomate':   'tomatoes',
      'tomates':  'tomatoes',
      'plantain': 'plantain',
      'igname':   'yam',
      'ignames':  'yam',
      'macabo':   'macabo',
      'gombo':    'okra',
      'haricot':  'beans',
      'haricots': 'beans',
      'arachide': 'groundnuts',
      'arachides':'groundnuts',
      'poulet':   'chicken',
      'poisson':  'fish',
    };
    const lower = product.toLowerCase().trim();
    return productMap[lower] ?? lower;
  }

  // ─── Normalize French commands to English ────────────────
  private normalizeCommand(command: string): string {
    const upper = command.toUpperCase();
    if (upper.startsWith('ACHETER')) return 'buy' + command.slice(7);
    if (upper.startsWith('VENDRE'))  return 'sell' + command.slice(6);
    return command.toLowerCase();
  }
}