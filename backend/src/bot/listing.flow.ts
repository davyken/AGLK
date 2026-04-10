import { Injectable, OnModuleInit } from '@nestjs/common';
import { ListingService } from '../listing/listing.service';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from '../listing/dto';
import { PriceService } from '../price/price.service';
import { MatchingService } from '../listing/matching.service';
import { MetaSenderService } from '../whatsapp/meta-sender.service';
import {
  AiService,
  Language,
  ParsedIntent,
  ClassifiedMessage,
  ConversationState,
} from '../ai/ai.service';
import { FilterParserService } from './filter-parser.service';
import { CropMediaService } from './Crop media.service';
import { normalizePhone } from '../common/format.util';

/** Pending states expire after this many milliseconds (4 hours). */
const PENDING_TTL_MS = 4 * 60 * 60 * 1_000;

interface PendingState {
  type:
    | 'sell'
    | 'sell_waiting_image'
    | 'buy_select'
    | 'awaiting_counter_response'
    | 'buy';
  product: string;
  productDisplay?: string; // original name user typed e.g. "manioc"
  quantity: number;
  unit: string;
  userPhone: string;
  userRole: string;
  language: Language;
  price?: number;
  imageUrl?: string;
  imageMediaId?: string;
  availableAt?: string;
  expiresAt?: number; // epoch ms — discard state after this time
  listings?: Array<{
    id: string;
    userPhone: string;
    farmerName: string;
    location: string;
    quantity: number;
    price: number;
    imageUrl?: string;
    imageMediaId?: string;
  }>;
  // counter-offer fields (buyer awaiting farmer counter)
  farmerPhone?: string;
  counterPrice?: number;
  sellerListingId?: string;
  buyerListingId?: string;
}

interface PendingFarmerResponse {
  buyerPhone: string;
  sellerListingId: string;
  buyerListingId: string;
  product: string;
  quantity: number;
  unit: string;
  price: number;
  language: Language;
  awaitingCounterPrice?: boolean; // true while farmer is entering counter-offer price
  expiresAt?: number;
}

const pendingStates = new Map<string, PendingState>();
const pendingFarmerResponses = new Map<string, PendingFarmerResponse>();

@Injectable()
export class ListingFlowService implements OnModuleInit {
  constructor(
    private readonly listingService: ListingService,
    private readonly usersService: UsersService,
    private readonly priceService: PriceService,
    private readonly matchingService: MatchingService,
    private readonly metaSender: MetaSenderService,
    private readonly aiService: AiService,
    private readonly filterParser: FilterParserService,
    private readonly cropMedia: CropMediaService,
  ) {}

  // ─── Restore in-memory Maps from DB on startup ─────────────
  // This makes the bot resilient to server restarts — pending states
  // that were saved to MongoDB are loaded back into the process Maps.
  async onModuleInit(): Promise<void> {
    const now = Date.now();
    try {
      const users = await this.usersService.findUsersWithPendingData();
      for (const user of users) {
        const ps = (user as any).pendingState;
        if (ps) {
          if (ps.expiresAt && ps.expiresAt < now) {
            // Expired draft — clear it and notify the user proactively
            await this.usersService.clearPendingState(user.phone);
            const lang: Language = (user as any).language ?? 'english';
            const msg = await this.aiService.reply('listing_expired', lang, {
              product: ps.product ?? 'your listing',
            });
            this.metaSender.send(user.phone, msg).catch(() => {});
          } else {
            pendingStates.set(user.phone, ps as PendingState);
          }
        }
        const pfr = (user as any).pendingFarmerResponse;
        if (pfr) {
          if (pfr.expiresAt && pfr.expiresAt < now) {
            await this.usersService.clearPendingFarmerResponse(user.phone);
          } else {
            pendingFarmerResponses.set(
              user.phone,
              pfr as PendingFarmerResponse,
            );
          }
        }
      }
    } catch {
      // Non-fatal: in-memory Maps start empty — users will re-initiate flows
    }
  }

  // ─── Pending state helpers (in-memory + DB) ─────────────────
  private async setPendingState(
    phone: string,
    state: PendingState,
  ): Promise<void> {
    const withTtl: PendingState = {
      ...state,
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    pendingStates.set(phone, withTtl);
    await this.usersService
      .savePendingState(phone, withTtl as any)
      .catch(() => {});
  }

  private async deletePendingState(phone: string): Promise<void> {
    pendingStates.delete(phone);
    await this.usersService.clearPendingState(phone).catch(() => {});
  }

  private async setFarmerResponse(
    phone: string,
    resp: PendingFarmerResponse,
  ): Promise<void> {
    const withTtl: PendingFarmerResponse = {
      ...resp,
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    pendingFarmerResponses.set(phone, withTtl);
    await this.usersService
      .savePendingFarmerResponse(phone, withTtl as any)
      .catch(() => {});
  }

  private async deleteFarmerResponse(phone: string): Promise<void> {
    pendingFarmerResponses.delete(phone);
    await this.usersService.clearPendingFarmerResponse(phone).catch(() => {});
  }

  // ─── Main entry point ─────────────────────────────────────
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    // ── Get user language from DB (default english) ────────
    const user = await this.usersService.findByPhone(phone);
    const lang: Language = (user as any)?.language ?? 'english';

    // ── If there is a pending state → resume it ────────────
    if (pendingStates.has(phone)) {
      return this.handlePendingState(phone, text.trim(), channel, lang);
    }

    // ── Use AI to parse intent from ANY language input ─────
    const parsed = await this.aiService.parseIntent(text);

    // Normalize French/Pidgin commands to structured intent
    if (parsed.intent === 'sell') {
      const unit =
        parsed.unit && parsed.unit !== 'bags'
          ? parsed.unit
          : this.aiService.defaultUnitForProduct(parsed.product ?? '');
      return this.handleSellIntent(
        phone,
        parsed.product ?? '',
        (parsed as any).productOriginal ?? parsed.product ?? '',
        parsed.quantity ?? 0,
        unit,
        channel,
        lang,
        parsed.price,
        text,
        parsed.availableAt,
      );
    }

    if (parsed.intent === 'buy') {
      if (this.filterParser.hasFilters(text)) {
        const filtered = this.filterParser.parse(text);
        if (filtered)
          return this.handleBuyIntentWithFilters(
            phone,
            filtered,
            text,
            channel,
            lang,
          );
      }
      const unit =
        parsed.unit && parsed.unit !== 'bags'
          ? parsed.unit
          : this.aiService.defaultUnitForProduct(parsed.product ?? '');
      return this.handleBuyIntent(
        phone,
        parsed.product ?? '',
        parsed.quantity ?? 0,
        unit,
        channel,
        lang,
      );
    }

    if (parsed.intent === 'price') {
      return this.handlePriceQuery(parsed.product ?? '', lang, channel);
    }

    // ── Fallback: try classic command parsing ──────────────
    const normalized = this.normalizeCommand(text);
    const upper = normalized.toUpperCase();

    if (upper.startsWith('SELL')) {
      const p = this.parseListingCommand(normalized);
      if (p)
        return this.handleSellIntent(
          phone,
          p.product,
          p.product,
          p.quantity,
          p.unit,
          channel,
          lang,
          undefined,
          text,
          undefined,
        );
    }

    if (upper.startsWith('BUY')) {
      // Use filterParser so @location and #price filters work
      const p = this.filterParser.parse(normalized);
      if (p)
        return this.handleBuyIntentWithFilters(phone, p, text, channel, lang);
    }

    if (upper.startsWith('OFFER')) {
      return this.handleOfferCommand(phone, normalized, channel, lang);
    }

    
    return await this.aiService.reply('unknown_command', lang, {});
  }

  /**
   * Entry point used when the caller already has a parsed intent.
   * Skips the second aiService.parseIntent() call to save latency and API cost.
   */
  async handleWithParsed(
    phone: string,
    text: string,
    parsed: ParsedIntent,
    channel: 'sms' | 'whatsapp',
    classified?: ClassifiedMessage,
  ): Promise<string> {
    const user = await this.usersService.findByPhone(phone);
    const lang: Language = (user as any)?.language ?? 'english';

    // Pending state always takes priority
    if (pendingStates.has(phone)) {
      return this.handlePendingState(phone, text.trim(), channel, lang);
    }

    // ── Conversation state merge ──────────────────────────────────
    // Build a ClassifiedMessage from parsed if caller didn't supply one.
    const effectiveClassified: ClassifiedMessage = classified ?? {
      intents: parsed.intents ?? [
        {
          intent: (parsed.intent.toUpperCase() as any),
          product: parsed.product,
          quantity: parsed.quantity,
          unit: parsed.unit,
          location: parsed.location,
          price: parsed.price,
          priceMin: parsed.priceMin,
          priceMax: parsed.priceMax,
          timeframe: parsed.availableAt,
        },
      ],
      language: parsed.language,
      confidence: parsed.confidence,
      name: parsed.name,
      location: parsed.location,
      raw: parsed.raw,
    };

    // Run focused entity extraction when confidence is not high or product is missing,
    // then merge everything into a single ConversationState.
    const needsExtraction =
      (parsed.intent === 'sell' || parsed.intent === 'buy') &&
      (parsed.confidence !== 'high' || !parsed.product);

    let convState: ConversationState;
    if (needsExtraction) {
      try {
        const extracted = await this.aiService.extractEntities(text);
        convState = this.aiService.mergeConversationState(
          null,
          effectiveClassified,
          extracted,
        );
      } catch {
        // extractEntities failed — merge with empty extracted values
        convState = this.aiService.mergeConversationState(null, effectiveClassified, {
          product: null, productNormalized: null, quantity: null, unit: null,
          location: null, price: null, priceMin: null, priceMax: null, timeframe: null,
        });
      }
    } else {
      convState = this.aiService.mergeConversationState(null, effectiveClassified, {
        product: null, productNormalized: null, quantity: null, unit: null,
        location: null, price: null, priceMin: null, priceMax: null, timeframe: null,
      });
    }

    // ── Missing required fields → ask naturally instead of erroring ─
    if (convState.status === 'missing_info') {
      return this.aiService.generateConversationalResponse(convState, text, lang);
    }

    // Resolve final entity values — convState wins over raw parsed where non-null
    const mergedEntities = convState.entities;
    const entities = {
      ...parsed,
      product: mergedEntities.product ?? parsed.product,
      productOriginal: (parsed as any).productOriginal ?? mergedEntities.product ?? parsed.product,
      quantity: mergedEntities.quantity ?? parsed.quantity,
      unit: mergedEntities.unit ?? parsed.unit,
      location: mergedEntities.location ?? parsed.location,
      price: mergedEntities.price ?? parsed.price,
      priceMin: mergedEntities.priceMin ?? parsed.priceMin,
      priceMax: mergedEntities.priceMax ?? parsed.priceMax,
      availableAt: mergedEntities.timeframe ?? parsed.availableAt,
    };

    if (entities.intent === 'sell') {
      const unit =
        entities.unit && entities.unit !== 'bags'
          ? entities.unit
          : this.aiService.defaultUnitForProduct(entities.product ?? '');
      return this.handleSellIntent(
        phone,
        entities.product ?? '',
        (entities as any).productOriginal ?? entities.product ?? '',
        entities.quantity ?? 0,
        unit,
        channel,
        lang,
        entities.price,
        text,
        entities.availableAt,
      );
    }

    if (entities.intent === 'buy') {
      // If buyer provided a price range, acknowledge then search
      if (entities.priceMin && entities.priceMax) {
        const ack = await this.aiService.reply('buy_with_price_range', lang, {
          product: entities.product ?? '',
          quantity: String(entities.quantity ?? 0),
          unit: entities.unit ?? 'bags',
          priceMin: String(entities.priceMin),
          priceMax: String(entities.priceMax),
        });
        this.metaSender.send(phone, ack).catch(() => {});
      }

      if (this.filterParser.hasFilters(text)) {
        const filtered = this.filterParser.parse(text);
        if (filtered)
          return this.handleBuyIntentWithFilters(phone, filtered, text, channel, lang);
      }
      const unit =
        entities.unit && entities.unit !== 'bags'
          ? entities.unit
          : this.aiService.defaultUnitForProduct(entities.product ?? '');
      return this.handleBuyIntent(
        phone,
        entities.product ?? '',
        entities.quantity ?? 0,
        unit,
        channel,
        lang,
      );
    }

    if (parsed.intent === 'price') {
      return this.handlePriceQuery(parsed.product ?? '', lang, channel);
    }

    // Fall back to full handle() for anything else
    return this.handle(phone, text, channel);
  }

  async handleSellIntent(
    phone: string,
    product: string,
    productDisplay: string,
    quantity: number,
    unit: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
    price?: number,
    text?: string,
    availableAt?: string,
  ): Promise<string> {
    // displayName = what user sees (preserves French/Pidgin product names)
    const displayName = productDisplay || product;
    const smartEmoji = this.cropMedia.getEmoji(product);
    const smartUnit = unit || this.aiService.defaultUnitForProduct(product);

    // ── No product → ask naturally what they're selling ───────
    if (!product) {
      const msgs: Record<Language, string> = {
        english: `What are you selling? (e.g. maize, cassava, tomatoes)`,
        french: `Que voulez-vous vendre ? (ex: maïs, manioc, tomates)`,
        pidgin: `Wetin you wan sell? (e.g. maize, cassava, tomatoes)`,
      };
      return msgs[lang];
    }

    // ── Product detected but NO quantity → ask for it naturally ──
    if (!quantity || quantity <= 0) {
      await this.setPendingState(phone, {
        type: 'sell',
        product,
        productDisplay: displayName,
        quantity: 0,
        unit: smartUnit,
        userPhone: phone,
        userRole: 'user',
        language: lang,
        availableAt,
      });
      const msgs: Record<Language, string> = {
        english: `${smartEmoji} Got it — *${this.cap(displayName)}*${availableAt ? ` (ready ${availableAt})` : ''}.\n\nHow many *${smartUnit}* do you have available?`,
        french: `${smartEmoji} Compris — *${this.cap(displayName)}*${availableAt ? ` (prêt ${availableAt})` : ''}.\n\nCombien de *${smartUnit}* avez-vous ?`,
        pidgin: `${smartEmoji} Okay — *${this.cap(displayName)}*${availableAt ? ` (ready ${availableAt})` : ''}.\n\nHow many *${smartUnit}* you get ?`,
      };
      return msgs[lang];
    }

    const user = await this.usersService.findByPhone(phone);

    if (!user || user.conversationState !== 'REGISTERED') {
      const msgs: Record<Language, string> = {
        english: `Say *Hi* to get started — registration only takes a minute! 👋`,
        french: `Dites *Bonjour* pour commencer — l'inscription ne prend qu'une minute ! 👋`,
        pidgin: `Say *Hi* make you register — e quick! 👋`,
      };
      return msgs[lang];
    }

    // If price provided in initial input, skip suggestion and go directly to image
    const effectivePrice = price ?? this.parsePrice(text || '');

    if (effectivePrice && effectivePrice > 0) {
      await this.setPendingState(phone, {
        type: 'sell_waiting_image',
        product,
        productDisplay: displayName,
        quantity,
        unit,
        price: effectivePrice,
        userPhone: phone,
        userRole: 'user',
        language: lang,
      });
      return this.askForImage(lang);
    }

    // Store pending state with language and display name
    await this.setPendingState(phone, {
      type: 'sell',
      product,
      productDisplay: displayName, 
      quantity,
      unit,
      userPhone: phone,
      userRole: 'user',
      language: lang,
    });

    const priceData = await this.priceService.getPrice(product);

    if (!priceData) {
      const msgs: Record<Language, string> = {
        english: `${smartEmoji} *Listing: ${this.cap(displayName)}*

Qty: ${quantity} ${unit}

💰 No market price available.
Please enter your price.

Example: 20000`,
        french: `${smartEmoji} *Annonce: ${this.cap(displayName)}*

Qté: ${quantity} ${unit}

💰 Pas de prix disponible.
Entrez votre prix.

Exemple: 20000`,
        pidgin: `${smartEmoji} *Listing: ${this.cap(displayName)}*

Qty: ${quantity} ${unit}

💰 No price data.
Send your price.

Example: 20000`,
      };
      return msgs[lang];
    }

    return await this.aiService.reply('price_suggestion', lang, {
      product: this.cap(displayName), // show "Manioc" not "Cassava" in French
      min: this.fmt(priceData.low),
      avg: this.fmt(priceData.avg),
      max: this.fmt(priceData.high),
      suggested: this.fmt(priceData.suggested),
    });
  }
  private cap(text: string): string {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  // ─── Buy Intent ───────────────────────────────────────────
  private async handleBuyIntent(
    phone: string,
    product: string,
    quantity: number,
    unit: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    // ── No product → ask naturally ─────────────────────────
    if (!product) {
      const msgs: Record<Language, string> = {
        english: `What are you looking to buy? (e.g. maize, tomatoes, cassava)`,
        french: `Quels produits cherchez-vous ? (ex: maïs, tomates, manioc)`,
        pidgin: `Wetin you dey find? (e.g. maize, tomatoes, cassava)`,
      };
      return msgs[lang];
    }

    const user = await this.usersService.findByPhone(phone);

    if (!user || user.conversationState !== 'REGISTERED') {
      const msgs: Record<Language, string> = {
        english: `Say *Hi* to get started — registration only takes a minute! 👋`,
        french: `Dites *Bonjour* pour commencer — l'inscription ne prend qu'une minute ! 👋`,
        pidgin: `Say *Hi* make you register — e quick! 👋`,
      };
      return msgs[lang];
    }

    // ── No quantity → ask naturally (don't block the search) ──
    // We proceed with quantity=0 and ask after showing results
    const effectiveQty = quantity > 0 ? quantity : 0;
    const smartUnit = unit || this.aiService.defaultUnitForProduct(product);

    // ── Tiered fallback search ─────────────────────────────
    const { tier, listings: sellListings, fallbackProduct } =
      await this.listingService.findWithFallback(
        product,
        user.location ?? '',
        normalizePhone(phone) ?? phone,
      );

    // ── Tier 4: nothing anywhere → save request + guide forward ──
    if (tier === 4 || sellListings.length === 0) {
      const dto: CreateListingDto = {
        type: 'buy',
        product,
        quantity: effectiveQty,
        unit: smartUnit,
        priceType: 'none',
      };
      await this.listingService.createEnriched(dto, {
        phone: user.phone,
        name: user.name,
        location: user.location,
        channel: user.lastChannelUsed,
      });

      const msgs: Record<Language, string> = {
        english: `No farmers are currently selling *${this.cap(product)}* on Agrolink.\n\n✅ Your request is saved — we'll notify you the moment a farmer lists it.`,
        french: `Aucun agriculteur ne vend *${this.cap(product)}* sur Agrolink actuellement.\n\n✅ Votre demande est enregistrée — nous vous notifierons dès qu'un agriculteur le listez.`,
        pidgin: `No farmer dey sell *${this.cap(product)}* on Agrolink now.\n\n✅ We don save your request — we go tell you when farmer list am.`,
      };
      return msgs[lang];
    }

    // ── Tier 2/3: no local results — note the fallback transparently ──
    let fallbackNote = '';
    if (tier === 2) {
      const locationName = user.location && user.location !== 'unknown' ? user.location : null;
      if (locationName) {
        fallbackNote = lang === 'french'
          ? `\n_Aucun vendeur à *${locationName}* — voici les vendeurs disponibles ailleurs:_\n`
          : lang === 'pidgin'
          ? `\n_No seller for *${locationName}* — here na sellers for other places:_\n`
          : `\n_No sellers in *${locationName}* right now — showing available farmers elsewhere:_\n`;
      }
    } else if (tier === 3 && fallbackProduct) {
      fallbackNote = lang === 'french'
        ? `\n_Pas de *${this.cap(product)}* disponible — voici des vendeurs de *${this.cap(fallbackProduct)}* (produit similaire):_\n`
        : lang === 'pidgin'
        ? `\n_No *${this.cap(product)}* dey — here na *${this.cap(fallbackProduct)}* sellers (similar product):_\n`
        : `\n_No *${this.cap(product)}* available — showing *${this.cap(fallbackProduct)}* sellers (similar product):_\n`;
    }

    // ── Listings found → show top 5 ───────────────────────
    const top = sellListings.slice(0, 5);

    await this.setPendingState(phone, {
      type: 'buy_select',
      product,
      quantity,
      unit,
      userPhone: phone,
      userRole: 'user',
      language: lang,
      listings: top.map((l) => ({
        id: l._id.toString(),
        userPhone: l.userPhone,
        farmerName: l.userName,
        location: l.userLocation,
        quantity: l.quantity,
        price: l.price || 0,
        imageUrl: l.imageUrl,
        imageMediaId: l.imageMediaId,
      })),
    });

    // Build listing header — use fallbackProduct name when tier 3
    const displayProduct = tier === 3 && fallbackProduct ? fallbackProduct : product;
    const headers: Record<Language, string> = {
      english: `🔍 *Found ${sellListings.length} farmer(s) with ${this.cap(displayProduct)}*\n\n`,
      french: `🔍 *${sellListings.length} agriculteur(s) avec ${this.cap(displayProduct)}*\n\n`,
      pidgin: `🔍 *${sellListings.length} farmer(s) get ${this.cap(displayProduct)}*\n\n`,
    };

    let message = fallbackNote + headers[lang];

    top.forEach((listing, i) => {
      message += `${i + 1}️⃣ ${listing.userName}\n`;
      message += `   📦 ${listing.quantity} ${listing.unit}\n`;
      message += `   💰 ${this.fmt(listing.price || 0)}\n`;
      message += `   📍 ${listing.userLocation}\n`;
      if (listing.imageUrl || listing.imageMediaId) {
        message += `   📷 Photo available\n`;
      }
      message += `\n`;
    });

    const footers: Record<Language, string> = {
      english: `Reply with number (1-${top.length}) to select.`,
      french: `Répondez avec le numéro (1-${top.length}) pour choisir.`,
      pidgin: `Send number (1-${top.length}) to pick one.`,
    };
    message += footers[lang];

    await this.metaSender.send(phone, message);

    // Send images if any
    for (const listing of top) {
      if (listing.imageMediaId) {
        await this.metaSender.sendImageByMediaId(
          phone,
          listing.imageMediaId,
          listing.product,
        );
      } else if (listing.imageUrl) {
        await this.metaSender.sendImage(
          phone,
          listing.imageUrl,
          listing.product,
        );
      }
    }

    return '';
  }

  // ─── Buy with filters (@location #price) ────────────────
  private async handleBuyIntentWithFilters(
    phone: string,
    parsed: {
      product: string;
      quantity: number;
      unit: string;
      location?: string;
      minPrice?: number;
      maxPrice?: number;
    },
    originalText: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    const user = await this.usersService.findByPhone(phone);

    if (!user || user.conversationState !== 'REGISTERED') {
      const msgs: Record<Language, string> = {
        english: `Say *Hi* to get started — registration only takes a minute! 👋`,
        french: `Dites *Bonjour* pour commencer — l'inscription ne prend qu'une minute ! 👋`,
        pidgin: `Say *Hi* make you register — e quick! 👋`,
      };
      return msgs[lang];
    }

    // ── Fetch listings with filters ────────────────────────
    const allListings = await this.listingService.findByProduct(parsed.product);
    const normalizedQueryPhone = normalizePhone(phone);
    let sellListings = allListings.filter(
      (l) =>
        l.type === 'sell' &&
        l.status === 'active' &&
        normalizePhone(l.userPhone) !== normalizedQueryPhone,
    );

    // Apply location filter
    if (parsed.location) {
      const locLower = parsed.location.toLowerCase();
      sellListings = sellListings.filter((l) =>
        l.userLocation?.toLowerCase().includes(locLower),
      );
    }

    // Apply price filter
    if (parsed.minPrice) {
      sellListings = sellListings.filter(
        (l) => (l.price || 0) >= parsed.minPrice!,
      );
    }
    if (parsed.maxPrice) {
      sellListings = sellListings.filter(
        (l) => (l.price || 0) <= parsed.maxPrice!,
      );
    }

    // ── Build filter summary to show user ─────────────────
    const filterSummary = this.filterParser.buildFilterSummary(parsed, lang);

    // ── No results with filters ───────────────────────────
    if (sellListings.length === 0) {
      const msgs: Record<Language, string> = {
        english: `🔍 No listings for *${this.cap(parsed.product)}* matching your filters:\n${filterSummary}\n\nWant me to search without the location or price filter?`,
        french: `🔍 Aucune annonce pour *${this.cap(parsed.product)}* avec vos filtres:\n${filterSummary}\n\nVoulez-vous que je cherche sans le filtre de lieu ou de prix?`,
        pidgin: `🔍 No listing for *${this.cap(parsed.product)}* with your filter:\n${filterSummary}\n\nYou want make I search without filter?`,
      };
      return msgs[lang];
    }

    // ── Show filtered results ─────────────────────────────
    const top = sellListings.slice(0, 5);

    await this.setPendingState(phone, {
      type: 'buy_select',
      product: parsed.product,
      quantity: parsed.quantity,
      unit: parsed.unit,
      userPhone: phone,
      userRole: 'user',
      language: lang,
      listings: top.map((l) => ({
        id: l._id.toString(),
        userPhone: l.userPhone,
        farmerName: l.userName,
        location: l.userLocation,
        quantity: l.quantity,
        price: l.price || 0,
        imageUrl: l.imageUrl,
        imageMediaId: l.imageMediaId,
      })),
    });

    const headers: Record<Language, string> = {
      english: `🔍 *${sellListings.length} result(s) for ${this.cap(parsed.product)}*
${filterSummary}

`,
      french: `🔍 *${sellListings.length} résultat(s) pour ${this.cap(parsed.product)}*
${filterSummary}

`,
      pidgin: `🔍 *${sellListings.length} result(s) for ${this.cap(parsed.product)}*
${filterSummary}

`,
    };

    let message = headers[lang];

    top.forEach((listing, i) => {
      message += `${i + 1}️⃣ ${listing.userName}
`;
      message += `   📦 ${listing.quantity} ${listing.unit}
`;
      message += `   💰 ${this.fmt(listing.price || 0)}
`;
      message += `   📍 ${listing.userLocation}
`;
      if (listing.imageUrl || listing.imageMediaId)
        message += `   📷 Photo available
`;
      message += `
`;
    });

    const footers: Record<Language, string> = {
      english: `Reply with number (1-${top.length}) to select.`,
      french: `Répondez avec le numéro (1-${top.length}) pour choisir.`,
      pidgin: `Send number (1-${top.length}) to pick one.`,
    };
    message += footers[lang];

    await this.metaSender.send(phone, message);

    for (const listing of top) {
      if (listing.imageMediaId)
        await this.metaSender.sendImageByMediaId(
          phone,
          listing.imageMediaId,
          listing.product,
        );
      else if (listing.imageUrl)
        await this.metaSender.sendImage(
          phone,
          listing.imageUrl,
          listing.product,
        );
    }

    return '';
  }

  // ─── Price Query ──────────────────────────────────────────
  private async handlePriceQuery(
    product: string,
    lang: Language,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    if (!product) {
      const msgs: Record<Language, string> = {
        english: `❓ Which product price do you want?\nExample: price maize`,
        french: `❓ Quel produit vous intéresse?\nExemple: prix maïs`,
        pidgin: `❓ Which product price you want?\nExample: price maize`,
      };
      return msgs[lang];
    }

    const priceData = await this.priceService.getPrice(product);
    if (!priceData) {
      const msgs: Record<Language, string> = {
        english: `I don't have current price data for ${this.cap(product)} yet. Check back soon — we're tracking markets daily.`,
        french: `Je n'ai pas encore de données de prix pour ${this.cap(product)}. Revenez bientôt — nous suivons les marchés quotidiennement.`,
        pidgin: `No price data for ${this.cap(product)} yet. Check back soon — we dey track market every day.`,
      };
      return msgs[lang];
    }

    return await this.aiService.reply('price_suggestion', lang, {
      product: this.cap(product),
      min: this.fmt(priceData.low),
      avg: this.fmt(priceData.avg),
      max: this.fmt(priceData.high),
      suggested: this.fmt(priceData.suggested),
    });
  }

  // ─── Detect natural-language cancellation or intent shift ───
  // Returns 'cancel', 'sell', 'buy', or null.
  private detectCancelOrShift(text: string): 'cancel' | 'sell' | 'buy' | null {
    const lower = text.toLowerCase();

    const cancelSignals = [
      'not interested', 'no longer', 'never mind', 'nevermind',
      'forget it', 'don\'t want', "don't want", 'changed my mind',
      'no thanks', 'no thank you', 'stop', 'quit', 'leave it',
      'plus intéressé', 'laisse tomber', 'plus maintenant',
      'je ne veux plus', 'ça ne m\'intéresse plus',
      'i no wan', 'i don\'t want', 'abeg stop', 'no more',
      'cancel', 'annuler', 'not anymore', 'disregard',
    ];
    if (cancelSignals.some((s) => lower.includes(s))) return 'cancel';

    const sellShift = [
      'want to sell', 'i want to sell', 'actually sell', 'let me sell',
      'je veux vendre', 'i wan sell', 'i dey sell',
    ];
    if (sellShift.some((s) => lower.includes(s))) return 'sell';

    const buyShift = [
      'want to buy', 'i want to buy', 'actually buy', 'let me buy',
      'je veux acheter', 'i wan buy', 'i dey find',
    ];
    if (buyShift.some((s) => lower.includes(s))) return 'buy';

    return null;
  }

  // ─── Handle pending state responses ──────────────────────
  private async handlePendingState(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    const pending = pendingStates.get(phone);
    if (!pending)
      return await this.aiService.reply('unknown_command', lang, {});

    // ── TTL check — discard expired state ───────────────────
    if (pending.expiresAt && pending.expiresAt < Date.now()) {
      await this.deletePendingState(phone);
      const expired: Record<Language, string> = {
        english: `Your previous listing session expired. Do you want to sell something or find something to buy?`,
        french: `Votre session précédente a expiré. Voulez-vous vendre quelque chose ou acheter?`,
        pidgin: `Your last session don expire. You wan sell or you wan buy today?`,
      };
      return expired[lang];
    }

    // Use saved language from pending state
    const savedLang = pending.language ?? lang;

    // ── Natural-language cancel / intent-shift detection ────
    // Intercept before rigid number/keyword routing so that
    // "I'm no longer interested" doesn't get answered with "Pick a number".
    const shift = this.detectCancelOrShift(response);
    if (shift === 'cancel' || response.toUpperCase() === 'CANCEL' || response.toUpperCase() === 'ANNULER') {
      await this.deletePendingState(phone);
      const msgs: Record<Language, string> = {
        english: `No problem 👍 I've stopped that. Let me know if you want to sell something or find produce to buy.`,
        french: `Pas de problème 👍 J'ai arrêté ça. Dites-moi si vous voulez vendre ou acheter quelque chose.`,
        pidgin: `No problem 👍 I don stop am. Tell me if you wan sell or buy something.`,
      };
      return msgs[savedLang];
    }

    if (shift === 'sell' || shift === 'buy') {
      // Clear the old pending state and re-route as a fresh intent
      await this.deletePendingState(phone);
      return this.handle(phone, response, channel);
    }

    if (pending.type === 'sell')
      return this.handleSellPending(
        phone,
        response,
        channel,
        pending,
        savedLang,
      );
    if (pending.type === 'sell_waiting_image')
      return this.handleSellWaitingImage(
        phone,
        response,
        channel,
        pending,
        savedLang,
      );
    if (pending.type === 'buy_select')
      return this.handleBuySelect(phone, response, channel, pending, savedLang);
    if (pending.type === 'awaiting_counter_response')
      return this.handleBuyerCounterResponse(
        phone,
        response,
        pending,
        savedLang,
      );

    return await this.aiService.reply('unknown_command', savedLang, {});
  }

  // ─── Buy pending: waiting for quantity ────────────
  private async handleBuyPending(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    lang: Language,
  ): Promise<string> {
    const input = response.trim().toLowerCase();

    // Extract number from natural language
    const numberMatch = response.match(/\d+/);
    const qty = numberMatch ? parseInt(numberMatch[0], 10) : 0;

    if (!qty || qty <= 0) {
      const unitLabel = pending.unit || this.aiService.defaultUnitForProduct(pending.product);
      const msgs: Record<Language, string> = {
        english: `I need a number here — how many ${unitLabel} of ${this.cap(pending.productDisplay || pending.product)} do you want?`,
        french: `J'ai besoin d'un nombre — combien de ${unitLabel} de ${this.cap(pending.productDisplay || pending.product)} voulez-vous?`,
        pidgin: `Send me number — how many ${unitLabel} of ${this.cap(pending.productDisplay || pending.product)} you want?`,
      };
      return msgs[lang];
    }

    // Update with new quantity and proceed to search listings
    await this.setPendingState(phone, { ...pending, quantity: qty });

    // Now search for listings
    const matchingListings = await this.listingService.findByProduct(pending.product);
    const normalizedQueryPhone = normalizePhone(phone);
    const sellListings = matchingListings.filter(
      (l) =>
        l.type === 'sell' &&
        l.status === 'active' &&
        normalizePhone(l.userPhone) !== normalizedQueryPhone,
    );

    if (sellListings.length === 0) {
      const dto: CreateListingDto = {
        type: 'buy',
        product: pending.product,
        quantity: qty,
        unit: pending.unit,
        priceType: 'none',
      };
      const user = await this.usersService.findByPhone(phone);
      await this.listingService.createEnriched(dto, {
        phone: user?.phone || phone,
        name: user?.name || '',
        location: user?.location || '',
        channel: user?.lastChannelUsed || 'whatsapp',
      });
      await this.deletePendingState(phone);

      const msgs: Record<Language, string> = {
        english: `🔍 No listings for ${this.cap(pending.product)} yet.\n\nYour request (${qty} ${pending.unit}) is saved.\nWe'll notify you when available.`,
        french: `🔍 Aucune annonce pour ${this.cap(pending.product)}.\n\nVotre demande (${qty} ${pending.unit}) est enregistrée.`,
        pidgin: `🔍 No ${this.cap(pending.product)} yet.\n\nWe save your request (${qty} ${pending.unit}).`,
      };
      return msgs[lang];
    }

    const top = sellListings.slice(0, 5);
    await this.setPendingState(phone, {
      type: 'buy_select',
      product: pending.product,
      quantity: qty,
      unit: pending.unit,
      userPhone: phone,
      userRole: pending.userRole,
      language: lang,
      listings: top.map((l) => ({
        id: l._id.toString(),
        userPhone: l.userPhone,
        farmerName: l.userName,
        location: l.userLocation,
        quantity: l.quantity,
        price: l.price || 0,
        imageUrl: l.imageUrl,
        imageMediaId: l.imageMediaId,
      })),
    });

    const headers: Record<Language, string> = {
      english: `🔍 *Found ${sellListings.length} farmer(s) with ${this.cap(pending.product)}*\n\n`,
      french: `🔍 *${sellListings.length} agriculteur(s) avec ${this.cap(pending.product)}*\n\n`,
      pidgin: `🔍 *${sellListings.length} farmer(s) get ${this.cap(pending.product)}*\n\n`,
    };

    let message = headers[lang];

    top.forEach((listing, i) => {
      message += `${i + 1}️⃣ ${listing.userName}\n`;
      message += `   📦 ${listing.quantity} ${listing.unit}\n`;
      message += `   💰 ${this.fmt(listing.price || 0)}\n`;
      message += `   📍 ${listing.userLocation}\n`;
      if (listing.imageUrl || listing.imageMediaId) {
        message += `   📷 Photo available\n`;
      }
      message += `\n`;
    });

    const footers: Record<Language, string> = {
      english: `Reply with number (1-${top.length}) to select.`,
      french: `Répondez avec le numéro (1-${top.length}) pour choisir.`,
      pidgin: `Send number (1-${top.length}) to pick one.`,
    };
    message += footers[lang];

    await this.metaSender.send(phone, message);

    // Send images
    for (const listing of top) {
      if (listing.imageMediaId) {
        await this.metaSender.sendImageByMediaId(phone, listing.imageMediaId, listing.product);
      } else if (listing.imageUrl) {
        await this.metaSender.sendImage(phone, listing.imageUrl, listing.product);
      }
    }

    return '';
  }

  // ─── Sell pending: waiting for quantity OR price ────────────
  private async handleSellPending(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    lang: Language,
  ): Promise<string> {
    const input = response.trim().toLowerCase();

    // ── Quantity was missing → user is now sending it ──────
    if (pending.quantity === 0) {
      // ── Extract number from natural language ──────────────
      // Handles: "20", "I have 20 bags", "j'ai 20 sacs",
      //          "about 20", "20 bags", "around 15 kg"
      const numberMatch = response.match(/\d+/);
      const qty = numberMatch ? parseInt(numberMatch[0], 10) : 0;

      // Also detect if user specified a different unit in their reply
      const unitMatch = response
        .toLowerCase()
        .match(
          /\b(bags?|sacs?|kg|kilogrammes?|tonnes?|crates?|cageots?|régimes?|bunches?|litres?|pieces?|pièces?)\b/,
        );
      if (unitMatch) {
        await this.setPendingState(phone, { ...pending, unit: unitMatch[0] });
      }

      if (!qty || qty <= 0) {
        const unitLabel =
          pending.unit || this.aiService.defaultUnitForProduct(pending.product);
        const msgs: Record<Language, string> = {
          english: `I need a number — how many ${unitLabel} of ${this.cap(pending.product)} do you have?`,
          french: `J'ai besoin d'un nombre — combien de ${unitLabel} de ${this.cap(pending.product)} avez-vous?`,
          pidgin: `Tell me number — how many ${unitLabel} of ${this.cap(pending.product)} you get?`,
        };
        return msgs[lang];
      }

      // Update pending state with the quantity
      await this.setPendingState(phone, { ...pending, quantity: qty });

      // Now fetch price data
      const priceData = await this.priceService.getPrice(pending.product);
      if (!priceData) {
        const msgs: Record<Language, string> = {
          english: `📦 ${qty} bags of ${this.cap(pending.product)} noted.

💰 No market price available.
Please enter your price.

Example: 20000`,
          french: `📦 ${qty} sacs de ${this.cap(pending.product)} noté.

💰 Pas de données de prix.
Entrez votre prix.

Exemple: 20000`,
          pidgin: `📦 ${qty} bags ${this.cap(pending.product)} noted.

💰 No price data.
Send your price.

Example: 20000`,
        };
        return msgs[lang];
      }

      return await this.aiService.reply('price_suggestion', lang, {
        product: this.cap((pending as any).productDisplay ?? pending.product),
        min: this.fmt(priceData.low),
        avg: this.fmt(priceData.avg),
        max: this.fmt(priceData.high),
        suggested: this.fmt(priceData.suggested),
      });
    }

    // Accept suggested price
    if (input === '1') {
      const priceData = await this.priceService.getPrice(pending.product);
      if (!priceData) {
        await this.deletePendingState(phone);
        return lang === 'french'
          ? `Désolé, pas de prix de marché disponible pour ce produit. Quelle est votre prix?`
          : lang === 'pidgin'
          ? `Sorry, no market price dey for this product. Wetin you price?`
          : `Sorry, no market price is available for that product. What price would you like to set?`;
      }
      await this.setPendingState(phone, {
        ...pending,
        type: 'sell_waiting_image',
        price: priceData.suggested,
      });
      return this.askForImage(lang);
    }

    // Custom price selected
    if (input === '2') {
      const msgs: Record<Language, string> = {
        english: `💰 Enter your custom price.\n\nExample: 20000`,
        french: `💰 Entrez votre prix.\n\nExemple: 20000`,
        pidgin: `💰 Send your price.\n\nExample: 20000`,
      };
      return msgs[lang];
    }

    // User typed an actual price number
    const customPrice = this.parsePrice(response);
    if (customPrice !== null) {
      await this.setPendingState(phone, {
        ...pending,
        type: 'sell_waiting_image',
        price: customPrice,
      });
      return this.askForImage(lang);
    }

    // Invalid
    const msgs: Record<Language, string> = {
      english: `Just reply *1* to use the suggested price, or *2* to enter your own.`,
      french: `Répondez *1* pour le prix suggéré ou *2* pour entrer le vôtre.`,
      pidgin: `Send *1* for suggested price or *2* for your own price.`,
    };
    return msgs[lang];
  }

  // ─── Ask user for image ───────────────────────────────────
  private askForImage(lang: Language): string {
    const msgs: Record<Language, string> = {
      english: `📷 Would you like to add a photo?\n\nSend image now or reply SKIP.`,
      french: `📷 Voulez-vous ajouter une photo?\n\nEnvoyez l'image ou tapez SAUTER.`,
      pidgin: `📷 You want add photo?\n\nSend image now or reply SKIP.`,
    };
    return msgs[lang];
  }

  // ─── Sell waiting for image ───────────────────────────────
  private async handleSellWaitingImage(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    lang: Language,
  ): Promise<string> {
    const input = response.trim().toUpperCase();
    if (input === 'SKIP' || input === 'SAUTER') {
      return this.createListingWithImage(
        phone,
        channel,
        pending,
        null,
        null,
        lang,
      );
    }
    return this.askForImage(lang);
  }

  // ─── Create listing (final step) ─────────────────────────
  async createListingWithImage(
    phone: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    imageUrl: string | null,
    imageMediaId: string | null,
    lang?: Language,
  ): Promise<string> {
    const savedLang = lang ?? pending.language ?? 'english';
    try {
      const priceData = await this.priceService.getPrice(pending.product);
      const user = await this.usersService.findByPhone(phone);

      const dto: CreateListingDto = {
        type: 'sell',
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        marketAvgPrice: priceData?.avg,
        marketMinPrice: priceData?.low,
        marketMaxPrice: priceData?.high,
        price: pending.price,
        priceType: pending.price ? 'manual' : 'auto',
        imageUrl: imageUrl || undefined,
        imageMediaId: imageMediaId || undefined,
      };

      const listing = await this.listingService.createEnriched(dto, {
        phone,
        name: user?.name || '',
        location: user?.location || '',
        channel: user?.lastChannelUsed || 'whatsapp',
      });

      await this.deletePendingState(phone);

      // ── Get correct emoji + real crop image ──────────────
      const { emoji, imageUrl: cropImageUrl } = await this.cropMedia.getMedia(
        listing.product,
      );

      // Build confirmation message with correct emoji
      const productDisplay = (pending as any).productDisplay ?? listing.product;
      const confirmMsg = this.cropMedia.buildListingConfirmedMessage(
        listing.product,
        productDisplay,
        listing.quantity,
        listing.unit,
        this.fmt(listing.price),
        savedLang,
        emoji,
      );

      // If no farmer image was uploaded AND we got a crop image → send it
      if (
        !imageUrl &&
        !imageMediaId &&
        cropImageUrl &&
        channel === 'whatsapp'
      ) {
        await this.metaSender.send(phone, confirmMsg);
        await this.metaSender.sendImage(
          phone,
          cropImageUrl,
          `${emoji} ${productDisplay}`,
        );
        return '';
      }

      return confirmMsg;
    } catch {
      await this.deletePendingState(phone);
      const msgs: Record<Language, string> = {
        english: `Something went wrong saving your listing. Could you try again?`,
        french: `Une erreur est survenue lors de la sauvegarde. Pouvez-vous réessayer?`,
        pidgin: `Something no go well when saving. You fit try again?`,
      };
      return msgs[savedLang];
    }
  }

  // ─── Buy select: user picks a farmer ─────────────────────
  private async handleBuySelect(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    lang: Language,
  ): Promise<string> {
    const selection = parseInt(response.trim(), 10);
    const count = pending.listings?.length || 0;

    if (isNaN(selection) || selection < 1 || selection > count) {
      // If the response looks like a question or statement, acknowledge it
      // rather than blindly repeating the prompt.
      const lower = response.toLowerCase().trim();
      const isQuestion = lower.endsWith('?') || lower.startsWith('what') ||
        lower.startsWith('who') || lower.startsWith('how') ||
        lower.startsWith('pourquoi') || lower.startsWith('comment') ||
        lower.startsWith('wetin') || lower.startsWith('how much');

      if (isQuestion) {
        const msgs: Record<Language, string> = {
          english: `Happy to help! Each farmer listed above has their price and location. Just send the number (1–${count}) of the one you'd like to contact.`,
          french: `Avec plaisir ! Chaque agriculteur ci-dessus a son prix et sa localisation. Envoyez le numéro (1–${count}) de celui que vous souhaitez contacter.`,
          pidgin: `No wahala! Each farmer up there get price and location. Send number (1–${count}) of di one you want.`,
        };
        return msgs[lang];
      }

      // Non-numeric, non-question input — gentle re-prompt
      const msgs: Record<Language, string> = {
        english: `Just send the number of the farmer you want — for example, *1* for the first one listed.`,
        french: `Envoyez simplement le numéro de l'agriculteur que vous voulez — par exemple *1* pour le premier.`,
        pidgin: `Just send di number of di farmer you want — like *1* for di first one.`,
      };
      return msgs[lang];
    }

    const selected = pending.listings![selection - 1];

    try {
      const buyerUser = await this.usersService.findByPhone(phone);
      const dto: CreateListingDto = {
        type: 'buy',
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        price: selected.price,
        priceType: 'manual',
      };
      const buyerListing = await this.listingService.createEnriched(dto, {
        phone,
        name: buyerUser?.name || '',
        location: buyerUser?.location || '',
        channel: buyerUser?.lastChannelUsed || 'whatsapp',
      });

      await this.deletePendingState(phone);

      // Notify farmer in THEIR language
      const farmerUser = await this.usersService.findByPhone(
        selected.userPhone,
      );
      const farmerLang: Language = (farmerUser as any)?.language ?? 'english';

      if (farmerUser?.phone) {
        await this.setFarmerResponse(farmerUser.phone, {
          buyerPhone: phone,
          sellerListingId: selected.id,
          buyerListingId: buyerListing._id.toString(),
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          price: selected.price,
          language: farmerLang,
        });

        // Notify farmer with counter-offer option
        const matchMsg = await this.aiService.reply(
          'match_found_farmer_counter',
          farmerLang,
          {
            buyerName: buyerUser?.name || '',
            location: buyerUser?.location || '',
            product: pending.product,
            quantity: pending.quantity,
            unit: pending.unit,
            price: this.fmt(selected.price),
          },
        );
        await this.metaSender.send(farmerUser.phone, matchMsg);
      }

      const msgs: Record<Language, string> = {
        english: `🤝 Request sent to ${selected.farmerName}!\n\n📦 ${selected.quantity} ${pending.unit}\n💰 ${this.fmt(selected.price)}\n📍 ${selected.location}\n\nWe'll notify you when they respond.`,
        french: `🤝 Demande envoyée à ${selected.farmerName}!\n\n📦 ${selected.quantity} ${pending.unit}\n💰 ${this.fmt(selected.price)}\n📍 ${selected.location}\n\nNous vous notifierons quand ils répondront.`,
        pidgin: `🤝 We don send request to ${selected.farmerName}!\n\n📦 ${selected.quantity} ${pending.unit}\n💰 ${this.fmt(selected.price)}\n📍 ${selected.location}\n\nWe go tell you when dem reply.`,
      };
      return msgs[lang];
    } catch {
      await this.deletePendingState(phone);
      return await this.aiService.reply('unknown_command', lang, {});
    }
  }

  // ─── Farmer YES/NO/Counter response ──────────────────────
  async handleFarmerResponse(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const user = await this.usersService.findByPhone(phone);
    const lang: Language = (user as any)?.language ?? 'english';
    const pending = pendingFarmerResponses.get(phone);

    if (!pending) {
      const msgs: Record<Language, string> = {
        english: `You don't have any pending requests at the moment. Would you like to sell something or find produce to buy?`,
        french: `Vous n'avez pas de demandes en attente. Voulez-vous vendre ou acheter?`,
        pidgin: `No pending request for you. You wan sell or buy something?`,
      };
      return msgs[lang];
    }

    // ── TTL check ────────────────────────────────────────────
    if (pending.expiresAt && pending.expiresAt < Date.now()) {
      await this.deleteFarmerResponse(phone);
      const expired: Record<Language, string> = {
        english: `This buyer request has expired. Would you like to sell something or find produce to buy?`,
        french: `Cette demande a expiré. Voulez-vous vendre ou acheter quelque chose?`,
        pidgin: `Dis buyer request don expire. You wan sell or buy something?`,
      };
      return expired[lang];
    }

    // ── Farmer is typing their counter-offer price ────────────
    if (pending.awaitingCounterPrice) {
      return this.handleFarmerCounterPrice(phone, response, pending, lang);
    }

    // ── Natural-language cancel / disinterest ─────────────────
    const shift = this.detectCancelOrShift(response);
    if (shift === 'cancel') {
      await this.deleteFarmerResponse(phone);
      const msgs: Record<Language, string> = {
        english: `No problem 👍 I've dropped that request. Let me know whenever you're ready to continue.`,
        french: `Pas de problème 👍 J'ai annulé cette demande. Faites-moi signe quand vous serez prêt.`,
        pidgin: `No problem 👍 I don cancel am. Tell me when you ready.`,
      };
      return msgs[lang];
    }

    const input = response.trim().toUpperCase();

    // ── Farmer chose option 2 → counter-offer ─────────────────
    if (input === '2') {
      await this.setFarmerResponse(phone, {
        ...pending,
        awaitingCounterPrice: true,
      });
      const ask: Record<Language, string> = {
        english: `💰 What price do you want to offer? (Enter a number)\n\nExample: 17000`,
        french: `💰 Quel prix voulez-vous proposer? (Entrez un nombre)\n\nExemple: 17000`,
        pidgin: `💰 Wetin price you wan offer? (Send number)\n\nExample: 17000`,
      };
      return ask[lang];
    }

    // ── Farmer chose option 3 → decline ───────────────────────
    if (
      input === '3' ||
      input === 'NO' ||
      input === 'NON' ||
      input === 'NO BE DAT'
    ) {
      return this.processFarmerDecline(phone, pending, user, lang);
    }

    // ── Farmer chose option 1 or YES → accept ────────────────
    const buyer = await this.usersService.findByPhone(pending.buyerPhone);
    const buyerLang: Language = (buyer as any)?.language ?? 'english';
    await this.deleteFarmerResponse(phone);

    // Use AI to detect YES regardless of language (for natural "yes" replies)
    const parsed = await this.aiService.parseIntent(response);
    const accepted = input === '1' || parsed.intent === 'yes';

    if (accepted) {
      await this.listingService.update(pending.sellerListingId, {
        status: 'matched',
      });
      await this.listingService.update(pending.buyerListingId, {
        status: 'matched',
      });
      // Notify buyer with wa.me link in THEIR language
      if (buyer?.phone) {
        const connectedMsgBuyer = await this.aiService.reply(
          'connected',
          buyerLang,
          {
            link: `https://wa.me/${phone}`,
            product: pending.product,
            quantity: pending.quantity,
            unit: pending.unit,
            price: this.fmt(pending.price),
          },
        );
        await this.metaSender.send(buyer.phone, connectedMsgBuyer);
      }

      return await this.aiService.reply('connected', lang, {
        link: `https://wa.me/${pending.buyerPhone}`,
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        price: this.fmt(pending.price),
      });
    }

    // Farmer said NO (fallback for natural language rejections)
    return this.processFarmerDecline(phone, pending, user, lang);
  }

  // ─── Farmer enters their counter-offer price ──────────────
  private async handleFarmerCounterPrice(
    phone: string,
    response: string,
    pending: PendingFarmerResponse,
    lang: Language,
  ): Promise<string> {
    const counterPrice = this.parsePrice(response);

    if (!counterPrice || counterPrice <= 0) {
      const ask: Record<Language, string> = {
        english: `Please enter a valid price (number only).\n\nExample: 17000`,
        french: `Entrez un prix valide (chiffres seulement).\n\nExemple: 17000`,
        pidgin: `Send correct price (number only).\n\nExample: 17000`,
      };
      return ask[lang];
    }

    // Clear farmer's pending response — counter sent
    await this.deleteFarmerResponse(phone);

    const buyer = await this.usersService.findByPhone(pending.buyerPhone);
    const buyerLang: Language = (buyer as any)?.language ?? 'english';
    const farmerUser = await this.usersService.findByPhone(phone);

    // Store counter-offer state on buyer side
    if (buyer?.phone) {
      await this.setPendingState(buyer.phone, {
        type: 'awaiting_counter_response',
        product: pending.product,
        productDisplay: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        price: pending.price,
        counterPrice,
        farmerPhone: phone,
        sellerListingId: pending.sellerListingId,
        buyerListingId: pending.buyerListingId,
        userPhone: buyer.phone,
        userRole: 'user',
        language: buyerLang,
      });

      const counterMsg = await this.aiService.reply(
        'counter_offer_received_buyer',
        buyerLang,
        {
          farmerName: farmerUser?.name || '',
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          originalPrice: this.fmt(pending.price),
          counterPrice: this.fmt(counterPrice),
        },
      );
      await this.metaSender.send(buyer.phone, counterMsg);
    }

    const sent: Record<Language, string> = {
      english: `✅ Counter-offer of ${this.fmt(counterPrice)} sent to the buyer.\n\nWaiting for their response...`,
      french: `✅ Contre-offre de ${this.fmt(counterPrice)} envoyée à l'acheteur.\n\nEn attente de sa réponse...`,
      pidgin: `✅ Counter-offer of ${this.fmt(counterPrice)} don go to buyer.\n\nWe dey wait dem reply...`,
    };
    return sent[lang];
  }

  // ─── Buyer responds to counter-offer (YES/NO) ─────────────
  // Called from handlePendingState when type === 'awaiting_counter_response'
  private async handleBuyerCounterResponse(
    phone: string,
    response: string,
    pending: PendingState,
    lang: Language,
  ): Promise<string> {
    const parsed = await this.aiService.parseIntent(response);
    const upper = response.trim().toUpperCase();
    const accepted =
      parsed.intent === 'yes' ||
      upper === '1' ||
      upper === 'YES' ||
      upper === 'OUI';
    const declined =
      parsed.intent === 'no' ||
      upper === '2' ||
      upper === 'NO' ||
      upper === 'NON';

    if (!accepted && !declined) {
      const ask: Record<Language, string> = {
        english: `Do you accept the counter-offer of ${this.fmt(pending.counterPrice!)}?\n\n1️⃣ Accept  2️⃣ Decline`,
        french: `Acceptez-vous la contre-offre de ${this.fmt(pending.counterPrice!)} ?\n\n1️⃣ Accepter  2️⃣ Refuser`,
        pidgin: `You go accept counter-offer of ${this.fmt(pending.counterPrice!)}?\n\n1️⃣ Accept  2️⃣ No`,
      };
      return ask[lang];
    }

    await this.deletePendingState(phone);

    const farmer = await this.usersService.findByPhone(pending.farmerPhone!);
    const farmerLang: Language = (farmer as any)?.language ?? 'english';
    const buyerUser = await this.usersService.findByPhone(phone);

    if (accepted) {
      const agreedPrice = pending.counterPrice!;

      // Notify farmer — deal done
      if (farmer?.phone) {
        const farmerMsg = await this.aiService.reply('connected', farmerLang, {
          link: `https://wa.me/${phone}`,
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          price: this.fmt(agreedPrice),
        });
        await this.metaSender.send(farmer.phone, farmerMsg);
      }

      return await this.aiService.reply('connected', lang, {
        link: `https://wa.me/${pending.farmerPhone!}`,
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        price: this.fmt(agreedPrice),
      });
    }

    // Buyer declined counter-offer
    if (farmer?.phone) {
      const declinedMsgs: Record<Language, string> = {
        english: `😔 The buyer declined your counter-offer for ${pending.product}. Would you like to try a different price next time?`,
        french: `😔 L'acheteur a refusé votre contre-offre pour ${pending.product}. Voulez-vous essayer un autre prix?`,
        pidgin: `😔 Buyer no accept your counter for ${pending.product}. You want try different price?`,
      };
      await this.metaSender.send(farmer.phone, declinedMsgs[farmerLang]);
    }

    const declined_msgs: Record<Language, string> = {
      english: `No problem — counter-offer declined. The farmer has been notified. Would you like to look for another farmer?`,
      french: `Très bien — contre-offre refusée. L'agriculteur a été notifié. Voulez-vous chercher un autre agriculteur?`,
      pidgin: `Okay — you don decline counter. Farmer don hear. You want find another farmer?`,
    };
    return declined_msgs[lang];
  }

  // ─── Helper: process farmer declining a buy request ───────
  private async processFarmerDecline(
    phone: string,
    pending: PendingFarmerResponse,
    user: any,
    lang: Language,
  ): Promise<string> {
    await this.deleteFarmerResponse(phone);
    const buyer = await this.usersService.findByPhone(pending.buyerPhone);
    const buyerLang: Language = (buyer as any)?.language ?? 'english';

    if (buyer?.phone) {
      const rejMsgs: Record<Language, string> = {
        english: `😔 ${user?.name || 'The farmer'} couldn't fulfill your request for ${pending.product}. Would you like to look for another farmer?`,
        french: `😔 ${user?.name || "L'agriculteur"} n'a pas pu répondre à votre demande de ${pending.product}. Voulez-vous chercher un autre agriculteur?`,
        pidgin: `😔 ${user?.name || 'Farmer'} no fit do your ${pending.product} request. You want find another farmer?`,
      };
      await this.metaSender.send(buyer.phone, rejMsgs[buyerLang]);
    }

    const declinedMsgs: Record<Language, string> = {
      english: `Okay, declined. The buyer has been notified.`,
      french: `D'accord, refusé. L'acheteur a été notifié.`,
      pidgin: `Okay, you don decline. Buyer don hear.`,
    };
    return declinedMsgs[lang];
  }

  // ─── Offer command ────────────────────────────────────────
  private async handleOfferCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    const parts = command.trim().split(/\s+/);
    const offerAmount = this.parsePrice(parts[1]);
    const listingId = parts[2];

    if (!offerAmount || !listingId) {
      const msgs: Record<Language, string> = {
        english: `I need both a price and a listing ID to place an offer. Could you share those details?`,
        french: `J'ai besoin d'un prix et d'un ID d'annonce pour faire une offre. Pouvez-vous partager ces détails?`,
        pidgin: `I need price and listing ID to send offer. You fit share those?`,
      };
      return msgs[lang];
    }

    const targetListing = await this.listingService.findOne(listingId);
    if (
      !targetListing ||
      targetListing.type !== 'sell' ||
      targetListing.status !== 'active'
    ) {
      const msgs: Record<Language, string> = {
        english: `That listing isn't available anymore. Would you like to search for other farmers?`,
        french: `Cette annonce n'est plus disponible. Voulez-vous chercher d'autres agriculteurs?`,
        pidgin: `Dat listing no dey again. You want find other farmers?`,
      };
      return msgs[lang];
    }

    const buyer = await this.usersService.findByPhone(phone);
    if (!buyer || buyer.conversationState !== 'REGISTERED') {
      const msgs: Record<Language, string> = {
        english: `Say *Hi* to get started — registration only takes a minute! 👋`,
        french: `Dites *Bonjour* pour commencer — l'inscription ne prend qu'une minute ! 👋`,
        pidgin: `Say *Hi* make you register — e quick! 👋`,
      };
      return msgs[lang];
    }

    const msgs: Record<Language, string> = {
      english: `💰 Offer of ${this.fmt(offerAmount)} sent for ${targetListing.product}!\n\nFarmer will respond shortly.`,
      french: `💰 Offre de ${this.fmt(offerAmount)} envoyée pour ${targetListing.product}!\n\nL'agriculteur répondra bientôt.`,
      pidgin: `💰 Offer of ${this.fmt(offerAmount)} don go for ${targetListing.product}!\n\nFarmer go reply soon.`,
    };
    return msgs[lang];
  }

  // ─── Helpers ──────────────────────────────────────────────
  isInPendingState(phone: string): boolean {
    return pendingStates.has(phone);
  }
  isInPriceState(phone: string): boolean {
    return pendingStates.has(phone);
  } // alias used by BotService
  isInImageState(phone: string): boolean {
    return pendingStates.get(phone)?.type === 'sell_waiting_image';
  }
  hasPendingFarmerResponse(phone: string): boolean {
    return pendingFarmerResponses.has(phone);
  }

  async handleImage(
    phone: string,
    imageUrl: string | null,
    imageMediaId: string | null,
  ): Promise<string> {
    const pending = pendingStates.get(phone);
    const lang: Language = pending?.language ?? 'english';
    if (!pending || pending.type !== 'sell_waiting_image') {
      return lang === 'french'
        ? `Vous n'avez pas d'annonce en cours. Voulez-vous vendre quelque chose?`
        : `You don't have an active listing in progress. Would you like to sell something?`;
    }
    return this.createListingWithImage(
      phone,
      'whatsapp',
      pending,
      imageUrl,
      imageMediaId,
      lang,
    );
  }

  private normalizeCommand(text: string): string {
    const upper = text.trim().toUpperCase();
    if (upper.startsWith('VENDRE')) return 'SELL' + text.trim().slice(6);
    if (upper.startsWith('ACHETER')) return 'BUY' + text.trim().slice(7);
    if (upper.startsWith('OFFRE')) return 'OFFER' + text.trim().slice(5);
    if (upper === 'OUI') return 'YES';
    if (upper === 'NON') return 'NO';
    if (upper === 'AIDE') return 'HELP';
    if (upper === 'SAUTER') return 'SKIP';
    return text.trim();
  }

  private parseListingCommand(command: string) {
    const parts = command.trim().toLowerCase().split(/\s+/);
    if (parts.length < 3) return null;
    const type = parts[0] as 'sell' | 'buy';
    if (type !== 'sell' && type !== 'buy') return null;

    let qtyIndex = -1;
    for (let i = parts.length - 1; i >= 2; i--) {
      if (/^\d+$/.test(parts[i])) {
        qtyIndex = i;
        break;
      }
    }
    if (qtyIndex === -1) return null;

    const product = parts.slice(1, qtyIndex).join(' ');
    const quantity = parseInt(parts[qtyIndex], 10);
    const unit = parts[qtyIndex + 1] || 'bags';

    if (!product || quantity <= 0) return null;
    return { type, product, quantity, unit };
  }

  private parsePrice(text: string): number | null {
    const cleaned = text?.replace(/[,\s]/g, '') ?? '';
    const price = parseInt(cleaned, 10);
    return isNaN(price) || price <= 0 ? null : price;
  }

  private fmt(price: number): string {
    return price?.toLocaleString() + ' FCFA';
  }
}
