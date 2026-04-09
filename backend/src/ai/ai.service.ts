import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as https from 'https';

export type Language = 'english' | 'french' | 'pidgin';

export interface ParsedIntent {
  intent:    'register' | 'sell' | 'buy' | 'price' | 'help' | 'yes' | 'no' | 'unknown';
  language:  Language;
  product?:  string;
  quantity?: number;
  unit?:     string;
  price?:    number;
  raw:       string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  // ─────────────────────────────────────────────────────────
  // 1. PARSE INTENT
  // OpenAI GPT-4o-mini → regex fallback if API fails
  // ─────────────────────────────────────────────────────────
  async parseIntent(message: string): Promise<ParsedIntent> {
    try {
      const completion = await this.openai.chat.completions.create({
        model:           'gpt-4o-mini',
        max_tokens:      200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role:    'system',
            content: `You are a message parser for an agricultural marketplace in Cameroon.
Return ONLY valid JSON. No explanation.

Fields:
- intent: register | sell | buy | price | help | yes | no | unknown
- language: english | french | pidgin
- product: crop name in english lowercase (maïs→maize, tomate→tomatoes, manioc→cassava)
- quantity: number or null
- unit: bags/kg/tonnes/sacs, default "bags"
- price: number or null

Language rules:
- french: bonjour, salut, oui, non, je, j'ai, vendre, acheter, maïs, sacs, combien, prix
- pidgin: i get, i wan, i dey, na so, abeg, wetin, plenty, for sell, for buy, wey

Intent rules:
- register: hi, hello, bonjour, salut, start, hey
- yes: yes, oui, ok, okay, na so, d'accord, yep
- no: no, non, nope, no be dat
- sell: any message about having/selling produce
- buy: any message about wanting/needing produce
- price: asking about price/cost
- help: help, aide, options

JSON format: {"intent":"","language":"","product":null,"quantity":null,"unit":"bags","price":null}`,
          },
          { role: 'user', content: message },
        ],
      });

      const text   = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text.trim());
      return { ...parsed, raw: message };

    } catch (err: any) {
      this.logger.warn(`OpenAI parseIntent failed [${err?.status ?? err?.code ?? 'unknown'}] — using regex`);
      return this.regexFallback(message);
    }
  }

  // ─────────────────────────────────────────────────────────
  // 2. DETECT LANGUAGE ONLY (lightweight — no full parse)
  // Called on every message to persist language to DB
  // ─────────────────────────────────────────────────────────
  detectLanguage(text: string): Language {
    const lower = text.toLowerCase().trim();

    const frenchSignals = [
      'bonjour', 'salut', 'bonsoir', 'merci', 'oui', 'non',
      'vendre', 'acheter', 'je ', "j'ai", 'du ', 'de la',
      'maïs', 'mais', 'tomate', 'tomates', 'manioc', 'sacs',
      'sac', 'quel', 'prix', 'aide', 'combien', 'langue',
      'français', 'agriculteur', 'acheteur', "c'est", 'votre',
      'notre', 'pour', 'avec', 'dans', 'sur', 'des ', 'les ',
    ];

    const pidginSignals = [
      'i get', 'i wan', 'i dey', 'na so', 'abeg',
      'wetin', 'plenty', 'for sell', 'for buy', 'no be',
      'wey ', 'dem ', 'dis ', 'dat ', 'oga', 'na ',
      'dey ', 'fit ', 'don ', 'go tell', 'go see',
    ];

    if (frenchSignals.some((w) => lower.includes(w))) return 'french';
    if (pidginSignals.some((w) => lower.includes(w))) return 'pidgin';
    return 'english';
  }

  // ─────────────────────────────────────────────────────────
  // 3. TRANSCRIBE VOICE NOTE — OpenAI Whisper
  // ─────────────────────────────────────────────────────────
  async transcribeVoiceNote(
    mediaUrl:    string,
    accessToken: string,
  ): Promise<{ text: string; language: Language }> {
    const tmpPath = `/tmp/voice_${Date.now()}.ogg`;

    try {
      await this.downloadFile(mediaUrl, accessToken, tmpPath);

      const transcription = await this.openai.audio.transcriptions.create({
        file:  fs.createReadStream(tmpPath),
        model: 'whisper-1',
        // Whisper auto-detects language — works for French, English, Pidgin
      });

      const text     = transcription.text ?? '';
      const language = this.detectLanguage(text);

      this.logger.log(`Whisper transcribed [${language}]: "${text}"`);
      return { text, language };

    } catch (err: any) {
      this.logger.error(`Whisper failed: ${err?.message ?? err}`);
      return { text: '', language: 'english' };

    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  // ─────────────────────────────────────────────────────────
  // 4. REGEX FALLBACK — works with zero API
  // ─────────────────────────────────────────────────────────
  private regexFallback(message: string): ParsedIntent {
    const raw   = message;
    const lower = message.toLowerCase().trim();
    const language = this.detectLanguage(lower);

    // YES
    if (/^(yes|oui|ok|okay|na so|yep|d'accord|yes na)$/i.test(lower)) {
      return { intent: 'yes', language, raw };
    }
    // NO
    if (/^(no|non|nope|no be dat|non merci)$/i.test(lower)) {
      return { intent: 'no', language, raw };
    }
    // HELP
    if (/^(help|aide|aidez|options)$/i.test(lower)) {
      return { intent: 'help', language, raw };
    }
    // REGISTER (greeting)
    if (/^(hi|hello|bonjour|salut|bonsoir|hey|start|begin)$/i.test(lower)) {
      return { intent: 'register', language, raw };
    }
    // SELL
    if (/\b(sell|vendre|vend|for sell|wan sell|dey sell|i get.+sell|i have.+sell)\b/i.test(lower)) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      return { intent: 'sell', language, product, quantity, unit, raw };
    }
    // BUY
    if (/\b(buy|acheter|achet|for buy|wan buy|dey find|je cherche|je veux|looking for|need)\b/i.test(lower)) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      return { intent: 'buy', language, product, quantity, unit, raw };
    }
    // PRICE
    if (/\b(price|prix|how much|combien|quel est le prix|cost)\b/i.test(lower)) {
      const { product } = this.extractProductQty(lower);
      return { intent: 'price', language, product, raw };
    }
    // Pure number — could be price, selection, or quantity reply
    if (/^\d+$/.test(lower.trim())) {
      return { intent: 'unknown', language, price: parseInt(lower.trim(), 10), raw };
    }

    return { intent: 'unknown', language, raw };
  }

  // ─────────────────────────────────────────────────────────
  // 5. EXTRACT PRODUCT + QUANTITY from message
  // ─────────────────────────────────────────────────────────
  private extractProductQty(text: string): {
    product?: string;
    productOriginal?: string; // preserves original language name e.g. "manioc"
    quantity?: number;
    unit: string;
  } {
    const unitWords = [
      'bags', 'bag', 'sacs', 'sac', 'kg', 'kilogrammes', 'kilogramme',
      'tonnes', 'tonne', 'crates', 'crate', 'cageots', 'cageot',
      'régimes', 'régime', 'bunches', 'bunch', 'litres', 'litre',
      'pieces', 'piece', 'pièces', 'pièce',
    ];
    const stopWords = [
      'sell', 'buy', 'vendre', 'acheter', 'i', 'get', 'wan', 'dey',
      'for', 'have', 'je', 'du', "j'ai", 'la', 'le', 'les', 'des',
      'want', 'need', 'plenty', 'some', 'available', 'fresh', 'good',
      'quality', 'fraîches', 'fraîche', 'à', 'vendre', 'en', 'vente',
      'cherche', 'besoin', 'veux', 'voudrais', 'ai',
    ];

    // French → English normalization (for DB storage + matching)
    const frenchToEnglish: Record<string, string> = {
      'maïs': 'maize', 'mais': 'maize',
      'tomate': 'tomatoes', 'tomates': 'tomatoes',
      'manioc': 'cassava',
      'igname': 'yam', 'ignames': 'yam',
      'plantain': 'plantain', 'plantains': 'plantain',
      'gombo': 'okra',
      'haricot': 'beans', 'haricots': 'beans',
      'arachide': 'groundnuts', 'arachides': 'groundnuts',
      'poisson': 'fish',
      'poulet': 'chicken',
      'macabo': 'macabo',
      'njama': 'njama njama',
      'palmier': 'palm oil', 'palme': 'palm oil',
      'concombre': 'cucumber', 'concombres': 'cucumber',
      'aubergine': 'eggplant', 'aubergines': 'eggplant',
      'piment': 'pepper', 'piments': 'pepper',
      'oignon': 'onion', 'oignons': 'onion',
      'ail': 'garlic',
    };

    // ── Fix 2: Extract quantity from natural language ──────
    // Handles: "I have 20 bags", "j'ai 20 sacs", "about 15 kg"
    const naturalQtyMatch = text.match(/(?:i have|j'ai|j'en ai|about|environ|around|roughly)\s+(\d+)/i);
    if (naturalQtyMatch) {
      // Will be picked up by the number scan below
    }

    const parts    = text.toLowerCase().split(/\s+/);
    let product:         string | undefined;
    let productOriginal: string | undefined;
    let quantity:        number | undefined;
    let unit = '';

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];

      if (unitWords.includes(p)) { unit = p; continue; }

      if (/^\d+$/.test(p)) { quantity = parseInt(p, 10); continue; }

      if (frenchToEnglish[p]) {
        productOriginal = p;            // keep "manioc" for display
        product = frenchToEnglish[p];   // store "cassava" for DB
        continue;
      }

      if (stopWords.includes(p)) continue;
      if (p.length > 2) {
        productOriginal = p;
        product = p;
      }
    }

    // ── Fix 3: Smart default unit per product ─────────────
    if (!unit) {
      unit = this.defaultUnitForProduct(product ?? productOriginal ?? '');
    }

    return { product, productOriginal, quantity, unit };
  }

  // ─── Smart default unit based on product type ─────────────
  defaultUnitForProduct(product: string): string {
    const lower = product.toLowerCase();

    // Sold by crate
    const byCrate = ['tomatoes', 'tomate', 'tomato', 'pepper', 'piment', 'eggplant', 'aubergine', 'cucumber', 'concombre', 'okra', 'gombo'];
    if (byCrate.some((p) => lower.includes(p))) return 'crates';

    // Sold by kg
    const byKg = ['garlic', 'ail', 'onion', 'oignon', 'ginger', 'gingembre', 'groundnuts', 'arachide', 'pepper'];
    if (byKg.some((p) => lower.includes(p))) return 'kg';

    // Sold by bunch/régime
    const byBunch = ['plantain', 'banana', 'banane'];
    if (byBunch.some((p) => lower.includes(p))) return 'bunches';

    // Sold by litre
    const byLitre = ['palm oil', 'palme', 'oil', 'huile', 'milk', 'lait'];
    if (byLitre.some((p) => lower.includes(p))) return 'litres';

    // Default
    return 'bags';
  }

  // ─────────────────────────────────────────────────────────
  // 6. DOWNLOAD AUDIO from Meta CDN
  // ─────────────────────────────────────────────────────────
  private downloadFile(url: string, accessToken: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https
        .get(url, { headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        })
        .on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
  }

  // ─────────────────────────────────────────────────────────
  // 7. REPLY TEMPLATES — 3 languages
  // ─────────────────────────────────────────────────────────
  reply(
    key:  string,
    lang: Language,
    data: Record<string, string | number> = {},
  ): string {
    const t        = this.templates();
    const template = t[key];
    if (!template) return t['unknown_command'][lang];

    let msg = template[lang] ?? template['english'];

    // Replace ${variable} placeholders
    Object.entries(data).forEach(([k, v]) => {
      msg = msg.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));
    });

    return msg;
  }

  // ─────────────────────────────────────────────────────────
  // 7b. BUTTON CONFIGURATIONS — for WhatsApp interactive
  // ─────────────────────────────────────────────────────────
  getButtons(key: string, lang: Language): { id: string; title: string }[] | null {
    const buttons = this.buttonConfigs();
    const config = buttons[key];
    if (!config) return null;
    return config[lang] ?? config['english'] ?? null;
  }

  private buttonConfigs(): Record<string, Record<Language, { id: string; title: string }[]>> {
    return {
      welcome: {
        english: [
          { id: 'role_farmer', title: '👨‍🌾 Farmer' },
          { id: 'role_buyer', title: '🏪 Buyer' },
        ],
        french: [
          { id: 'role_farmer', title: '👨‍🌾 Agriculteur' },
          { id: 'role_buyer', title: '🏪 Acheteur' },
        ],
        pidgin: [
          { id: 'role_farmer', title: '👨‍🌾 Farmer' },
          { id: 'role_buyer', title: '🏪 Buyer' },
        ],
      },
      price_suggestion: {
        english: [
          { id: 'price_accept', title: '✅ Accept Price' },
          { id: 'price_custom', title: '✏️ Set Custom' },
        ],
        french: [
          { id: 'price_accept', title: '✅ Accepter' },
          { id: 'price_custom', title: '✏️ Prix personnalisé' },
        ],
        pidgin: [
          { id: 'price_accept', title: '✅ Accept am' },
          { id: 'price_custom', title: '✏️ Set your price' },
        ],
      },
      match_found_farmer: {
        english: [
          { id: 'match_yes', title: '✅ Yes, I\'m interested!' },
          { id: 'match_no', title: '❌ No, thanks' },
        ],
        french: [
          { id: 'match_yes', title: '✅ Oui, je suis intéressé!' },
          { id: 'match_no', title: '❌ Non, merci' },
        ],
        pidgin: [
          { id: 'match_yes', title: '✅ Yes, I wan sell' },
          { id: 'match_no', title: '❌ No, thanks' },
        ],
      },
      ask_language: {
        english: [
          { id: 'lang_english', title: '🇬🇧 English' },
          { id: 'lang_french', title: '🇫🇷 Français' },
          { id: 'lang_pidgin', title: '🇳🇬 Pidgin' },
        ],
        french: [
          { id: 'lang_english', title: '🇬🇧 English' },
          { id: 'lang_french', title: '🇫🇷 Français' },
          { id: 'lang_pidgin', title: '🇳🇬 Pidgin' },
        ],
        pidgin: [
          { id: 'lang_english', title: '🇬🇧 English' },
          { id: 'lang_french', title: '🇫🇷 Français' },
          { id: 'lang_pidgin', title: '🇳🇬 Pidgin' },
        ],
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // 7c. CHECK IF MESSAGE SHOULD USE BUTTONS
  // ─────────────────────────────────────────────────────────
  shouldUseButtons(key: string): boolean {
    const buttonKeys = ['welcome', 'price_suggestion', 'match_found_farmer', 'ask_language'];
    return buttonKeys.includes(key);
  }

  // ─────────────────────────────────────────────────────────
  // 7d. ENHANCED REPLY — returns text + optional buttons
  // ─────────────────────────────────────────────────────────
  buildReply(
    key: string,
    lang: Language,
    data: Record<string, string | number> = {},
  ): { text: string; buttons?: { id: string; title: string }[] } {
    const text = this.reply(key, lang, data);
    const buttons = this.shouldUseButtons(key) ? this.getButtons(key, lang) ?? undefined : undefined;
    return { text, buttons };
  }

  // ─────────────────────────────────────────────────────────
  // 8. ALL MESSAGE TEMPLATES — Enhanced with emojis & human tone
  // ─────────────────────────────────────────────────────────
  private templates(): Record<string, Record<Language, string>> {
    return {
      welcome: {
        english: `🌟 *Welcome to AgroLink!*\n\nHi there! 👋 I'm here to help you buy or sell fresh produce directly!\n\nAre you a:\n👨‍🌾 Farmer (I grow produce and want to sell)\n🏪 Buyer (I want to buy produce)\n\n_Just tap your choice below or reply with 1 or 2_`,
        french:  `🌟 *Bienvenue sur AgroLink!*\n\nSalut! 👋 Je suis là pour vous aider à acheter ou vendre des produits frais!\n\nÊtes-vous:\n👨‍🌾 Agriculteur (je cultive et veux vendre)\n🏪 Acheteur (je veux acheter)\n\n_Tapez 1 ou 2, ou utilisez les boutons_`,
        pidgin:  `🌟 *Welcome for AgroLink!*\n\nHi there! 👋 I dey here to help you buy or sell fresh things!\n\nYou be:\n👨‍🌾 Farmer (I get things wey I want sell)\n🏪 Buyer (I want buy thing)\n\n_Send 1 or 2, or tap the buttons_`,
      },
      ask_name: {
        english: `👤 Sure! What should I call you?\n\n_Just send me your name_ 👇`,
        french:  `👤 Bien! Comment vous appelez-vous?\n\n_Envoyez-moi votre nom_ 👇`,
        pidgin:  `👤 Ok! Wetin name you go like?\n\n_Send me your name_ 👇`,
      },
      ask_language: {
        english: `🌐 Please select your language:`,
        french:  `🌐 Veuillez choisir votre langue:`,
        pidgin:  `🌐 Choose your language:`,
      },
      ask_location: {
        english: `📍 What is your location?\n(e.g. Yaoundé, Douala, Bafoussam)`,
        french:  `📍 Quelle est votre localité?\n(ex: Yaoundé, Douala, Bafoussam)`,
        pidgin:  `📍 For which side you dey?\n(e.g. Yaoundé, Douala, Bafoussam)`,
      },
      ask_produces: {
        english: `🌱 What do you grow?\nList products separated by commas.\n\nExample: maize, cassava, tomatoes`,
        french:  `🌱 Qu'est-ce que vous cultivez?\nListez les produits séparés par des virgules.\n\nExemple: maïs, manioc, tomates`,
        pidgin:  `🌱 Wetin you dey farm?\nSeparate am with comma.\n\nExample: maize, cassava, tomatoes`,
      },
      ask_business: {
        english: `🏪 What is your business name?`,
        french:  `🏪 Quel est le nom de votre entreprise?`,
        pidgin:  `🏪 Wetin be your business name?`,
      },
      ask_needs: {
        english: `🛒 What products do you need?\nSeparate by commas.\n\nExample: maize, tomatoes`,
        french:  `🛒 Quels produits cherchez-vous?\nSéparez par des virgules.\n\nExemple: maïs, tomates`,
        pidgin:  `🛒 Wetin you dey find?\nSeparate am with comma.\n\nExample: maize, tomatoes`,
      },
      registered_farmer: {
        english: `✅ *Registered as Farmer!*\n\nWelcome \${name} 👨‍🌾\n\nYou can now list your produce:\n*SELL maize 10 bags*\n\nType HELP for all options.`,
        french:  `✅ *Enregistré comme Agriculteur!*\n\nBienvenue \${name} 👨‍🌾\n\nVous pouvez maintenant lister vos produits:\n*VENDRE maïs 10 sacs*\n\nTapez AIDE pour toutes les options.`,
        pidgin:  `✅ *You don register as Farmer!*\n\nWelcome \${name} 👨‍🌾\n\nYou fit now list your things:\n*SELL maize 10 bags*\n\nType HELP for all options.`,
      },
      registered_buyer: {
        english: `✅ *Registered as Buyer!*\n\nWelcome \${name} 🏪\n\nYou can now search for produce:\n*BUY maize 20 bags*\n\nType HELP for all options.`,
        french:  `✅ *Enregistré comme Acheteur!*\n\nBienvenue \${name} 🏪\n\nVous pouvez maintenant chercher des produits:\n*ACHETER maïs 20 sacs*\n\nTapez AIDE pour toutes les options.`,
        pidgin:  `✅ *You don register as Buyer!*\n\nWelcome \${name} 🏪\n\nYou fit now find farm things:\n*BUY maize 20 bags*\n\nType HELP for all options.`,
      },
      voice_received: {
        english: `🎤 Voice note received.\nI heard: *"\${text}"*\n\nProcessing your request...`,
        french:  `🎤 Message vocal reçu.\nJ'ai entendu: *"\${text}"*\n\nTraitement en cours...`,
        pidgin:  `🎤 I hear your voice.\nYou talk: *"\${text}"*\n\nI dey process am...`,
      },
      voice_failed: {
        english: `❌ Could not understand your voice note.\nPlease type your message instead.`,
        french:  `❌ Message vocal non compris.\nVeuillez taper votre message.`,
        pidgin:  `❌ I no hear the voice well.\nAbeg type your message.`,
      },
      price_suggestion: {
        // Note: pass product as the display name (original language)
        // e.g. French user → "manioc" not "cassava"
        english: `📊 *\${product} Market Prices*\n\nMin: \${min}\nAvg: \${avg}\nMax: \${max}\n\n✨ Suggested: *\${suggested}*\n\n1️⃣ Accept suggested price\n2️⃣ Set custom price\n\nReply 1 or 2`,
        french:  `📊 *Prix du \${product}*\n\nMin: \${min}\nMoy: \${avg}\nMax: \${max}\n\n✨ Suggéré: *\${suggested}*\n\n1️⃣ Accepter le prix suggéré\n2️⃣ Définir un prix personnalisé\n\nRépondez 1 ou 2`,
        pidgin:  `📊 *\${product} Price*\n\nSmall: \${min}\nNormal: \${avg}\nBig: \${max}\n\n✨ We suggest: *\${suggested}*\n\n1️⃣ Accept suggested price\n2️⃣ Set your own price\n\nSend 1 or 2`,
      },
      listing_confirmed: {
        english: `✅ *Listing Created!*\n\n🌽 \${product}\n📦 \${quantity} \${unit}\n💰 \${price}\n\nBuyers will be notified.`,
        french:  `✅ *Annonce créée!*\n\n🌽 \${product}\n📦 \${quantity} \${unit}\n💰 \${price}\n\nLes acheteurs seront notifiés.`,
        pidgin:  `✅ *Listing don create!*\n\n🌽 \${product}\n📦 \${quantity} \${unit}\n💰 \${price}\n\nBuyers go see am.`,
      },
      match_found_farmer: {
        english: `🔔 *New Buyer Interest!*\n\nA buyer in *\${location}* wants:\n🌽 \${product}\n📦 \${quantity} \${unit}\n\nInterested? Reply *YES* or *NO*`,
        french:  `🔔 *Nouvel Acheteur!*\n\nUn acheteur à *\${location}* cherche:\n🌽 \${product}\n📦 \${quantity} \${unit}\n\nIntéressé? Répondez *OUI* ou *NON*`,
        pidgin:  `🔔 *New Buyer Dey!*\n\nOne buyer for *\${location}* wan:\n🌽 \${product}\n📦 \${quantity} \${unit}\n\nYou wan sell? Reply *YES* or *NO*`,
      },
      connected: {
        english: `✅ *Deal Confirmed!*\n\nChat directly with your contact:\n👇 \${link}\n\n📋 Deal details:\n🌽 \${product}\n📦 \${quantity} \${unit}\n💰 \${price}`,
        french:  `✅ *Accord Confirmé!*\n\nDiscutez directement avec votre contact:\n👇 \${link}\n\n📋 Détails:\n🌽 \${product}\n📦 \${quantity} \${unit}\n💰 \${price}`,
        pidgin:  `✅ *Deal Don Set!*\n\nGo chat with your person:\n👇 \${link}\n\n📋 Deal details:\n🌽 \${product}\n📦 \${quantity} \${unit}\n💰 \${price}`,
      },
      unknown_command: {
        english: `❓ I didn't understand that.\n\nTry:\n• SELL maize 10 bags\n• BUY maize 20 bags\n• Type *HELP* for all options`,
        french:  `❓ Je n'ai pas compris.\n\nEssayez:\n• VENDRE maïs 10 sacs\n• ACHETER maïs 20 sacs\n• Tapez *AIDE* pour toutes les options`,
        pidgin:  `❓ I no understand.\n\nTry:\n• SELL maize 10 bags\n• BUY maize 20 bags\n• Type *HELP* for all options`,
      },
    };
  }
}