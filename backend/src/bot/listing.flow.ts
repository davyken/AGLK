import { Injectable } from '@nestjs/common';
import { ListingService } from '../listing/listing.service';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from '../listing/dto';
import { PriceService } from '../price/price.service';
import { MatchingService } from '../listing/matching.service';
import { MetaSenderService } from '../whatsapp/meta-sender.service';
import { AiService, Language } from '../ai/ai.service';

// ─── In-memory state (persists across messages in same session) ───
interface PendingState {
  type: 'sell' | 'sell_waiting_image' | 'buy_select';
  product: string;
  quantity: number;
  unit: string;
  userPhone: string;
  userRole: string;
  language: Language;   // ← added: remember language per user
  price?: number;
  imageUrl?: string;
  imageMediaId?: string;
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
}

interface PendingFarmerResponse {
  buyerPhone: string;
  sellerListingId: string;
  buyerListingId: string;
  product: string;
  quantity: number;
  unit: string;
  price: number;
  language: Language;  // ← added
}

const pendingStates          = new Map<string, PendingState>();
const pendingFarmerResponses = new Map<string, PendingFarmerResponse>();

@Injectable()
export class ListingFlowService {
  constructor(
    private readonly listingService: ListingService,
    private readonly usersService: UsersService,
    private readonly priceService: PriceService,
    private readonly matchingService: MatchingService,
    private readonly metaSender: MetaSenderService,
    private readonly aiService: AiService,           // ← injected
  ) {}

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
      return this.handleSellIntent(phone, parsed.product ?? '', parsed.quantity ?? 0, parsed.unit ?? 'bags', channel, lang);
    }

    if (parsed.intent === 'buy') {
      return this.handleBuyIntent(phone, parsed.product ?? '', parsed.quantity ?? 0, parsed.unit ?? 'bags', channel, lang);
    }

    if (parsed.intent === 'price') {
      return this.handlePriceQuery(parsed.product ?? '', lang, channel);
    }

    // ── Fallback: try classic command parsing ──────────────
    const normalized = this.normalizeCommand(text);
    const upper = normalized.toUpperCase();

    if (upper.startsWith('SELL')) {
      const p = this.parseListingCommand(normalized);
      if (p) return this.handleSellIntent(phone, p.product, p.quantity, p.unit, channel, lang);
    }

    if (upper.startsWith('BUY')) {
      const p = this.parseListingCommand(normalized);
      if (p) return this.handleBuyIntent(phone, p.product, p.quantity, p.unit, channel, lang);
    }

    if (upper.startsWith('OFFER')) {
      return this.handleOfferCommand(phone, normalized, channel, lang);
    }

    // ── Unknown command ────────────────────────────────────
    return this.aiService.reply('unknown_command', lang, {});
  }

  // ─── Sell Intent ──────────────────────────────────────────
  private async handleSellIntent(
    phone: string,
    product: string,
    quantity: number,
    unit: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    if (!product || quantity <= 0) {
      const errors: Record<Language, string> = {
        english: `❌ Invalid format.\n\nUse: SELL maize 10 bags`,
        french:  `❌ Format invalide.\n\nUtilisez: VENDRE maïs 10 sacs`,
        pidgin:  `❌ No correct.\n\nTry: SELL maize 10 bags`,
      };
      return errors[lang];
    }

    const user = await this.usersService.findByPhone(phone);

    if (!user || user.conversationState !== 'REGISTERED') {
      const msgs: Record<Language, string> = {
        english: `❌ Register first. Reply Hi to start.`,
        french:  `❌ Enregistrez-vous d'abord. Répondez Bonjour pour commencer.`,
        pidgin:  `❌ You must register first. Reply Hi.`,
      };
      return msgs[lang];
    }

    if (user.role !== 'farmer') {
      const msgs: Record<Language, string> = {
        english: `❌ Only farmers can sell.`,
        french:  `❌ Seuls les agriculteurs peuvent vendre.`,
        pidgin:  `❌ Only farmer fit sell.`,
      };
      return msgs[lang];
    }

    // Store pending state with language
    pendingStates.set(phone, {
      type: 'sell',
      product,
      quantity,
      unit,
      userPhone: phone,
      userRole: user.role,
      language: lang,
    });

    const priceData = await this.priceService.getPrice(product);

    if (!priceData) {
      const msgs: Record<Language, string> = {
        english: `📦 *Listing: ${this.cap(product)}*\n\nQty: ${quantity} ${unit}\n\n💰 No market price available.\nPlease enter your price.\n\nExample: 20000`,
        french:  `📦 *Annonce: ${this.cap(product)}*\n\nQté: ${quantity} ${unit}\n\n💰 Pas de prix disponible.\nEntrez votre prix.\n\nExemple: 20000`,
        pidgin:  `📦 *Listing: ${this.cap(product)}*\n\nQty: ${quantity} ${unit}\n\n💰 No price data.\nSend your price.\n\nExample: 20000`,
      };
      return msgs[lang];
    }

    return this.aiService.reply('price_suggestion', lang, {
      product:   this.cap(product),
      min:       this.fmt(priceData.low),
      avg:       this.fmt(priceData.avg),
      max:       this.fmt(priceData.high),
      suggested: this.fmt(priceData.suggested),
    });
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
    if (!product || quantity <= 0) {
      const errors: Record<Language, string> = {
        english: `❌ Invalid format.\n\nUse: BUY maize 20 bags`,
        french:  `❌ Format invalide.\n\nUtilisez: ACHETER maïs 20 sacs`,
        pidgin:  `❌ No correct.\n\nTry: BUY maize 20 bags`,
      };
      return errors[lang];
    }

    const user = await this.usersService.findByPhone(phone);

    if (!user || user.conversationState !== 'REGISTERED') {
      const msgs: Record<Language, string> = {
        english: `❌ Register first. Reply Hi to start.`,
        french:  `❌ Enregistrez-vous d'abord.`,
        pidgin:  `❌ Register first. Reply Hi.`,
      };
      return msgs[lang];
    }

    if (user.role !== 'buyer') {
      const msgs: Record<Language, string> = {
        english: `❌ Only buyers can buy.`,
        french:  `❌ Seuls les acheteurs peuvent acheter.`,
        pidgin:  `❌ Only buyer fit buy.`,
      };
      return msgs[lang];
    }

    const matchingListings = await this.listingService.findByProduct(product);
    const sellListings = matchingListings.filter(
      (l) => l.type === 'sell' && l.status === 'active',
    );

    // No listings found → save buy request
    if (sellListings.length === 0) {
      const dto: CreateListingDto = {
        type: 'buy',
        product,
        quantity,
        unit,
        priceType: 'none',
      };
      await this.listingService.createEnriched(dto, {
        phone: user.phone,
        name: user.name,
        location: user.location,
        channel: user.lastChannelUsed,
      });

      const msgs: Record<Language, string> = {
        english: `🔍 No listings for ${this.cap(product)} yet.\n\nYour request is saved.\nWe'll notify you when a farmer lists this product.`,
        french:  `🔍 Aucune annonce pour ${this.cap(product)}.\n\nVotre demande est enregistrée.\nNous vous notifierons quand un agriculteur listera ce produit.`,
        pidgin:  `🔍 No farmer get ${this.cap(product)} now.\n\nWe don save your request.\nWe go tell you when farmer list am.`,
      };
      return msgs[lang];
    }

    // Listings found → show top 5
    const top = sellListings.slice(0, 5);

    pendingStates.set(phone, {
      type: 'buy_select',
      product,
      quantity,
      unit,
      userPhone: phone,
      userRole: user.role,
      language: lang,
      listings: top.map((l) => ({
        id:           l._id.toString(),
        userPhone:    l.userPhone,
        farmerName:   l.userName,
        location:     l.userLocation,
        quantity:     l.quantity,
        price:        l.price || 0,
        imageUrl:     l.imageUrl,
        imageMediaId: l.imageMediaId,
      })),
    });

    // Build listing header
    const headers: Record<Language, string> = {
      english: `🔍 *Found ${sellListings.length} farmer(s) with ${this.cap(product)}*\n\n`,
      french:  `🔍 *${sellListings.length} agriculteur(s) avec ${this.cap(product)}*\n\n`,
      pidgin:  `🔍 *${sellListings.length} farmer(s) get ${this.cap(product)}*\n\n`,
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
      french:  `Répondez avec le numéro (1-${top.length}) pour choisir.`,
      pidgin:  `Send number (1-${top.length}) to pick one.`,
    };
    message += footers[lang];

    await this.metaSender.send(phone, message);

    // Send images if any
    for (const listing of top) {
      if (listing.imageMediaId) {
        await this.metaSender.sendImageByMediaId(phone, listing.imageMediaId, listing.product);
      } else if (listing.imageUrl) {
        await this.metaSender.sendImage(phone, listing.imageUrl, listing.product);
      }
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
        french:  `❓ Quel produit vous intéresse?\nExemple: prix maïs`,
        pidgin:  `❓ Which product price you want?\nExample: price maize`,
      };
      return msgs[lang];
    }

    const priceData = await this.priceService.getPrice(product);
    if (!priceData) {
      const msgs: Record<Language, string> = {
        english: `❌ No price data for ${this.cap(product)}.`,
        french:  `❌ Pas de données de prix pour ${this.cap(product)}.`,
        pidgin:  `❌ No price data for ${this.cap(product)}.`,
      };
      return msgs[lang];
    }

    return this.aiService.reply('price_suggestion', lang, {
      product:   this.cap(product),
      min:       this.fmt(priceData.low),
      avg:       this.fmt(priceData.avg),
      max:       this.fmt(priceData.high),
      suggested: this.fmt(priceData.suggested),
    });
  }

  // ─── Handle pending state responses ──────────────────────
  private async handlePendingState(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    const pending = pendingStates.get(phone);
    if (!pending) return this.aiService.reply('unknown_command', lang, {});

    // Use saved language from pending state
    const savedLang = pending.language ?? lang;

    if (response.toUpperCase() === 'CANCEL' || response.toUpperCase() === 'ANNULER') {
      pendingStates.delete(phone);
      const msgs: Record<Language, string> = {
        english: `❌ Cancelled. Type HELP for options.`,
        french:  `❌ Annulé. Tapez AIDE pour les options.`,
        pidgin:  `❌ Cancelled. Type HELP for options.`,
      };
      return msgs[savedLang];
    }

    if (pending.type === 'sell')              return this.handleSellPending(phone, response, channel, pending, savedLang);
    if (pending.type === 'sell_waiting_image') return this.handleSellWaitingImage(phone, response, channel, pending, savedLang);
    if (pending.type === 'buy_select')        return this.handleBuySelect(phone, response, channel, pending, savedLang);

    return this.aiService.reply('unknown_command', savedLang, {});
  }

  // ─── Sell pending: waiting for price choice ───────────────
  private async handleSellPending(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    lang: Language,
  ): Promise<string> {
    const input = response.trim().toLowerCase();

    // Accept suggested price
    if (input === '1') {
      const priceData = await this.priceService.getPrice(pending.product);
      if (!priceData) {
        pendingStates.delete(phone);
        return lang === 'french' ? `❌ Prix indisponible. Réessayez.` : `❌ Price unavailable. Try again.`;
      }
      pendingStates.set(phone, { ...pending, type: 'sell_waiting_image', price: priceData.suggested });
      return this.askForImage(lang);
    }

    // Custom price selected
    if (input === '2') {
      const msgs: Record<Language, string> = {
        english: `💰 Enter your custom price.\n\nExample: 20000`,
        french:  `💰 Entrez votre prix.\n\nExemple: 20000`,
        pidgin:  `💰 Send your price.\n\nExample: 20000`,
      };
      return msgs[lang];
    }

    // User typed an actual price number
    const customPrice = this.parsePrice(response);
    if (customPrice !== null) {
      pendingStates.set(phone, { ...pending, type: 'sell_waiting_image', price: customPrice });
      return this.askForImage(lang);
    }

    // Invalid
    const msgs: Record<Language, string> = {
      english: `❌ Reply 1 to accept suggested price or 2 to set custom price.`,
      french:  `❌ Répondez 1 pour accepter le prix suggéré ou 2 pour personnaliser.`,
      pidgin:  `❌ Send 1 for suggested price or 2 for your own price.`,
    };
    return msgs[lang];
  }

  // ─── Ask user for image ───────────────────────────────────
  private askForImage(lang: Language): string {
    const msgs: Record<Language, string> = {
      english: `📷 Would you like to add a photo?\n\nSend image now or reply SKIP.`,
      french:  `📷 Voulez-vous ajouter une photo?\n\nEnvoyez l'image ou tapez SAUTER.`,
      pidgin:  `📷 You want add photo?\n\nSend image now or reply SKIP.`,
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
      return this.createListingWithImage(phone, channel, pending, null, null, lang);
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
      const user      = await this.usersService.findByPhone(phone);

      const dto: CreateListingDto = {
        type:           'sell',
        product:        pending.product,
        quantity:       pending.quantity,
        unit:           pending.unit,
        marketAvgPrice: priceData?.avg,
        marketMinPrice: priceData?.low,
        marketMaxPrice: priceData?.high,
        price:          pending.price,
        priceType:      pending.price ? 'manual' : 'auto',
        imageUrl:       imageUrl  || undefined,
        imageMediaId:   imageMediaId || undefined,
      };

      const listing = await this.listingService.createEnriched(dto, {
        phone,
        name:     user?.name    || '',
        location: user?.location || '',
        channel:  user?.lastChannelUsed || 'whatsapp',
      });

      pendingStates.delete(phone);

      return this.aiService.reply('listing_confirmed', savedLang, {
        product:  listing.product,
        quantity: listing.quantity,
        unit:     listing.unit,
        price:    this.fmt(listing.price),
      });
    } catch {
      pendingStates.delete(phone);
      const msgs: Record<Language, string> = {
        english: `❌ Failed to create listing. Try again.`,
        french:  `❌ Échec de la création. Réessayez.`,
        pidgin:  `❌ Listing no create. Try again.`,
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

    if (isNaN(selection) || selection < 1 || selection > (pending.listings?.length || 0)) {
      const msgs: Record<Language, string> = {
        english: `❌ Invalid. Reply with a number between 1 and ${pending.listings?.length}.`,
        french:  `❌ Invalide. Répondez avec un numéro entre 1 et ${pending.listings?.length}.`,
        pidgin:  `❌ No correct. Send number between 1 and ${pending.listings?.length}.`,
      };
      return msgs[lang];
    }

    const selected = pending.listings![selection - 1];

    try {
      const buyerUser = await this.usersService.findByPhone(phone);
      const dto: CreateListingDto = {
        type: 'buy', product: pending.product,
        quantity: pending.quantity, unit: pending.unit,
        price: selected.price, priceType: 'manual',
      };
      const buyerListing = await this.listingService.createEnriched(dto, {
        phone, name: buyerUser?.name || '',
        location: buyerUser?.location || '',
        channel: buyerUser?.lastChannelUsed || 'whatsapp',
      });

      pendingStates.delete(phone);

      // Notify farmer in THEIR language
      const farmerUser = await this.usersService.findByPhone(selected.userPhone);
      const farmerLang: Language = (farmerUser as any)?.language ?? 'english';

      if (farmerUser?.phone) {
        pendingFarmerResponses.set(farmerUser.phone, {
          buyerPhone:      phone,
          sellerListingId: selected.id,
          buyerListingId:  buyerListing._id.toString(),
          product:         pending.product,
          quantity:        pending.quantity,
          unit:            pending.unit,
          price:           selected.price,
          language:        farmerLang,
        });

        await this.metaSender.send(
          farmerUser.phone,
          this.aiService.reply('match_found_farmer', farmerLang, {
            location: buyerUser?.location || '',
            product:  pending.product,
            quantity: pending.quantity,
            unit:     pending.unit,
          }),
        );
      }

      const msgs: Record<Language, string> = {
        english: `🤝 Request sent to ${selected.farmerName}!\n\n📦 ${selected.quantity} ${pending.unit}\n💰 ${this.fmt(selected.price)}\n📍 ${selected.location}\n\nWe'll notify you when they respond.`,
        french:  `🤝 Demande envoyée à ${selected.farmerName}!\n\n📦 ${selected.quantity} ${pending.unit}\n💰 ${this.fmt(selected.price)}\n📍 ${selected.location}\n\nNous vous notifierons quand ils répondront.`,
        pidgin:  `🤝 We don send request to ${selected.farmerName}!\n\n📦 ${selected.quantity} ${pending.unit}\n💰 ${this.fmt(selected.price)}\n📍 ${selected.location}\n\nWe go tell you when dem reply.`,
      };
      return msgs[lang];
    } catch {
      pendingStates.delete(phone);
      return this.aiService.reply('unknown_command', lang, {});
    }
  }

  // ─── Farmer YES/NO response ───────────────────────────────
  async handleFarmerResponse(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const user    = await this.usersService.findByPhone(phone);
    const lang: Language = (user as any)?.language ?? 'english';
    const pending = pendingFarmerResponses.get(phone);

    if (!pending) {
      const msgs: Record<Language, string> = {
        english: `❌ No pending requests. Type HELP for options.`,
        french:  `❌ Pas de demandes en attente. Tapez AIDE.`,
        pidgin:  `❌ No pending request. Type HELP.`,
      };
      return msgs[lang];
    }

    const buyer     = await this.usersService.findByPhone(pending.buyerPhone);
    const buyerLang: Language = (buyer as any)?.language ?? 'english';
    pendingFarmerResponses.delete(phone);

    // Use AI to detect YES/NO regardless of language
    const parsed = await this.aiService.parseIntent(response);
    const accepted = parsed.intent === 'yes';

    await this.listingService.update(pending.sellerListingId, { status: 'matched' });
    await this.listingService.update(pending.buyerListingId,  { status: 'matched' });

    if (accepted) {
      // Notify buyer with wa.me link in THEIR language
      if (buyer?.phone) {
        await this.metaSender.send(
          buyer.phone,
          this.aiService.reply('connected', buyerLang, {
            link:     `https://wa.me/${phone}`,
            product:  pending.product,
            quantity: pending.quantity,
            unit:     pending.unit,
            price:    this.fmt(pending.price),
          }),
        );
      }

      // Confirm to farmer in THEIR language
      return this.aiService.reply('connected', lang, {
        link:     `https://wa.me/${pending.buyerPhone}`,
        product:  pending.product,
        quantity: pending.quantity,
        unit:     pending.unit,
        price:    this.fmt(pending.price),
      });
    }

    // Farmer said NO — notify buyer
    if (buyer?.phone) {
      const rejMsgs: Record<Language, string> = {
        english: `😔 ${user?.name} declined your request for ${pending.product}.\n\nType BUY to find other farmers.`,
        french:  `😔 ${user?.name} a refusé votre demande de ${pending.product}.\n\nTapez ACHETER pour trouver d'autres agriculteurs.`,
        pidgin:  `😔 ${user?.name} no agree for your ${pending.product}.\n\nType BUY find another farmer.`,
      };
      await this.metaSender.send(buyer.phone, rejMsgs[buyerLang]);
    }

    const declinedMsgs: Record<Language, string> = {
      english: `❌ Request declined. Buyer has been notified.\n\nType HELP for options.`,
      french:  `❌ Demande refusée. L'acheteur a été notifié.\n\nTapez AIDE pour les options.`,
      pidgin:  `❌ You don decline. Buyer don hear. Type HELP.`,
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
    const parts       = command.trim().split(/\s+/);
    const offerAmount = this.parsePrice(parts[1]);
    const listingId   = parts[2];

    if (!offerAmount || !listingId) {
      const msgs: Record<Language, string> = {
        english: `❌ Use: OFFER 20000 LISTING_ID`,
        french:  `❌ Utilisez: OFFRE 20000 LISTING_ID`,
        pidgin:  `❌ Try: OFFER 20000 LISTING_ID`,
      };
      return msgs[lang];
    }

    const targetListing = await this.listingService.findOne(listingId);
    if (!targetListing || targetListing.type !== 'sell' || targetListing.status !== 'active') {
      const msgs: Record<Language, string> = {
        english: `❌ Listing not found or unavailable.`,
        french:  `❌ Annonce introuvable ou indisponible.`,
        pidgin:  `❌ Listing no dey or not available.`,
      };
      return msgs[lang];
    }

    const buyer = await this.usersService.findByPhone(phone);
    if (!buyer || buyer.role !== 'buyer') {
      const msgs: Record<Language, string> = {
        english: `❌ Only buyers can make offers.`,
        french:  `❌ Seuls les acheteurs peuvent faire des offres.`,
        pidgin:  `❌ Only buyer fit make offer.`,
      };
      return msgs[lang];
    }

    const msgs: Record<Language, string> = {
      english: `💰 Offer of ${this.fmt(offerAmount)} sent for ${targetListing.product}!\n\nFarmer will respond shortly.`,
      french:  `💰 Offre de ${this.fmt(offerAmount)} envoyée pour ${targetListing.product}!\n\nL'agriculteur répondra bientôt.`,
      pidgin:  `💰 Offer of ${this.fmt(offerAmount)} don go for ${targetListing.product}!\n\nFarmer go reply soon.`,
    };
    return msgs[lang];
  }

  // ─── Helpers ──────────────────────────────────────────────
  isInPendingState(phone: string): boolean   { return pendingStates.has(phone); }
  isInPriceState(phone: string): boolean    { return pendingStates.has(phone); } // alias used by BotService
  isInImageState(phone: string): boolean     { return pendingStates.get(phone)?.type === 'sell_waiting_image'; }
  hasPendingFarmerResponse(phone: string): boolean { return pendingFarmerResponses.has(phone); }

  async handleImage(phone: string, imageUrl: string | null, imageMediaId: string | null): Promise<string> {
    const pending  = pendingStates.get(phone);
    const lang: Language = pending?.language ?? 'english';
    if (!pending || pending.type !== 'sell_waiting_image') {
      return lang === 'french' ? `❌ Aucune annonce en attente.` : `❌ No pending listing.`;
    }
    return this.createListingWithImage(phone, 'whatsapp', pending, imageUrl, imageMediaId, lang);
  }

  private normalizeCommand(text: string): string {
    const upper = text.trim().toUpperCase();
    if (upper.startsWith('VENDRE'))  return 'SELL'  + text.trim().slice(6);
    if (upper.startsWith('ACHETER')) return 'BUY'   + text.trim().slice(7);
    if (upper.startsWith('OFFRE'))   return 'OFFER' + text.trim().slice(5);
    if (upper === 'OUI')   return 'YES';
    if (upper === 'NON')   return 'NO';
    if (upper === 'AIDE')  return 'HELP';
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
      if (/^\d+$/.test(parts[i])) { qtyIndex = i; break; }
    }
    if (qtyIndex === -1) return null;

    const product  = parts.slice(1, qtyIndex).join(' ');
    const quantity = parseInt(parts[qtyIndex], 10);
    const unit     = parts[qtyIndex + 1] || 'bags';

    if (!product || quantity <= 0) return null;
    return { type, product, quantity, unit };
  }

  private parsePrice(text: string): number | null {
    const cleaned = text?.replace(/[,\s]/g, '') ?? '';
    const price   = parseInt(cleaned, 10);
    return isNaN(price) || price <= 0 ? null : price;
  }

  private fmt(price: number): string { return price?.toLocaleString() + ' FCFA'; }
  private cap(str: string): string   { return str.charAt(0).toUpperCase() + str.slice(1); }
}