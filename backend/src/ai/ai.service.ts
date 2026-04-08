import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as https from 'https';
import { LanguageDetectionService } from './language-detection.service';
import type { Language } from './language-detection.service';
import { ResponseGenerationService } from './response-generation.service';

// Re-export Language from the canonical source so existing callers keep working
export type { Language } from './language-detection.service';

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

  constructor(
    private readonly config:      ConfigService,
    private readonly langDetect:  LanguageDetectionService,
    private readonly responseGen: ResponseGenerationService,
  ) {
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
  // 2. DETECT LANGUAGE
  // Async — delegates to LanguageDetectionService (LLM + statistical)
  // Falls back to 'english' when detection returns 'unknown'
  // ─────────────────────────────────────────────────────────
  async detectLanguage(text: string): Promise<Language> {
    const result = await this.langDetect.detect(text);
    // Treat 'unknown' as English so the bot always has a language to work with
    return result.language === 'unknown' ? 'english' : result.language;
  }

  /**
   * Synchronous statistical detector — zero API calls.
   * Used internally by regexFallback and in performance-critical paths
   * where awaiting the LLM is not viable.
   * Note: reliably detects French only; cannot distinguish Pidgin from English.
   */
  detectLanguageSync(text: string): Language {
    const result = this.langDetect.detectStatistical(text);
    return result.language === 'unknown' ? 'english' : result.language as Language;
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
      // Use sync detector here — we're inside a try/finally and can't await
      const language = this.detectLanguageSync(text);

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
    // Use sync detector — regexFallback is a sync escape hatch
    const language = this.detectLanguageSync(lower);

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
  // 7. GENERATE REPLY — delegates to ResponseGenerationService
  // Async: LLM-generated, natural, no hardcoded translation tables.
  // Falls back to safe minimal templates if LLM is unavailable.
  // ─────────────────────────────────────────────────────────
  async reply(
    key:  string,
    lang: Language,
    data: Record<string, string | number> = {},
  ): Promise<string> {
    return this.responseGen.generate(key, lang, data);
  }

  // ─────────────────────────────────────────────────────────
  // REMOVED: hardcoded templates() method
  // All responses are now dynamically generated by ResponseGenerationService.
  // Fallback templates live in ResponseGenerationService.fallback().
  // ─────────────────────────────────────────────────────────

  // ── Kept for reference during migration — delete when all callers migrated ──
  private _legacyTemplates(): Record<string, Record<Language, string>> {
    return {
      welcome: {
        english: `👋 Welcome to AgroLink!\n\nAre you a:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)\n\nReply 1 or 2`,
        french:  `👋 Bienvenue sur AgroLink!\n\nÊtes-vous:\n1️⃣ Agriculteur (je vends)\n2️⃣ Acheteur (j'achète)\n\nRépondez 1 ou 2`,
        pidgin:  `👋 Welcome for AgroLink!\n\nYou be:\n1️⃣ Farmer (I dey sell)\n2️⃣ Buyer (I dey buy)\n\nSend 1 or 2`,
      },
      ask_name: {
        english: `👤 What is your full name?`,
        french:  `👤 Quel est votre nom complet?`,
        pidgin:  `👤 Wetin be your full name?`,
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