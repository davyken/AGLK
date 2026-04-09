import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Language } from './language-detection.service';

/**
 * ResponseGenerationService
 *
 * Generates all bot responses dynamically via GPT-4o-mini.
 * No hardcoded translation tables — the model produces natural,
 * culturally-appropriate text for each language.
 *
 * Design decisions:
 *
 * 1. SEMANTIC KEYS — each key describes WHAT to communicate, not HOW.
 *    The model decides phrasing, tone and structure.
 *
 * 2. PIDGIN VALIDATION — Cameroonian Pidgin generation is guided by a
 *    dedicated system prompt section with authentic examples. If the
 *    model signals low Pidgin confidence it falls back to plain English.
 *
 * 3. IN-MEMORY CACHE — identical (key + lang + data hash) requests are
 *    served from cache for up to CACHE_TTL ms to avoid redundant API
 *    calls without requiring Redis.
 *
 * 4. SAFE FALLBACK — a minimal English-only fallback template is used
 *    when the LLM call fails or times out, keeping the bot functional
 *    even when OpenAI is unavailable.
 */
@Injectable()
export class ResponseGenerationService {
  private readonly logger = new Logger(ResponseGenerationService.name);
  private readonly openai: OpenAI;

  private readonly LLM_TIMEOUT_MS = 5_000;
  private readonly CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

  // Key → language → data-hash → { text, expiresAt }
  private readonly cache = new Map<
    string,
    { text: string; expiresAt: number }
  >();

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
      timeout: this.LLM_TIMEOUT_MS,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate a response for a given semantic key in the specified language.
   * Data values are interpolated into the content brief sent to the model.
   *
   * @param key   Semantic identifier (see CONTENT_BRIEFS below)
   * @param lang  Target language
   * @param data  Dynamic values referenced in the brief (product, name, etc.)
   */
  async generate(
    key: string,
    lang: Language,
    data: Record<string, string | number> = {},
  ): Promise<string> {
    const cacheKey = this.buildCacheKey(key, lang, data);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }

    try {
      const text = await this.generateWithLLM(key, lang, data);
      this.cache.set(cacheKey, {
        text,
        expiresAt: Date.now() + this.CACHE_TTL,
      });
      return text;
    } catch (err: any) {
      this.logger.warn(
        `ResponseGenerationService: LLM call failed for key="${key}" lang="${lang}" [${err?.status ?? err?.code ?? 'timeout'}] — using fallback`,
      );
      return this.fallback(key, lang, data);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private: LLM call
  // ─────────────────────────────────────────────────────────────

  private async generateWithLLM(
    key: string,
    lang: Language,
    data: Record<string, string | number>,
  ): Promise<string> {
    const brief = this.buildBrief(key, data);
    if (!brief) {
      return this.fallback(key, lang, data);
    }

    const systemPrompt = this.buildSystemPrompt(lang);

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 350,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate a WhatsApp bot reply for this situation:\n${brief}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('Empty LLM response');
    return text;
  }

  // ─────────────────────────────────────────────────────────────
  // System prompt — sets the model's persona and language rules
  // ─────────────────────────────────────────────────────────────

  private buildSystemPrompt(lang: Language): string {
    const base = `You are AgroLink, a WhatsApp chatbot for an agricultural marketplace in Cameroon.
You connect farmers who sell produce with buyers who purchase it.

Your personality: friendly, warm, concise, action-oriented. You guide users step by step.
You never hallucinate data — if you're given specific numbers, use them exactly.

WhatsApp formatting rules:
- Use *bold* for important words, product names, and CTAs
- Keep responses under 300 characters when possible
- Use relevant emojis (🌽 for crops, 📦 for quantity, 💰 for price, 📍 for location)
- Use numbered options (1️⃣ 2️⃣) when asking users to choose
- No markdown other than *bold*

IMPORTANT: Respond ONLY with the message text — no explanations, no quotes around the response.`;

    if (lang === 'french') {
      return `${base}

LANGUAGE: Reply in French (Cameroonian context — simple, clear French used in Cameroon).
Use "vous" for politeness. Crop names in French: maïs, manioc, tomates, plantain, arachides, igname, gombo, piment.`;
    }

    if (lang === 'pidgin') {
      return `${base}

LANGUAGE: Reply in Cameroonian Pidgin English — a real creole spoken in Cameroon, NOT broken English.

Authentic Pidgin markers to use naturally:
- "dey" (is/are/doing): "I dey sell maize", "Buyer dey interest"
- "don" (have/has/already): "You don register", "We don send"
- "wan" (want): "I wan sell", "You wan buy?"
- "fit" (can/able to): "You fit list am now", "I no fit"
- "abeg" (please/I beg): "Abeg send your price"
- "wetin" (what): "Wetin be your name?", "Wetin you dey sell?"
- "na" (it is/emphasis): "Na maize I get", "Na farmer you be?"
- "sabi" (know): "I no sabi the price"
- "oga" (sir/respected person)
- "dis" / "dat" (this/that)
- "wey" (who/which/that): "Farmer wey dey Douala"

IMPORTANT: If you are not confident the response sounds authentic and natural in Cameroonian Pidgin, write it in simple clear English instead. Do not guess or produce artificial-sounding Pidgin.`;
    }

    // English (default)
    return `${base}

LANGUAGE: Reply in English. Keep language simple and clear — users may not be fluent. Avoid jargon.`;
  }

  // ─────────────────────────────────────────────────────────────
  // Content briefs — what needs to be communicated per key
  // ─────────────────────────────────────────────────────────────

  private buildBrief(
    key: string,
    data: Record<string, string | number>,
  ): string | null {
    const d = data;
    const briefs: Record<string, string> = {
      // ── Registration ──────────────────────────────────────
      welcome: `Welcome the user to AgroLink agricultural marketplace. Ask if they are a farmer (who sells produce) or a buyer (who buys produce). Show options as 1 for Farmer, 2 for Buyer.`,

      ask_name: `Ask the user for their full name.`,

      ask_location: `Ask the user for their city or location. Give examples: Yaoundé, Douala, Bafoussam, Buea.`,

      ask_produces: `Ask the farmer which crops they grow. Tell them to list products separated by commas. Example: maize, cassava, tomatoes.`,

      ask_business: `Ask the buyer for their business or shop name.`,

      ask_needs: `Ask the buyer which products they want to buy. Tell them to list separated by commas. Example: maize, tomatoes, plantain.`,

      registered_farmer: `Registration complete! Welcome ${d.name} as a farmer. Tell them they can now list their produce by typing: SELL maize 10 bags. Tell them to type HELP for all options.`,

      registered_buyer: `Registration complete! Welcome ${d.name} as a buyer. Tell them they can now search for produce by typing: BUY maize 20 bags. Tell them to type HELP for all options.`,

      registered_both: `Registration complete! Welcome ${d.name} as both a farmer and buyer. You can list produce with: SELL maize 10 bags. You can search for produce with: BUY maize 20 bags. Your listings will not be suggested back to you. Type HELP for all options.`,

      // ── Errors during registration ─────────────────────────
      reg_invalid_role: `User gave an invalid role selection. Remind them to reply 1 for Farmer, 2 for Buyer, or 3 for Both. Be gentle and helpful.`,

      reg_invalid_name: `User entered an invalid name (too short or empty). Ask them to enter their real full name.`,

      reg_invalid_location: `User entered an invalid location. Ask them to enter their city or area name.`,

      reg_invalid_produces: `Farmer didn't list any crops. Ask them to list at least one crop they grow, separated by commas.`,

      reg_invalid_business: `Buyer didn't enter a business name. Ask them to enter their business or shop name.`,

      reg_invalid_needs: `Buyer didn't list any needed products. Ask them to list at least one product they want to buy.`,

      // ── Voice messages ────────────────────────────────────
      voice_received: `Voice note received and transcribed. Tell the user you heard: "${d.text}". Let them know you are now processing their request.`,

      voice_failed: `Could not understand or process the voice note. Apologise briefly and ask them to type their message instead.`,

      // ── Market prices & listing creation ──────────────────
      price_suggestion: `Show market prices for ${d.product}: minimum ${d.min}, average ${d.avg}, maximum ${d.max}. Suggest price: ${d.suggested}. Ask user to reply 1 to accept the suggested price or 2 to set their own price.`,

      listing_confirmed: `Listing successfully created for ${d.product}, ${d.quantity} ${d.unit} at ${d.price}. Confirm to the user and tell them buyers will be notified.`,

      // ── Sell flow errors ──────────────────────────────────
      sell_needs_quantity: `User wants to sell ${d.product} but didn't specify how many ${d.unit}. Ask how many ${d.unit} they have available.`,

      sell_invalid_format: `Invalid sell command format. Show the correct format: SELL maize 10 bags`,

      sell_not_registered: `User is not yet registered. Tell them to register first by replying Hi or Hello.`,

      sell_only_farmers: `Only farmers can sell. This user is registered as ${d.role}. Explain politely they cannot list produce with their current role.`,

      sell_no_price_data: `No market price data available for ${d.product} (${d.quantity} ${d.unit}). Ask the user to enter their own price as a number. Example: 20000`,

      sell_invalid_price_input: `User's price input was invalid. They should either reply 1 for suggested price, 2 for custom price, or type a number (e.g. 20000). Remind them kindly.`,

      sell_ask_image: `Listing almost done! Ask if they want to add a photo of their produce. Tell them to send an image now or reply SKIP if they don't want to add one.`,

      sell_cancelled: `Sell listing has been cancelled. Tell the user and suggest they type HELP for other options.`,

      sell_failed: `Failed to create the listing due to a system error. Apologise and ask the user to try again.`,

      // ── Buy flow errors ───────────────────────────────────
      buy_invalid_format: `Invalid buy command format. Show the correct format: BUY maize 20 bags`,

      buy_not_registered: `User is not yet registered. Tell them to register first by replying Hi or Hello.`,

      buy_only_buyers: `Only buyers can search listings. This user is registered as ${d.role}. Explain politely.`,

      buy_no_listings: `No farmers are currently selling ${d.product}. Tell the user their request has been saved and they will be notified when a farmer lists this product.`,

      buy_no_listings_filtered: `No listings found for ${d.product} with those filters. Suggest they try again without filters: BUY ${d.product} ${d.quantity} bags`,

      buy_invalid_selection: `Invalid selection number. Tell the user to reply with a number between 1 and ${d.max}.`,

      buy_request_sent: `Request sent to farmer ${d.farmerName}! Show summary: ${d.quantity} ${d.unit} of ${d.product} at ${d.price} in ${d.location}. Tell them they will be notified when the farmer responds.`,

      buy_request_failed: `Failed to send the buy request due to a system error. Apologise and suggest they try again.`,

      // ── Price query ───────────────────────────────────────
      price_which_product: `User asked for prices but didn't specify a product. Ask which product price they want. Example: price maize`,

      price_no_data: `No price data available for ${d.product}. Apologise and tell them price data is not available for this product.`,

      // ── Farmer YES/NO response to buyer ───────────────────
      match_found_farmer: `A buyer in ${d.location} is interested in buying ${d.quantity} ${d.unit} of ${d.product}. Ask the farmer: are you interested? They should reply YES or NO.`,

      match_found_farmer_counter: `New buyer alert! ${d.buyerName ? `*${d.buyerName}*` : 'A buyer'} in *${d.location}* wants to buy *${d.quantity} ${d.unit}* of *${d.product}* at *${d.price}*. Give the farmer 3 options clearly numbered: 1 = Accept this deal, 2 = Make a counter-offer (different price), 3 = Decline. Keep it short and friendly.`,

      connected: `Deal confirmed! Both farmer and buyer have agreed. Share the WhatsApp contact link: ${d.link}. Show deal summary: ${d.product}, ${d.quantity} ${d.unit}, ${d.price}. Encourage them to chat directly to finalise.`,

      farmer_no_pending: `No pending buyer requests for this farmer. Tell them to type HELP for available options.`,

      farmer_declined: `The farmer declined. Notify the buyer that ${d.farmerName} declined the request for ${d.product}. Suggest they type BUY to find other farmers.`,

      buyer_notified_decline: `You declined the buyer's request. The buyer has been notified. Type HELP for options.`,

      // ── Offer command ─────────────────────────────────────
      offer_invalid_format: `Invalid offer format. Show the correct format: OFFER 20000 LISTING_ID`,

      offer_listing_not_found: `The listing was not found or is no longer available.`,

      offer_only_buyers: `Only buyers can make offers.`,

      offer_sent: `Offer of ${d.price} sent for ${d.product}. Tell them the farmer will respond shortly.`,

      // ── Counter-offer ─────────────────────────────────────
      counter_offer_received_buyer: `The farmer *${d.farmerName}* has made a counter-offer for *${d.product}* (${d.quantity} ${d.unit}). Original price: ${d.originalPrice}. Counter price: *${d.counterPrice}*. Ask the buyer to reply: 1 = Accept the counter-offer, 2 = Decline.`,

      // ── Returning / context-aware greetings ──────────────
      welcome_registered: `Greet the returning user *${d.name}* warmly by name. They are a *${d.role}*. Tell them in one short sentence how to get started (SELL or BUY command). Keep it brief — max 2 lines.`,

      // ── General ───────────────────────────────────────────
      unknown_command: `The bot didn't understand the message. Suggest the user try: SELL maize 10 bags, BUY maize 20 bags, or type HELP for all options.`,

      clarification_needed: `Bot couldn't detect the user's language reliably. Ask them in simple English and French (bilingual) to confirm their language preference: reply 1 for English, 2 for Français, 3 for Pidgin.`,
    };

    return briefs[key] ?? null;
  }

  // ─────────────────────────────────────────────────────────────
  // Minimal fallback — used when LLM is unavailable
  // ─────────────────────────────────────────────────────────────

  private fallback(
    key: string,
    lang: Language,
    data: Record<string, string | number>,
  ): string {
    // Minimal safe responses in all three languages
    const fallbacks: Record<string, Record<Language, string>> = {
      welcome: {
        english: `👋 Welcome to AgroLink!\n\n1️⃣ Farmer (I sell)\n2️⃣ Buyer (I buy)\n\nReply 1 or 2`,
        french: `👋 Bienvenue sur AgroLink!\n\n1️⃣ Agriculteur\n2️⃣ Acheteur\n\nRépondez 1 ou 2`,
        pidgin: `👋 Welcome for AgroLink!\n\n1️⃣ Farmer\n2️⃣ Buyer\n\nSend 1 or 2`,
      },
      ask_name: {
        english: `👤 What is your full name?`,
        french: `👤 Quel est votre nom complet?`,
        pidgin: `👤 Wetin be your full name?`,
      },
      ask_location: {
        english: `📍 What is your location? (e.g. Yaoundé, Douala)`,
        french: `📍 Quelle est votre localité?`,
        pidgin: `📍 For which side you dey?`,
      },
      ask_produces: {
        english: `🌱 What do you grow? Separate by commas.\nExample: maize, cassava, tomatoes`,
        french: `🌱 Que cultivez-vous? Séparez par virgules.\nExemple: maïs, manioc, tomates`,
        pidgin: `🌱 Wetin you dey farm? Separate with comma.\nExample: maize, cassava`,
      },
      ask_business: {
        english: `🏪 What is your business name?`,
        french: `🏪 Quel est le nom de votre entreprise?`,
        pidgin: `🏪 Wetin be your business name?`,
      },
      ask_needs: {
        english: `🛒 What products do you need? Separate by commas.`,
        french: `🛒 Quels produits cherchez-vous? Séparez par virgules.`,
        pidgin: `🛒 Wetin you dey find? Separate with comma.`,
      },
      registered_farmer: {
        english: `✅ *Registered as Farmer!*\n\nWelcome ${data.name} 👨‍🌾\nType: SELL maize 10 bags\n\nType HELP for options.`,
        french: `✅ *Inscrit comme Agriculteur!*\n\nBienvenue ${data.name} 👨‍🌾\nTapez: VENDRE maïs 10 sacs`,
        pidgin: `✅ *You don register as Farmer!*\n\nWelcome ${data.name} 👨‍🌾\nType: SELL maize 10 bags`,
      },
      registered_buyer: {
        english: `✅ *Registered as Buyer!*\n\nWelcome ${data.name} 🏪\nType: BUY maize 20 bags\n\nType HELP for options.`,
        french: `✅ *Inscrit comme Acheteur!*\n\nBienvenue ${data.name} 🏪\nTapez: ACHETER maíz 20 sacs`,
        pidgin: `✅ *You don register as Buyer!*\n\nWelcome ${data.name} 🏪\nType: BUY maize 20 bags`,
      },
      registered_both: {
        english: `✅ *Registered as Farmer & Buyer!*\n\nWelcome ${data.name} 👨‍🌾🏪\nList produce: SELL maize 10 bags\nBuy produce: BUY maize 20 bags\nYour listings won't be suggested to you.\nType HELP for options.`,
        french: `✅ *Inscrit comme Agriculteur & Acheteur!*\n\nBienvenue ${data.name} 👨‍🌾🏪\nVendre: VENDRE maíz 10 sacs\nAcheter: ACHETER maíz 20 sacs\nVos annonces ne vous seront pas suggérées.`,
        pidgin: `✅ *You don register as Farmer & Buyer!*\n\nWelcome ${data.name} 👨‍🌾🏪\nSell: SELL maize 10 bags\nBuy: BUY maize 20 bags\nYour listings no go show for you.`,
      },
      voice_received: {
        english: `🎤 Heard: *"${data.text}"*\n\nProcessing...`,
        french: `🎤 Entendu: *"${data.text}"*\n\nTraitement en cours...`,
        pidgin: `🎤 I hear: *"${data.text}"*\n\nI dey process am...`,
      },
      voice_failed: {
        english: `❌ Couldn't process voice note.\nPlease type your message.`,
        french: `❌ Message vocal non compris.\nVeuillez taper votre message.`,
        pidgin: `❌ I no hear the voice.\nAbeg type your message.`,
      },
      price_suggestion: {
        english: `📊 *${data.product} Prices*\n\nMin: ${data.min}\nAvg: ${data.avg}\nMax: ${data.max}\n✨ Suggested: *${data.suggested}*\n\n1️⃣ Accept  2️⃣ Custom\n\nReply 1 or 2`,
        french: `📊 *Prix ${data.product}*\n\nMin: ${data.min}\nMoy: ${data.avg}\nMax: ${data.max}\n✨ Suggéré: *${data.suggested}*\n\n1️⃣ Accepter  2️⃣ Personnaliser\n\nRépondez 1 ou 2`,
        pidgin: `📊 *${data.product} Price*\n\nSmall: ${data.min}\nNormal: ${data.avg}\nBig: ${data.max}\n✨ Suggest: *${data.suggested}*\n\n1️⃣ Accept  2️⃣ Own price\n\nSend 1 or 2`,
      },
      listing_confirmed: {
        english: `✅ *Listing Created!*\n\n🌽 ${data.product}\n📦 ${data.quantity} ${data.unit}\n💰 ${data.price}\n\nBuyers will be notified.`,
        french: `✅ *Annonce créée!*\n\n🌽 ${data.product}\n📦 ${data.quantity} ${data.unit}\n💰 ${data.price}\n\nLes acheteurs seront notifiés.`,
        pidgin: `✅ *Listing don create!*\n\n🌽 ${data.product}\n📦 ${data.quantity} ${data.unit}\n💰 ${data.price}\n\nBuyers go see am.`,
      },
      match_found_farmer: {
        english: `🔔 *New Buyer!*\n\nBuyer in *${data.location}* wants:\n🌽 ${data.product} — ${data.quantity} ${data.unit}\n\nInterested? Reply *YES* or *NO*`,
        french: `🔔 *Nouvel Acheteur!*\n\nAcheteur à *${data.location}* cherche:\n🌽 ${data.product} — ${data.quantity} ${data.unit}\n\nRépondez *OUI* ou *NON*`,
        pidgin: `🔔 *Buyer Dey!*\n\nBuyer for *${data.location}* wan:\n🌽 ${data.product} — ${data.quantity} ${data.unit}\n\nYou agree? Reply *YES* or *NO*`,
      },
      match_found_farmer_counter: {
        english: `🔔 *New Buyer!*\n\n*${data.buyerName || 'A buyer'}* (${data.location}) wants:\n🌽 *${data.product}* — ${data.quantity} ${data.unit} @ *${data.price}*\n\n1️⃣ Accept\n2️⃣ Counter-offer\n3️⃣ Decline`,
        french: `🔔 *Nouvel Acheteur!*\n\n*${data.buyerName || 'Un acheteur'}* (${data.location}) cherche:\n🌽 *${data.product}* — ${data.quantity} ${data.unit} @ *${data.price}*\n\n1️⃣ Accepter\n2️⃣ Contre-offre\n3️⃣ Refuser`,
        pidgin: `🔔 *New Buyer!*\n\n*${data.buyerName || 'One buyer'}* (${data.location}) wan:\n🌽 *${data.product}* — ${data.quantity} ${data.unit} @ *${data.price}*\n\n1️⃣ Accept\n2️⃣ Counter-offer\n3️⃣ No`,
      },
      counter_offer_received_buyer: {
        english: `💬 *Counter-Offer from ${data.farmerName}*\n\n🌽 ${data.product} — ${data.quantity} ${data.unit}\nOriginal: ${data.originalPrice}\nNew offer: *${data.counterPrice}*\n\n1️⃣ Accept  2️⃣ Decline`,
        french: `💬 *Contre-offre de ${data.farmerName}*\n\n🌽 ${data.product} — ${data.quantity} ${data.unit}\nOriginal: ${data.originalPrice}\nNouvelle offre: *${data.counterPrice}*\n\n1️⃣ Accepter  2️⃣ Refuser`,
        pidgin: `💬 *Counter-offer from ${data.farmerName}*\n\n🌽 ${data.product} — ${data.quantity} ${data.unit}\nFirst price: ${data.originalPrice}\nNew offer: *${data.counterPrice}*\n\n1️⃣ Accept  2️⃣ No`,
      },
      welcome_registered: {
        english: `Hey *${data.name}*! 👋\n\n${data.role === 'farmer' ? 'Type *SELL maize 10 bags* to list your produce.' : 'Type *BUY maize 20 bags* to find sellers.'}\n\n_Type HELP for options._`,
        french: `Bonjour *${data.name}* ! 👋\n\n${data.role === 'farmer' ? 'Tapez *VENDRE maïs 10 sacs* pour créer une annonce.' : 'Tapez *ACHETER maïs 20 sacs* pour trouver des vendeurs.'}\n\n_Tapez AIDE pour les options._`,
        pidgin: `How you dey, *${data.name}*! 👋\n\n${data.role === 'farmer' ? 'Type *SELL maize 10 bags* to list your thing.' : 'Type *BUY maize 20 bags* to find sellers.'}\n\n_Type HELP for options._`,
      },
      connected: {
        english: `✅ *Deal Confirmed!*\n\nContact: ${data.link}\n\n📋 ${data.product} — ${data.quantity} ${data.unit} @ ${data.price}`,
        french: `✅ *Accord Confirmé!*\n\nContact: ${data.link}\n\n📋 ${data.product} — ${data.quantity} ${data.unit} @ ${data.price}`,
        pidgin: `✅ *Deal Don Set!*\n\nChat: ${data.link}\n\n📋 ${data.product} — ${data.quantity} ${data.unit} @ ${data.price}`,
      },
      unknown_command: {
        english: `❓ Didn't understand that.\n\nTry:\n• SELL maize 10 bags\n• BUY maize 20 bags\n• HELP`,
        french: `❓ Je n'ai pas compris.\n\nEssayez:\n• VENDRE maïs 10 sacs\n• ACHETER maïs 20 sacs\n• AIDE`,
        pidgin: `❓ I no understand.\n\nTry:\n• SELL maize 10 bags\n• BUY maize 20 bags\n• HELP`,
      },
      clarification_needed: {
        english: `🌐 Choose language / Choisissez la langue:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`,
        french: `🌐 Choose language / Choisissez la langue:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`,
        pidgin: `🌐 Choose language / Choisissez la langue:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`,
      },
    };

    const template = fallbacks[key];
    if (template) return template[lang] ?? template['english'];

    // Ultimate fallback
    return `❓ Something went wrong. Type HELP for options.`;
  }

  // ─────────────────────────────────────────────────────────────
  // Cache helpers
  // ─────────────────────────────────────────────────────────────

  private buildCacheKey(
    key: string,
    lang: Language,
    data: Record<string, string | number>,
  ): string {
    // Sort keys for consistent hashing
    const dataStr = Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${key}:${lang}:${dataStr}`;
  }
}
