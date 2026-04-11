import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Language } from './language-detection.service';

@Injectable()
export class ResponseGenerationService {
  private readonly logger = new Logger(ResponseGenerationService.name);
  private readonly openai: OpenAI;

  private readonly LLM_TIMEOUT_MS = 5_000;
  private readonly CACHE_TTL = 5 * 60 * 1_000;

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

  private buildSystemPrompt(lang: Language): string {
    const base = `You are AgroLink, a WhatsApp agricultural marketplace assistant in Cameroon.
You connect farmers who sell produce with buyers who purchase it.

PERSONALITY:
- Warm, concise, action-oriented — like a helpful market friend, not a robot.
- Never repeat the same phrase twice in a session.
- Acknowledge what the user said before asking for more information.
- Never invent data — use only values provided in the brief.
- One question at a time — never stack multiple questions in one message.
- End actionable messages with a clear next step.

WHATSAPP FORMATTING:
- *bold* for product names, prices, names, key actions
- Keep replies under 280 characters when possible
- Use line breaks for readability — not walls of text
- Crop emojis: 🌽 maize, 🍅 tomatoes, 🌿 cassava, 🥜 groundnuts, 🍌 plantain, 🥬 vegetables
- 📦 quantity, 💰 price, 📍 location, 🔔 notification, ✅ success, ❌ error, 🌾 farming general
- Numbered options: 1️⃣ 2️⃣ 3️⃣ for menus — never more than 3 at once
- No markdown other than *bold*

RULES:
- NEVER ask for information already given in the brief
- NEVER say "I cannot" or "I don't know" — redirect constructively
- If data is absent from the brief, ask for it; do not guess
- NEVER show commands like "SELL maize 10 bags" ��� use natural language examples instead
- NEVER send a help menu automatically — only when the user explicitly asks
- If user input is ambiguous, ask ONE clarifying question (not a menu)
- If user cancels or changes intent mid-flow, acknowledge and adapt gracefully
- NEVER repeat "Pick a number" robotically — vary the phrasing if needed
- When user's intent is unclear, ask: "Are you trying to sell, buy, or check prices?"

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

    return `${base}

LANGUAGE: Reply in English. Keep language simple and clear — users may not be fluent. Avoid jargon.`;
  }

  private buildBrief(
    key: string,
    data: Record<string, string | number>,
  ): string | null {
    const d = data;
    const briefs: Record<string, string> = {
      welcome: `Welcome the user to AgroLink agricultural marketplace. Ask if they are a farmer (who sells produce) or a buyer (who buys produce) or both (for some one who buys and sells). Show options as 1 for Farmer, 2 for Buyer, 3 for Both.`,

      ask_name: `Ask the user for their full name.`,

      ask_location: `Ask the user for their city or location. Give examples: Yaoundé, Douala, Bafoussam, Buea.`,

      ask_produces: `Ask the farmer which crops they grow. Tell them to list products separated by commas. Example: maize, cassava, tomatoes.`,

      ask_business: `Ask the buyer for their business or shop name.`,

      ask_needs: `Ask the buyer which products they want to buy. Tell them to list separated by commas. Example: maize, tomatoes, plantain.`,

      registered_farmer: `Registration complete! Welcome ${d.name} as a farmer. Ask them what produce they would like to list today — use natural, friendly language. Do NOT show command syntax.`,

      registered_buyer: `Registration complete! Welcome ${d.name} as a buyer. Ask them what produce they are looking for today — use natural, friendly language. Do NOT show command syntax.`,

      registered_both: `Registration complete! Welcome ${d.name} as both a farmer and buyer. Ask whether they want to list produce or find something to buy today — use natural, friendly language. Mention that their own listings will not appear in their search results. Do NOT show command syntax.`,

      reg_invalid_role: `User gave an invalid role selection. Remind them to reply 1 for Farmer, 2 for Buyer, or 3 for Both. Be gentle and helpful.`,

      reg_invalid_name: `User entered an invalid name (too short or empty). Ask them to enter their real full name.`,

      reg_invalid_location: `User entered an invalid location. Ask them to enter their city or area name.`,

      reg_invalid_produces: `Farmer didn't list any crops. Ask them to list at least one crop they grow, separated by commas.`,

      reg_invalid_business: `Buyer didn't enter a business name. Ask them to enter their business or shop name.`,

      reg_invalid_needs: `Buyer didn't list any needed products. Ask them to list at least one product they want to buy.`,

      voice_received: `Voice note received and transcribed. Tell the user you heard: "${d.text}". Let them know you are now processing their request.`,

      voice_failed: `Could not understand or process the voice note. Apologise briefly and ask them to type their message instead.`,

      price_suggestion: `Show market prices for ${d.product}: minimum ${d.min}, average ${d.avg}, maximum ${d.max}. Suggest price: ${d.suggested}. Ask user to reply 1 to accept the suggested price or 2 to set their own price.`,

      listing_confirmed: `Listing successfully created for ${d.product}, ${d.quantity} ${d.unit} at ${d.price}. Confirm to the user and tell them buyers will be notified.`,

      sell_needs_quantity: `User wants to sell ${d.product} but didn't specify how many ${d.unit}. Ask how many ${d.unit} they have available.`,

      sell_invalid_format: `User wants to sell but didn't give enough details. Ask them naturally what produce they have and how much — e.g. "What are you selling, and how much do you have?"`,

      sell_not_registered: `User is not yet registered. Tell them to register first by replying Hi or Hello.`,

      sell_only_farmers: `Only farmers can sell. This user is registered as ${d.role}. Explain politely they cannot list produce with their current role.`,

      sell_no_price_data: `No market price data available for ${d.product} (${d.quantity} ${d.unit}). Ask the user to enter their own price as a number. Example: 20000`,

      sell_invalid_price_input: `User's price input was invalid. They should either reply 1 for suggested price, 2 for custom price, or type a number (e.g. 20000). Remind them kindly.`,

      sell_ask_image: `Listing almost done! Ask if they want to add a photo of their produce. Tell them to send an image now or reply SKIP if they don't want to add one.`,

      sell_cancelled: `Sell listing has been cancelled. Confirm to the user and ask what they'd like to do next.`,

      sell_failed: `Failed to create the listing due to a system error. Apologise and ask the user to try again.`,

      buy_invalid_format: `User wants to buy but didn't give enough details. Ask them naturally what produce they are looking for and how much — e.g. "What are you looking to buy, and how much do you need?"`,

      buy_not_registered: `User is not yet registered. Tell them to say Hi to get started — it only takes a minute.`,

      buy_only_buyers: `Only buyers can search listings. This user is registered as ${d.role}. Explain politely and offer to update their profile.`,

      buy_no_listings: `No farmers are currently selling ${d.product}. Tell the user their request has been saved and they will be notified when a farmer lists this product.`,

      buy_no_listings_filtered: `No listings found for ${d.product} with those filters. Ask if they'd like to search without the location or price filter.`,

      buy_invalid_selection: `Invalid selection number. Tell the user to reply with a number between 1 and ${d.max}.`,

      buy_request_sent: `Request sent to farmer ${d.farmerName}! Show summary: ${d.quantity} ${d.unit} of ${d.product} at ${d.price} in ${d.location}. Tell them they will be notified when the farmer responds.`,

      buy_request_failed: `Failed to send the buy request due to a system error. Apologise and suggest they try again.`,

      price_which_product: `User asked for prices but didn't specify a product. Ask which product price they want. Example: price maize`,

      price_no_data: `No price data available for ${d.product}. Apologise and tell them price data is not available for this product.`,

      match_found_farmer: `A buyer in ${d.location} is interested in buying ${d.quantity} ${d.unit} of ${d.product}. Ask the farmer: are you interested? They should reply YES or NO.`,

      match_found_farmer_counter: `New buyer alert! ${d.buyerName ? `*${d.buyerName}*` : 'A buyer'} in *${d.location}* wants to buy *${d.quantity} ${d.unit}* of *${d.product}* at *${d.price}*. Give the farmer 3 options clearly numbered: 1 = Accept this deal, 2 = Make a counter-offer (different price), 3 = Decline. Keep it short and friendly.`,

      connected: `Deal confirmed! Both farmer and buyer have agreed. Share the WhatsApp contact link: ${d.link}. Show deal summary: ${d.product}, ${d.quantity} ${d.unit}, ${d.price}. Encourage them to chat directly to finalise.`,

      farmer_no_pending: `No pending buyer requests for this farmer. Tell them to type HELP for available options.`,

      farmer_declined: `The farmer declined. Notify the buyer that ${d.farmerName} declined the request for ${d.product}. Suggest they type BUY to find other farmers.`,

      buyer_notified_decline: `You declined the buyer's request. The buyer has been notified. Type HELP for options.`,

      offer_invalid_format: `Invalid offer format. Show the correct format: OFFER 20000 LISTING_ID`,

      offer_listing_not_found: `The listing was not found or is no longer available.`,

      offer_only_buyers: `Only buyers can make offers.`,

      offer_sent: `Offer of ${d.price} sent for ${d.product}. Tell them the farmer will respond shortly.`,

      counter_offer_received_buyer: `The farmer *${d.farmerName}* has made a counter-offer for *${d.product}* (${d.quantity} ${d.unit}). Original price: ${d.originalPrice}. Counter price: *${d.counterPrice}*. Ask the buyer to reply: 1 = Accept the counter-offer, 2 = Decline.`,

      welcome_registered: `Greet the returning user *${d.name}* warmly by name. They are a *${d.role}*. Ask them in ONE natural question what they want to do today — don't dump commands. Keep it brief ��� max 2 lines.`,

      welcome_registered_with_listing: `Greet returning user *${d.name}* warmly. They have an active *${d.product}* listing (${d.quantity} ${d.unit}). Mention it briefly, then ask if they want to add another listing or need something else.`,

      clarify_intent: `The user mentioned *${d.product}* but it's unclear if they want to sell or buy it. Ask in ONE short question: do they want to sell or buy?`,

      ask_product_sell: `The user wants to sell something but didn't say what. Ask which crop or product they want to sell. Give 2-3 examples.`,

      ask_product_buy: `The user wants to buy something but didn't say what. Ask which crop or product they need. Give 2-3 examples.`,

      ask_quantity_sell: `The user wants to sell *${d.product}* but didn't say how many *${d.unit}* they have. Ask how many ${d.unit} are available. Give a short example.`,

      ask_quantity_buy: `The user wants to buy *${d.product}* but didn't say how many *${d.unit}* they need. Ask how many ${d.unit} they want. Give a short example.`,

      confirm_extracted: `Confirm what was understood from the user's message: name=${d.name}, role=${d.role}, location=${d.location}. Acknowledge all three in ONE natural sentence, then ask if the details are correct (YES/NO).`,

      field_corrected: `The user just corrected their *${d.field}* to "${d.newValue}". Confirm the update warmly in one sentence. Ask if they want to change anything else.`,

      listing_expired: `The user's listing draft for *${d.product}* was cleared because it was inactive for too long. Tell them gently and suggest they start a new one.`,

      voice_processing: `Tell the user you received their voice note and are processing it. Keep it very short — just one line.`,

      voice_processed: `Voice message heard as: "${d.text}". Understood: ${d.intent}. Tell the user what you heard in ONE sentence and what action you're taking. Keep it natural.`,

      buy_with_price_range: `Buyer wants *${d.quantity} ${d.unit}* of *${d.product}* and offered between *${d.priceMin}* and *${d.priceMax}* XAF. Confirm the search in one sentence and tell them you're looking for matching farmers.`,

      unknown_command: `The bot didn't understand the message. In one short, friendly sentence ask what the user needs today — buying, selling, or checking prices. Do NOT suggest typing any commands.`,

      clarification_needed: `Bot couldn't detect the user's language reliably. Ask them in simple English and French (bilingual) to confirm their language preference: reply 1 for English, 2 for Français, 3 for Pidgin.`,
    };

    return briefs[key] ?? null;
  }

  private fallback(
    key: string,
    lang: Language,
    data: Record<string, string | number>,
  ): string {
    const fallbacks: Record<string, Record<Language, string>> = {
      welcome: {
        english: `Welcome to AgroLink!\n\n1️⃣ Farmer (I sell)\n2️⃣ Buyer (I buy)\n\nReply 1 or 2`,
        french: `Bienvenue sur AgroLink!\n\n1️⃣ Agriculteur\n2️⃣ Acheteur\n\nRépondez 1 ou 2`,
        pidgin: `Welcome for AgroLink!\n\n1️⃣ Farmer\n2️⃣ Buyer\n\nSend 1 or 2`,
      },
      ask_name: {
        english: `What is your full name?`,
        french: `Quel est votre nom complet?`,
        pidgin: `Wetin be your full name?`,
      },
      ask_location: {
        english: `What is your location? (e.g. Yaoundé, Douala)`,
        french: `Quelle est votre localité?`,
        pidgin: `For which side you dey?`,
      },
      ask_produces: {
        english: `What do you grow? Separate by commas.\nExample: maize, cassava, tomatoes`,
        french: `Que cultivez-vous? Séparez par virgules.\nExemple: maïs, manioc, tomates`,
        pidgin: `Wetin you dey farm? Separate with comma.\nExample: maize, cassava`,
      },
      ask_business: {
        english: `What is your business name?`,
        french: `Quel est le nom de votre entreprise?`,
        pidgin: `Wetin be your business name?`,
      },
      ask_needs: {
        english: `What products do you need? Separate by commas.`,
        french: `Quels produits cherchez-vous? Séparez par virgules.`,
        pidgin: `Wetin you dey find? Separate with comma.`,
      },
      registered_farmer: {
        english: `Welcome, ${data.name}! You are registered as a farmer. What would you like to list today?`,
        french: `Bienvenue, ${data.name} ! Vous êtes inscrit comme agriculteur. Qu'est-ce que vous souhaitez lister aujourd'hui?`,
        pidgin: `Welcome, ${data.name}! You don register as farmer. Wetin you wan list today?`,
      },
      registered_buyer: {
        english: `Welcome, ${data.name}! You are registered as a buyer. What produce are you looking for today?`,
        french: `Bienvenue, ${data.name} ! Vous êtes inscrit comme acheteur. Quels produits cherchez-vous aujourd'hui?`,
        pidgin: `Welcome, ${data.name}! You don register as buyer. Wetin you dey find today?`,
      },
      registered_both: {
        english: `Welcome, ${data.name}! You are registered as both a farmer and buyer. Would you like to list produce or find something to buy today?`,
        french: `Bienvenue, ${data.name} ! Vous êtes inscrit comme agriculteur et acheteur. Voulez-vous lister des produits ou acheter quelque chose aujourd'hui?`,
        pidgin: `Welcome, ${data.name}! You don register as farmer and buyer. You wan sell or buy today?`,
      },
      voice_received: {
        english: `Heard: "${data.text}"\n\nProcessing...`,
        french: `Entendu: "${data.text}"\n\nTraitement en cours...`,
        pidgin: `I hear: "${data.text}"\n\nI dey process am...`,
      },
      voice_failed: {
        english: `Couldn't catch that voice note — could you try again or type your message?`,
        french: `Je n'ai pas compris le message vocal — pouvez-vous réessayer ou taper votre message?`,
        pidgin: `I no hear the voice well — abeg try again or type your message.`,
      },
      price_suggestion: {
        english: `${data.product} Prices\n\nMin: ${data.min}\nAvg: ${data.avg}\nMax: ${data.max}\n\nSuggested: ${data.suggested}\n\n1️⃣ Accept  2️⃣ Custom\n\nReply 1 or 2`,
        french: `Prix ${data.product}\n\nMin: ${data.min}\nMoy: ${data.avg}\nMax: ${data.max}\n\nSuggeré: ${data.suggested}\n\n1️⃣ Accepter  2️⃣ Personnaliser\n\nRépondez 1 ou 2`,
        pidgin: `${data.product} Price\n\nSmall: ${data.min}\nNormal: ${data.avg}\nBig: ${data.max}\n\nSuggest: ${data.suggested}\n\n1️⃣ Accept  2️⃣ Own price\n\nSend 1 or 2`,
      },
      listing_confirmed: {
        english: `Listing Created!\n\n${data.product}\n${data.quantity} ${data.unit}\n${data.price}\n\nBuyers will be notified.`,
        french: `Annonce créée!\n\n${data.product}\n${data.quantity} ${data.unit}\n${data.price}\n\nLes acheteurs seront notifiés.`,
        pidgin: `Listing don create!\n\n${data.product}\n${data.quantity} ${data.unit}\n${data.price}\n\nBuyers go see am.`,
      },
      match_found_farmer: {
        english: `New Buyer!\n\nBuyer in ${data.location} wants:\n${data.product} — ${data.quantity} ${data.unit}\n\nInterested? Reply YES or NO`,
        french: `Nouvel Acheteur!\n\nAcheteur à ${data.location} cherche:\n${data.product} — ${data.quantity} ${data.unit}\n\nIntéressé? Répondez OUI ou NON`,
        pidgin: `Buyer Dey!\n\nBuyer for ${data.location} wan:\n${data.product} — ${data.quantity} ${data.unit}\n\nYou agree? Reply YES or NO`,
      },
      match_found_farmer_counter: {
        english: `New Buyer!\n${data.buyerName || 'A buyer'} (${data.location}) wants:\n${data.product} — ${data.quantity} ${data.unit} @ ${data.price}\n\n1️⃣ Accept\n2️⃣ Counter-offer\n3️⃣ Decline`,
        french: `Nouvel Acheteur!\n${data.buyerName || 'Un acheteur'} (${data.location}) cherche:\n${data.product} — ${data.quantity} ${data.unit} @ ${data.price}\n\n1️⃣ Accepter\n2️⃣ Contre-offre\n3️⃣ Refuser`,
        pidgin: `New Buyer!\n${data.buyerName || 'One buyer'} (${data.location}) wan:\n${data.product} — ${data.quantity} ${data.unit} @ ${data.price}\n\n1️⃣ Accept\n2️⃣ Counter-offer\n3️⃣ No`,
      },
      counter_offer_received_buyer: {
        english: `Counter-Offer from ${data.farmerName}\n\n${data.product} — ${data.quantity} ${data.unit}\nOriginal: ${data.originalPrice}\nNew offer: ${data.counterPrice}\n\n1️⃣ Accept  2️⃣ Decline`,
        french: `Contre-offre de ${data.farmerName}\n\n${data.product} — ${data.quantity} ${data.unit}\nOriginal: ${data.originalPrice}\nNouvelle offre: ${data.counterPrice}\n\n1️⃣ Accepter  2️⃣ Refuser`,
        pidgin: `Counter-offer from ${data.farmerName}\n\n${data.product} — ${data.quantity} ${data.unit}\nFirst price: ${data.originalPrice}\nNew offer: ${data.counterPrice}\n\n1️⃣ Accept  2️⃣ No`,
      },
      welcome_registered: {
        english: `Hey ${data.name}! Good to have you back.\n\nWhat do you want to do today — sell your produce or find something to buy?`,
        french: `Bonjour ${data.name} ! Content de vous revoir.\n\nVous voulez vendre votre récolte ou acheter quelque chose aujourd'hui?`,
        pidgin: `How you dey, ${data.name}! Welcome back.\n\nYou wan sell something or you wan buy today?`,
      },
      welcome_registered_with_listing: {
        english: `Hey ${data.name}! You have an active ${data.product} listing (${data.quantity} ${data.unit}).\n\nWant to add another listing or need something else?`,
        french: `Bonjour ${data.name} ! Vous avez une annonce active pour ${data.product} (${data.quantity} ${data.unit}).\n\nVoulez-vous ajouter une autre annonce ou autre chose?`,
        pidgin: `How you dey, ${data.name}! You get active ${data.product} listing (${data.quantity} ${data.unit}).\n\nYou wan add another or need something else?`,
      },
      clarify_intent: {
        english: `Got it — ${data.product}. Do you want to sell it or buy it?`,
        french: `Compris — ${data.product}. Vous voulez le vendre ou l'acheter?`,
        pidgin: `Okay — ${data.product}. You wan sell am or you wan buy am?`,
      },
      ask_product_sell: {
        english: `What are you selling? (e.g. maize, cassava, tomatoes)`,
        french: `Que voulez-vous vendre? (ex: maïs, manioc, tomates)`,
        pidgin: `Wetin you wan sell? (e.g. maize, cassava, tomatoes)`,
      },
      ask_product_buy: {
        english: `What are you looking for? (e.g. maize, cassava, tomatoes)`,
        french: `Que cherchez-vous? (ex: maïs, manioc, tomates)`,
        pidgin: `Wetin you dey find? (e.g. maize, cassava, tomatoes)`,
      },
      ask_quantity_sell: {
        english: `How many ${data.unit} of ${data.product} do you have? (e.g. 10)`,
        french: `Combien de ${data.unit} de ${data.product} avez-vous? (ex: 10)`,
        pidgin: `How many ${data.unit} of ${data.product} you get? (e.g. 10)`,
      },
      ask_quantity_buy: {
        english: `How many ${data.unit} of ${data.product} do you need? (e.g. 20)`,
        french: `Combien de ${data.unit} de ${data.product} voulez-vous? (ex: 20)`,
        pidgin: `How many ${data.unit} of ${data.product} you need? (e.g. 20)`,
      },
      confirm_extracted: {
        english: `Got it — you're a ${data.role} named ${data.name} based in ${data.location}. Is that right?`,
        french: `Compris — vous êtes ${data.role}, vous vous appelez ${data.name} et vous êtes à ${data.location}. C'est bien ça?`,
        pidgin: `Okay — you be ${data.role}, your name na ${data.name}, you dey ${data.location}. Na so?`,
      },
      field_corrected: {
        english: `Updated your ${data.field} to ${data.newValue}. Anything else to change?`,
        french: `Votre ${data.field} a été mis à jour: ${data.newValue}. Autre chose à corriger?`,
        pidgin: `We don update your ${data.field} to ${data.newValue}. Anything else?`,
      },
      listing_expired: {
        english: `Your ${data.product} draft listing was cleared (inactive too long).\n\nType SELL ${data.product} to start a new one.`,
        french: `Votre annonce ${data.product} a été effacée (inactive trop longtemps).\n\nTapez VENDRE ${data.product} pour recommencer.`,
        pidgin: `Your ${data.product} listing don clear (you leave am too long).\n\nType SELL ${data.product} to start again.`,
      },
      voice_processing: {
        english: `Got your voice note — processing...`,
        french: `Message vocal reçu — traitement en cours...`,
        pidgin: `I hear your voice — I dey process am...`,
      },
      voice_processed: {
        english: `I heard: "${data.text}"\n\nOn it!`,
        french: `J'ai entendu: "${data.text}"\n\nJe traite ça!`,
        pidgin: `I hear: "${data.text}"\n\nI dey handle am!`,
      },
      buy_with_price_range: {
        english: `Looking for ${data.quantity} ${data.unit} of ${data.product} between ${data.priceMin} and ${data.priceMax} XAF...`,
        french: `Recherche de ${data.quantity} ${data.unit} de ${data.product} entre ${data.priceMin} et ${data.priceMax} XAF...`,
        pidgin: `I dey find ${data.quantity} ${data.unit} of ${data.product} for price between ${data.priceMin} and ${data.priceMax}...`,
      },
      connected: {
        english: `Deal Confirmed!\n\nContact: ${data.link}\n\n${data.product} — ${data.quantity} ${data.unit} @ ${data.price}`,
        french: `Accord Confirmé!\n\nContact: ${data.link}\n\n${data.product} — ${data.quantity} ${data.unit} @ ${data.price}`,
        pidgin: `Deal Don Set!\n\nChat: ${data.link}\n\n${data.product} — ${data.quantity} ${data.unit} @ ${data.price}`,
      },
      unknown_command: {
        english: `Hmm, I didn't catch that. Are you trying to sell produce, find something to buy, or check prices?`,
        french: `Hmm, je n'ai pas compris. Vous voulez vendre, acheter ou voir les prix?`,
        pidgin: `Hmm, I no understand. You wan sell, buy, or check price?`,
      },
      clarification_needed: {
        english: `Choose language / Choisissez la langue:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`,
        french: `Choose language / Choisissez la langue:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`,
        pidgin: `Choose language / Choisissez la langue:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`,
      },
    };

    const template = fallbacks[key];
    if (template) return template[lang] ?? template['english'];

    return `Something went wrong — could you try again?`;
  }

  private buildCacheKey(
    key: string,
    lang: Language,
    data: Record<string, string | number>,
  ): string {
    const dataStr = Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${key}:${lang}:${dataStr}`;
  }
}