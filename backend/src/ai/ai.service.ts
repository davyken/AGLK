import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import * as fs from 'fs';
import * as path from 'path';
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
  private readonly groq: Groq;

  constructor(private readonly config: ConfigService) {
    this.groq = new Groq({
      apiKey: this.config.get<string>('GROQ_API_KEY'),
    });
  }

  // ─── 1. Parse intent — Groq first, regex fallback ─────────
  async parseIntent(message: string): Promise<ParsedIntent> {
    try {
      const completion = await this.groq.chat.completions.create({
        model: 'llama3-8b-8192', // free, fast
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: `You are a parser for an agricultural marketplace bot in Cameroon.
Return ONLY a JSON object, nothing else.

Detect:
1. intent: one of [register, sell, buy, price, help, yes, no, unknown]
2. language: one of [english, french, pidgin]
3. product: crop name in english lowercase (maïs→maize, tomate→tomatoes, manioc→cassava)
4. quantity: number if mentioned, else null
5. unit: bags/kg/tonnes if mentioned, default "bags"
6. price: price number if mentioned, else null

Pidgin: "I get maize", "I wan sell", "I dey find"
French: "j'ai du maïs", "je veux acheter", "quel est le prix"
Yes: YES, Oui, Yes na, Na so
No: NO, Non, No be dat

Return: {"intent":"","language":"","product":null,"quantity":null,"unit":"bags","price":null}`,
          },
          { role: 'user', content: message },
        ],
      });

      const text   = completion.choices[0]?.message?.content ?? '{}';
      const clean  = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return { ...parsed, raw: message };

    } catch (err: any) {
      // ── Groq failed → use smart regex fallback ────────────
      // Log the REAL error so we can fix it
      this.logger.warn(`Groq failed [${err?.status ?? err?.code ?? 'unknown'}]: ${err?.message ?? err}`);
      return this.regexParse(message);
    }
  }

  // ─── 2. Regex fallback — works with zero API calls ────────
  // Handles basic English, French, Pidgin commands reliably
  private regexParse(message: string): ParsedIntent {
    const raw   = message;
    const lower = message.toLowerCase().trim();
    const upper = message.toUpperCase().trim();

    // ── Language detection ─────────────────────────────────
    const frenchWords  = ['bonjour', 'salut', 'vendre', 'acheter', 'maïs', 'je ', 'du ', "j'ai", 'prix', 'sacs', 'oui', 'non'];
    const pidginWords  = ['i get', 'i wan', 'i dey', 'na so', 'abeg', 'wetin', 'plenty', 'dem', 'for sell', 'for buy'];
    const isFrench     = frenchWords.some((w) => lower.includes(w));
    const isPidgin     = pidginWords.some((w) => lower.includes(w));
    const language: Language = isFrench ? 'french' : isPidgin ? 'pidgin' : 'english';

    // ── YES / NO ───────────────────────────────────────────
    if (/^(yes|oui|yes na|na so|yep|yah|ok|okay|d'accord)$/i.test(lower)) {
      return { intent: 'yes', language, raw };
    }
    if (/^(no|non|nope|no be dat|non merci)$/i.test(lower)) {
      return { intent: 'no', language, raw };
    }

    // ── HELP ───────────────────────────────────────────────
    if (/^(help|aide|aidez|options)$/i.test(lower)) {
      return { intent: 'help', language, raw };
    }

    // ── REGISTER (greeting) ───────────────────────────────
    if (/^(hi|hello|bonjour|salut|hey|start|begin|helo)$/i.test(lower)) {
      return { intent: 'register', language, raw };
    }

    // ── SELL ───────────────────────────────────────────────
    const sellPattern = /^(sell|vendre|vend|for sell|i get .+ for sell|i wan sell)/i;
    if (sellPattern.test(lower) || lower.includes('for sell') || lower.includes('wan sell')) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      return { intent: 'sell', language, product, quantity, unit, raw };
    }

    // ── BUY ────────────────────────────────────────────────
    const buyPattern = /^(buy|acheter|achet|for buy|i wan buy|i dey find|je veux acheter|je cherche)/i;
    if (buyPattern.test(lower) || lower.includes('wan buy') || lower.includes('dey find')) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      return { intent: 'buy', language, product, quantity, unit, raw };
    }

    // ── PRICE ──────────────────────────────────────────────
    if (/^(price|prix|how much|combien|quel est le prix)/i.test(lower)) {
      const { product } = this.extractProductQty(lower);
      return { intent: 'price', language, product, raw };
    }

    // ── Numbers (reply during flow: "1", "2", price) ───────
    if (/^\d+$/.test(lower.trim())) {
      return { intent: 'unknown', language, price: parseInt(lower.trim(), 10), raw };
    }

    return { intent: 'unknown', language, raw };
  }

  // ─── Extract product + quantity from message ──────────────
  private extractProductQty(text: string): { product?: string; quantity?: number; unit: string } {
    const unitWords   = ['bags', 'bag', 'sacs', 'sac', 'kg', 'tonnes', 'tonne', 'crates', 'crate'];
    const ignoreWords = ['sell', 'buy', 'vendre', 'acheter', 'i', 'get', 'wan', 'dey', 'for', 'have', 'je', 'du', "j'ai", 'la', 'le', 'les', 'want', 'need', 'plenty', 'some'];

    // Normalize French products to English
    const frenchMap: Record<string, string> = {
      'maïs': 'maize', 'mais': 'maize', 'tomate': 'tomatoes', 'tomates': 'tomatoes',
      'manioc': 'cassava', 'plantain': 'plantain', 'igname': 'yam', 'ignames': 'yam',
      'poisson': 'fish', 'poulet': 'chicken', 'porc': 'pork', 'bœuf': 'beef',
    };

    const parts    = text.toLowerCase().split(/\s+/);
    let product: string | undefined;
    let quantity: number | undefined;
    let unit       = 'bags';

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];

      // Check unit
      if (unitWords.includes(p)) { unit = p; continue; }

      // Check quantity
      if (/^\d+$/.test(p)) { quantity = parseInt(p, 10); continue; }

      // Check French product normalization
      if (frenchMap[p]) { product = frenchMap[p]; continue; }

      // Skip ignore words
      if (ignoreWords.includes(p)) continue;

      // Everything else is likely the product
      if (p.length > 2) product = p;
    }

    return { product, quantity, unit };
  }

  // ─── 3. Transcribe voice note via Groq Whisper ────────────
  async transcribeVoiceNote(
    mediaUrl:    string,
    accessToken: string,
  ): Promise<{ text: string; language: Language }> {
    const tmpPath = path.join('/tmp', `voice_${Date.now()}.ogg`);
    try {
      await this.downloadFile(mediaUrl, accessToken, tmpPath);

      const transcription = await this.groq.audio.transcriptions.create({
        file:  fs.createReadStream(tmpPath),
        model: 'whisper-large-v3-turbo', // free on Groq
      });

      const text   = transcription.text ?? '';
      const parsed = await this.parseIntent(text);
      return { text, language: parsed.language };
    } catch (err) {
      this.logger.error('Voice transcription failed', err);
      return { text: '', language: 'english' };
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  // ─── 4. Download audio from Meta CDN ─────────────────────
  private downloadFile(url: string, accessToken: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
  }

  // ─── 5. Reply in correct language ─────────────────────────
  reply(
    templateKey: string,
    language:    Language,
    data:        Record<string, string | number> = {},
  ): string {
    const t       = this.templates();
    const template = t[templateKey];
    if (!template) return t['unknown_command'][language];

    let msg = template[language] ?? template['english'];

    Object.entries(data).forEach(([key, val]) => {
      msg = msg.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(val));
    });

    return msg;
  }

  // ─── 6. All message templates ─────────────────────────────
  private templates(): Record<string, Record<Language, string>> {
    return {
      welcome: {
        english: `👋 Welcome to AgroLink!\n\nAre you a:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)\n\nReply 1 or 2`,
        french:  `👋 Bienvenue sur AgroLink!\n\nÊtes-vous:\n1️⃣ Agriculteur (je vends)\n2️⃣ Acheteur (j'achète)\n\nRépondez 1 ou 2`,
        pidgin:  `👋 Welcome for AgroLink!\n\nYou be:\n1️⃣ Farmer (I dey sell)\n2️⃣ Buyer (I dey buy)\n\nSend 1 or 2`,
      },
      ask_name: {
        english: `What is your full name?`,
        french:  `Quel est votre nom complet?`,
        pidgin:  `Wetin be your full name?`,
      },
      ask_location: {
        english: `📍 What is your location? (e.g. Yaoundé, Bafoussam)`,
        french:  `📍 Quelle est votre localité? (ex: Yaoundé, Bafoussam)`,
        pidgin:  `📍 For which side you dey? (e.g. Yaoundé, Bafoussam)`,
      },
      ask_produces: {
        english: `🌱 What do you grow? Separate by commas.\nExample: maize, cassava, tomatoes`,
        french:  `🌱 Qu'est-ce que vous cultivez? Séparez par virgules.\nExemple: maïs, manioc, tomates`,
        pidgin:  `🌱 Wetin you dey farm? Separate am with comma.\nExample: maize, cassava, tomatoes`,
      },
      ask_business: {
        english: `🏪 What is your business name?`,
        french:  `🏪 Quel est le nom de votre entreprise?`,
        pidgin:  `🏪 Wetin be your business name?`,
      },
      ask_needs: {
        english: `🛒 What products do you need? Separate by commas.`,
        french:  `🛒 Quels produits cherchez-vous? Séparez par virgules.`,
        pidgin:  `🛒 Wetin you dey find? Separate am with comma.`,
      },
      registered_farmer: {
        english: `✅ Registered as Farmer!\n\nWelcome \${name} 👨‍🌾\n\nTo list produce:\nSELL maize 10 bags\n\nType HELP for options.`,
        french:  `✅ Enregistré comme Agriculteur!\n\nBienvenue \${name} 👨‍🌾\n\nPour lister vos produits:\nVENDRE maïs 10 sacs\n\nTapez AIDE pour options.`,
        pidgin:  `✅ You don register as Farmer!\n\nWelcome \${name} 👨‍🌾\n\nFor list your things:\nSELL maize 10 bags\n\nType HELP for options.`,
      },
      registered_buyer: {
        english: `✅ Registered as Buyer!\n\nWelcome \${name} 🏪\n\nTo find produce:\nBUY maize 20 bags\n\nType HELP for options.`,
        french:  `✅ Enregistré comme Acheteur!\n\nBienvenue \${name} 🏪\n\nPour trouver des produits:\nACHETER maïs 20 sacs\n\nTapez AIDE pour options.`,
        pidgin:  `✅ You don register as Buyer!\n\nWelcome \${name} 🏪\n\nFor find farm things:\nBUY maize 20 bags\n\nType HELP for options.`,
      },
      voice_received: {
        english: `🎤 I heard: "\${text}"\n\nProcessing...`,
        french:  `🎤 J'ai entendu: "\${text}"\n\nTraitement...`,
        pidgin:  `🎤 I hear: "\${text}"\n\nI dey process am...`,
      },
      voice_failed: {
        english: `❌ Could not understand voice note. Please type your message.`,
        french:  `❌ Message vocal non compris. Veuillez taper votre message.`,
        pidgin:  `❌ I no hear the voice well. Abeg type your message.`,
      },
      price_suggestion: {
        english: `📊 *\${product} Market Prices*\n\nMin: \${min}\nAvg: \${avg}\nMax: \${max}\n\nSuggested: \${suggested}\n\nReply with your price or type AUTO`,
        french:  `📊 *Prix du \${product}*\n\nMin: \${min}\nMoy: \${avg}\nMax: \${max}\n\nSuggéré: \${suggested}\n\nRépondez avec votre prix ou tapez AUTO`,
        pidgin:  `📊 *\${product} Price*\n\nSmall: \${min}\nNormal: \${avg}\nBig: \${max}\n\nWe suggest: \${suggested}\n\nSend your price or type AUTO`,
      },
      listing_confirmed: {
        english: `✅ \${product} (\${quantity} \${unit}) listed at \${price}!\nBuyers will be notified.`,
        french:  `✅ \${product} (\${quantity} \${unit}) listé à \${price}!\nLes acheteurs seront notifiés.`,
        pidgin:  `✅ \${product} (\${quantity} \${unit}) don list for \${price}!\nBuyers go see am.`,
      },
      match_found_farmer: {
        english: `🔔 A buyer in \${location} wants \${product} (\${quantity} \${unit}).\n\nInterested? Reply YES or NO`,
        french:  `🔔 Un acheteur à \${location} cherche \${product} (\${quantity} \${unit}).\n\nIntéressé? Répondez OUI ou NON`,
        pidgin:  `🔔 One buyer for \${location} wan \${product} (\${quantity} \${unit}).\n\nYou wan sell? Reply YES or NO`,
      },
      connected: {
        english: `✅ Deal confirmed!\n\nChat directly here 👇\n\${link}\n\nProduct: \${quantity} \${unit} of \${product} @ \${price}`,
        french:  `✅ Accord confirmé!\n\nDiscutez directement ici 👇\n\${link}\n\nProduit: \${quantity} \${unit} de \${product} à \${price}`,
        pidgin:  `✅ Deal don set!\n\nGo chat here 👇\n\${link}\n\nThing: \${quantity} \${unit} \${product} for \${price}`,
      },
      unknown_command: {
        english: `❓ I didn't understand that.\n\nTry:\nSELL maize 10 bags\nBUY maize 20 bags\nType HELP for options.`,
        french:  `❓ Je n'ai pas compris.\n\nEssayez:\nVENDRE maïs 10 sacs\nACHETER maïs 20 sacs\nTapez AIDE pour options.`,
        pidgin:  `❓ I no understand.\n\nTry:\nSELL maize 10 bags\nBUY maize 20 bags\nType HELP for options.`,
      },
    };
  }
}