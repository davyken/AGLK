import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AiService } from '../ai/ai.service';

type Language = 'english' | 'french' | 'pidgin';

@Injectable()
export class RegistrationFlowService {
  constructor(
    private readonly usersService: UsersService,
    private readonly aiService: AiService,
  ) {}

  // ─── Main entry point ─────────────────────────────────────────
  // Returns the bot reply, or null if the user is already registered.
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string | null> {
    const user = await this.usersService.findByPhone(phone);

    // Fully registered — hand off to main bot flow
    if (user?.conversationState === 'REGISTERED') {
      await this.usersService.updateChannel(phone, channel);
      return null;
    }

    // ── Brand-new user: detect language from first message ────────
    if (!user) {
      const lang: Language = await this.aiService.detectLanguage(text);
      return this.handleNewUser(phone, text, channel, lang);
    }

    // ── Returning mid-registration user ───────────────────────────
    // Use their saved language. Only re-detect on long messages (≥8 chars,
    // ≥2 words) so that short replies like "Henry" or "10" don't flip the language.
    const savedLang: Language = (user as any).language ?? 'english';
    const tokens = text.trim().split(/\s+/);
    const longEnough = text.trim().length >= 8 && tokens.length >= 2;

    let activeLang = savedLang;
    if (longEnough) {
      const detectedLang: Language = await this.aiService.detectLanguage(text);
      if (detectedLang !== 'english' && detectedLang !== savedLang) {
        activeLang = detectedLang;
        await this.usersService.updateLanguage(phone, activeLang);
      }
    }

    await this.usersService.updateChannel(phone, channel);
    return this.resume(phone, text.trim(), user, activeLang);
  }

  // ─── New user: extract-first onboarding ───────────────────────
  // Parses name, role, location, and intent from the very first message.
  // Only asks for fields that were NOT already provided.
  private async handleNewUser(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    const parsed = await this.aiService.parseIntent(text);

    // Build initial user record with whatever we already know
    const updates: Record<string, any> = {
      name: parsed.name ?? 'unknown',
      role: parsed.role ?? 'farmer', // required field — default until confirmed
      location: 'unknown',
    };
    if (parsed.location) updates.location = parsed.location;

    // If the user already mentioned a product (e.g. "I want to buy cabbage"),
    // save it as an initial need/produce so we never ask for it again.
    if (parsed.product) {
      if (parsed.role === 'buyer') {
        updates.needs = [parsed.product];
      } else if (parsed.role === 'farmer') {
        updates.produces = [parsed.product];
      }
    }

    // Determine which state to start at (skip anything we already have).
    // Pass the product so buyers who already specified what they want
    // skip straight to REGISTERED instead of AWAITING_BUSINESS/NEEDS.
    const nextState = this.determineFirstMissingState(
      parsed.role ?? null,
      parsed.name ?? null,
      parsed.location ?? null,
      parsed.product ?? null,
    );
    updates.conversationState = nextState;

    await this.usersService.createStub(phone, channel, lang);
    if (Object.keys(updates).length) {
      await this.usersService.update(phone, updates);
    }

    return this.generateFirstResponse(parsed, lang, nextState);
  }

  // ─── Determine which state comes first given what we know ─────
  private determineFirstMissingState(
    role: 'farmer' | 'buyer' | 'both' | null,
    name: string | null,
    location: string | null,
    product: string | null = null,
  ): string {
    if (!role) return 'AWAITING_ROLE';
    if (!name) return 'AWAITING_NAME';
    if (!location) return 'AWAITING_LOCATION';

    // Buyer with a product already specified → registration complete.
    // Business name is optional — we never force it.
    if (role === 'buyer' && product) return 'REGISTERED';

    if (role === 'farmer' || role === 'both') return 'AWAITING_PRODUCES';

    // Buyer without a product → ask what they need (skip optional business name)
    return 'AWAITING_NEEDS';
  }

  // ─── Generate the first bot message for a new user ────────────
  // Acknowledges extracted entities, asks only for the first missing field.
  // If all required fields are present (nextState = REGISTERED), confirms and welcomes.
  private async generateFirstResponse(
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
    nextState: string,
  ): Promise<string> {
    const hasName = !!parsed.name;
    const hasRole = !!parsed.role;
    const hasLocation = !!parsed.location;
    const hasProduct = !!parsed.product;

    // ── All required fields present — registration complete ───────
    if (nextState === 'REGISTERED') {
      return this.buildRegistrationComplete(parsed, lang);
    }

    // ── Partial extraction: acknowledge what we know, ask for ONE missing field
    if (hasName || hasRole || hasLocation || hasProduct) {
      const parts: string[] = [];

      if (lang === 'french') {
        if (hasName) parts.push(`Enchanté, *${parsed.name}* !`);
        if (hasRole)
          parts.push(`Vous êtes *${parsed.role === 'farmer' ? 'agriculteur' : 'acheteur'}*.`);
        if (hasLocation) parts.push(`Vous êtes à *${parsed.location}*.`);

        if (nextState === 'AWAITING_ROLE')
          parts.push(`Vous êtes agriculteur, acheteur, ou les deux ?\n\n1️⃣ Agriculteur\n2️⃣ Acheteur\n3️⃣ Les deux`);
        else if (nextState === 'AWAITING_NAME')
          parts.push(`Quel est votre nom complet ?`);
        else if (nextState === 'AWAITING_LOCATION')
          parts.push(`Dans quelle ville êtes-vous ?`);
        else if (nextState === 'AWAITING_PRODUCES')
          parts.push(`Quels produits cultivez-vous ? (ex: maïs, manioc, tomates)`);
        else if (nextState === 'AWAITING_NEEDS')
          parts.push(`Quels produits voulez-vous acheter ? (ex: maïs, tomates)`);
      } else if (lang === 'pidgin') {
        if (hasName) parts.push(`How you dey, *${parsed.name}*!`);
        if (hasRole)
          parts.push(`You be *${parsed.role === 'farmer' ? 'farmer' : 'buyer'}*.`);
        if (hasLocation) parts.push(`You dey *${parsed.location}*.`);

        if (nextState === 'AWAITING_ROLE')
          parts.push(
            `You be farmer, buyer, or both?\n\n1️⃣ Farmer\n2️⃣ Buyer\n3️⃣ For All`,
          );
        else if (nextState === 'AWAITING_NAME')
          parts.push(`Wetin be your full name?`);
        else if (nextState === 'AWAITING_LOCATION')
          parts.push(`For which town you dey?`);
        else if (nextState === 'AWAITING_PRODUCES')
          parts.push(`Wetin you dey farm? (e.g. maize, cassava)`);
        else if (nextState === 'AWAITING_NEEDS')
          parts.push(`Wetin you wan buy? (e.g. maize, tomatoes)`);
      } else {
        // English
        if (hasName) parts.push(`Nice to meet you, *${parsed.name}*!`);
        if (hasRole)
          parts.push(`Got it — you're a *${parsed.role === 'farmer' ? 'farmer' : 'buyer'}*.`);
        if (hasLocation) parts.push(`You're in *${parsed.location}*.`);

        if (nextState === 'AWAITING_ROLE')
          parts.push(`Are you a *farmer*, *buyer*, or *both*?\n\n1️⃣ Farmer\n2️⃣ Buyer\n3️⃣ Both`);
        else if (nextState === 'AWAITING_NAME')
          parts.push(`What is your full name?`);
        else if (nextState === 'AWAITING_LOCATION')
          parts.push(`Which city or town are you in?`);
        else if (nextState === 'AWAITING_PRODUCES')
          parts.push(`What crops do you grow? (e.g. maize, cassava, tomatoes)`);
        else if (nextState === 'AWAITING_NEEDS')
          parts.push(`What are you looking to buy? (e.g. maize, tomatoes, cassava)`);
      }
      return parts.join('\n');
    }

    // Nothing extracted — standard welcome
    return await this.aiService.reply('welcome', lang, {});
  }

  // ─── Build the registration-complete welcome message ─────────
  private async buildRegistrationComplete(
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
  ): Promise<string> {
    const role = parsed.role ?? 'buyer';
    const name = parsed.name ?? '';
    const location = parsed.location ?? '';
    const product = parsed.product ?? '';

    if (lang === 'french') {
      const roleLabel = role === 'farmer' ? 'agriculteur' : 'acheteur';
      let msg = `✅ Bienvenue${name ? `, *${name}*` : ''} ! Vous êtes enregistré comme *${roleLabel}*${location ? ` à *${location}*` : ''}.`;
      if (product) {
        msg += role === 'buyer'
          ? `\n\nJe cherche des agriculteurs qui vendent *${product}*...`
          : `\n\nVous pouvez maintenant lister votre *${product}* avec *VENDRE ${product} [quantité]*.`;
      }
      return msg;
    }

    if (lang === 'pidgin') {
      const roleLabel = role === 'farmer' ? 'farmer' : 'buyer';
      let msg = `✅ Welcome${name ? `, *${name}*` : ''}! You don register as *${roleLabel}*${location ? ` for *${location}*` : ''}.`;
      if (product) {
        msg += role === 'buyer'
          ? `\n\nI dey find farmers wey get *${product}* for you...`
          : `\n\nYou fit list your *${product}* with *SELL ${product} [qty]*.`;
      }
      return msg;
    }

    // English
    const roleLabel = role === 'farmer' ? 'farmer' : 'buyer';
    let msg = `✅ Welcome${name ? `, *${name}*` : ''}! You're registered as a *${roleLabel}*${location ? ` in *${location}*` : ''}.`;
    if (product) {
      msg += role === 'buyer'
        ? `\n\nLet me find farmers selling *${product}* near you...`
        : `\n\nYou can list your *${product}* with *SELL ${product} [quantity]*.`;
    }
    return msg;
  }

  // ─── Confirm extracted fields and ask for crops/business ──────
  private async generatePartialConfirm(
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
    nextState: string,
  ): Promise<string> {
    const role = parsed.role as string;
    const roleLabel =
      role === 'farmer'
        ? lang === 'french'
          ? 'agriculteur'
          : lang === 'pidgin'
            ? 'farmer'
            : 'farmer'
        : role === 'both'
          ? lang === 'french'
            ? 'agriculteur et acheteur'
            : lang === 'pidgin'
              ? 'farmer and buyer'
              : 'farmer and buyer'
          : lang === 'french'
            ? 'acheteur'
            : lang === 'pidgin'
              ? 'buyer'
              : 'buyer';

    if (lang === 'french') {
      const confirm =
        `Parfait${parsed.name ? `, *${parsed.name}*` : ''} !` +
        (parsed.location
          ? ` Vous êtes *${roleLabel}* à *${parsed.location}*.`
          : ` Vous êtes *${roleLabel}*.`);

      if (nextState === 'AWAITING_PRODUCES')
        return `${confirm}\n\nQuels produits cultivez-vous ? (ex: maïs, manioc, tomates)`;
      if (nextState === 'AWAITING_NEEDS')
        return `${confirm}\n\nQuels produits voulez-vous acheter ? (ex: maïs, tomates, manioc)`;
      return confirm;
    }

    if (lang === 'pidgin') {
      const confirm =
        `No wahala${parsed.name ? `, *${parsed.name}*` : ''} !` +
        (parsed.location
          ? ` You be *${roleLabel}* for *${parsed.location}*.`
          : ` You be *${roleLabel}*.`);

      if (nextState === 'AWAITING_PRODUCES')
        return `${confirm}\n\nWetin you dey farm? (e.g. maize, cassava, tomatoes)`;
      if (nextState === 'AWAITING_NEEDS')
        return `${confirm}\n\nWetin you wan buy? (e.g. maize, tomatoes, cassava)`;
      return confirm;
    }

    // English
    const confirm =
      `Great${parsed.name ? `, *${parsed.name}*` : ''}!` +
      (parsed.location
        ? ` You're a *${roleLabel}* in *${parsed.location}*.`
        : ` You're a *${roleLabel}*.`);

    if (nextState === 'AWAITING_PRODUCES')
      return `${confirm}\n\nWhat crops do you grow? (e.g. maize, cassava, tomatoes)`;
    if (nextState === 'AWAITING_NEEDS')
      return `${confirm}\n\nWhat are you looking to buy? (e.g. maize, tomatoes, cassava)`;
    return confirm;
  }

  // ─── Resume from saved state ───────────────────────────────────
  private async resume(
    phone: string,
    input: string,
    user: any,
    lang: Language,
  ): Promise<string> {
    const state: string = user.conversationState;

    // Warm resume — if user re-greeted mid-registration, remind them where they are
    const isGreeting =
      /^(hi|hello|bonjour|salut|bonsoir|hey|start|begin)$/i.test(input);
    if (isGreeting && state !== 'AWAITING_ROLE') {
      return this.buildWarmResumeMessage(user, lang);
    }

    // At each step, first try to extract all remaining fields from this message.
    // This lets someone send "I'm Paul in Douala" to fill two steps at once.
    const parsed = await this.aiService.parseIntent(input);

    switch (state) {
      case 'AWAITING_ROLE':
        return this.handleRole(phone, input, parsed, lang);
      case 'AWAITING_NAME':
        return this.handleName(phone, input, parsed, lang);
      case 'AWAITING_LOCATION':
        return this.handleLocation(phone, input, parsed, user, lang);
      case 'AWAITING_PRODUCES':
        return this.handleProduces(phone, input, lang);
      case 'AWAITING_BUSINESS':
        // Legacy state — treat the reply as the business name but don't block on it.
        // Move to AWAITING_NEEDS after storing (or skip it entirely).
        return this.handleBusiness(phone, input, lang, user);
      case 'AWAITING_NEEDS':
        return this.handleNeeds(phone, input, lang, user);
      default:
        return await this.aiService.reply('unknown_command', lang, {});
    }
  }

  // ─── Warm resume message ──────────────────────────────────────
  private buildWarmResumeMessage(user: any, lang: Language): string {
    const name = user.name && user.name !== 'unknown' ? user.name : null;
    const state: string = user.conversationState;

    const stateLabels: Record<string, Record<Language, string>> = {
      AWAITING_NAME: {
        english: 'your name',
        french: 'votre nom',
        pidgin: 'your name',
      },
      AWAITING_LOCATION: {
        english: 'your location',
        french: 'votre localité',
        pidgin: 'your town',
      },
      AWAITING_PRODUCES: {
        english: 'the crops you grow',
        french: 'vos cultures',
        pidgin: 'wetin you farm',
      },
      AWAITING_BUSINESS: {
        english: 'what products you need',
        french: 'les produits que vous cherchez',
        pidgin: 'wetin you dey find',
      },
      AWAITING_NEEDS: {
        english: 'which products you buy',
        french: 'vos besoins en produits',
        pidgin: 'wetin you dey find',
      },
    };

    const what = stateLabels[state]?.[lang] ?? 'a few details';

    if (lang === 'french') {
      return `Bon retour${name ? `, *${name}*` : ''} ! Vous étiez en train de vous inscrire — il reste juste *${what}*.\n\nQu'est-ce que c'est ?`;
    }
    if (lang === 'pidgin') {
      return `Welcome back${name ? `, *${name}*` : ''}! You dey register — we just need *${what}* from you. Go ahead!`;
    }
    return `Welcome back${name ? `, *${name}*` : ''}! You were registering — just need *${what}* from you. Go ahead!`;
  }

  // ─── Step 1: Role ──────────────────────────────────────────────
  private async handleRole(
    phone: string,
    input: string,
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
  ): Promise<string> {
    const lower = input.toLowerCase();

    const farmerKeywords = [
      '1',
      'farmer',
      'agriculteur',
      'sell',
      'vend',
      'farm',
      'cultiv',
      'grow',
      'i get',
      'i dey',
    ];
    const buyerKeywords = [
      '2',
      'buyer',
      'acheteur',
      'buy',
      'achet',
      'purchas',
      'need',
      'want',
    ];
    const bothKeywords = [
      '3',
      'both',
      'les deux',
      'all',
      'i get am and i want am',
    ];

    const isFarmer =
      parsed.role === 'farmer' || farmerKeywords.some((k) => lower.includes(k));
    const isBuyer =
      parsed.role === 'buyer' || buyerKeywords.some((k) => lower.includes(k));
    const isBoth =
      (parsed.role as string) === 'both' ||
      lower === '3' ||
      bothKeywords.some((k) => lower.includes(k));

    if (!isFarmer && !isBuyer && !isBoth) {
      const errors: Record<Language, string> = {
        english: `Please reply *1* for Farmer, *2* for Buyer, or *3* for Both.`,
        french: `Veuillez répondre *1* pour Agriculteur, *2* pour Acheteur, ou *3* pour Les deux.`,
        pidgin: `Send *1* if you be Farmer, *2* if you be Buyer, *3* if you be both.`,
      };
      return errors[lang];
    }

    const role = isBoth ? 'both' : isBuyer && !isFarmer ? 'buyer' : 'farmer';

    // Also store name/location if the user included them
    const updates: Record<string, any> = {
      role,
      conversationState: parsed.name ? 'AWAITING_LOCATION' : 'AWAITING_NAME',
    };
    if (parsed.name) updates.name = parsed.name;
    if (parsed.location) {
      updates.location = parsed.location;
      updates.conversationState =
        role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_NEEDS';
    }

    await this.usersService.update(phone, updates);

    // Skip ahead based on what we just extracted
    if (parsed.location) {
      return role === 'farmer'
        ? await this.askProduces(lang)
        : await this.askNeeds(lang);
    }
    if (parsed.name) {
      return await this.aiService.reply('ask_location', lang, {});
    }
    return await this.aiService.reply('ask_name', lang, {});
  }

  // ─── Step 2: Name ─────────────────────────────────────────────
  private async handleName(
    phone: string,
    input: string,
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
  ): Promise<string> {
    // Accept AI-extracted name or use raw input as name
    const name = parsed.name ?? input.trim();

    if (name.length < 2) {
      const errors: Record<Language, string> = {
        english: `Please enter your real full name.`,
        french: `Veuillez entrer votre vrai nom complet.`,
        pidgin: `Abeg put your real name.`,
      };
      return errors[lang];
    }

    const user = await this.usersService.findByPhone(phone);
    const role = user?.role ?? 'farmer';

    const updates: Record<string, any> = { name };

    // If location was also in this message, store it too
    if (parsed.location) {
      updates.location = parsed.location;
      updates.conversationState =
        role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_NEEDS';
      await this.usersService.update(phone, updates);
      return role === 'farmer'
        ? await this.askProduces(lang)
        : await this.askNeeds(lang);
    }

    updates.conversationState = 'AWAITING_LOCATION';
    await this.usersService.update(phone, updates);
    return await this.aiService.reply('ask_location', lang, {});
  }

  // ─── Step 3: Location ─────────────────────────────────────────
  private async handleLocation(
    phone: string,
    input: string,
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    user: any,
    lang: Language,
  ): Promise<string> {
    // Prefer AI-extracted location, fall back to raw input
    const location = parsed.location ?? input.trim();

    if (location.length < 2) {
      const errors: Record<Language, string> = {
        english: `Please enter your city or town name.`,
        french: `Veuillez entrer le nom de votre ville.`,
        pidgin: `Tell us which town you dey.`,
      };
      return errors[lang];
    }

    const role = user?.role ?? 'farmer';
    await this.usersService.update(phone, {
      location,
      conversationState:
        role === 'farmer' || role === 'both'
          ? 'AWAITING_PRODUCES'
          : 'AWAITING_NEEDS',
    });

    return role === 'farmer' || role === 'both'
      ? await this.askProduces(lang)
      : await this.askNeeds(lang);
  }

  // ─── Step 4a: Farmer — Produces ───────────────────────────────
  private async handleProduces(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    const produces = input
      .split(/[,،،;\/]/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 1);

    if (produces.length === 0) {
      const errors: Record<Language, string> = {
        english: `List at least one crop, separated by commas.\nExample: maize, cassava`,
        french: `Listez au moins un produit, séparé par des virgules.\nExemple: maïs, manioc`,
        pidgin: `List at least one thing wey you farm.\nExample: maize, cassava`,
      };
      return errors[lang];
    }

    const user = await this.usersService.findByPhone(phone);
    const isBoth = user?.role === 'both';

    if (isBoth) {
      await this.usersService.update(phone, {
        produces,
        conversationState: 'AWAITING_NEEDS',
      });
      return await this.askNeeds(lang);
    }

    const userUpdated = await this.usersService.update(phone, {
      produces,
      conversationState: 'REGISTERED',
    });

    return await this.aiService.reply('registered_farmer', lang, {
      name: userUpdated.name,
    });
  }

  // ─── Step 4b: Buyer — Business (OPTIONAL) ────────────────────
  // Business name is not required. Any non-trivial input is stored,
  // SKIP / short reply moves straight to AWAITING_NEEDS.
  private async handleBusiness(
    phone: string,
    input: string,
    lang: Language,
    user: any,
  ): Promise<string> {
    const isSkip = /^(skip|passer|no|non|nope|later|no thanks|pas maintenant)$/i.test(input.trim());
    const updates: Record<string, any> = { conversationState: 'AWAITING_NEEDS' };

    if (!isSkip && input.trim().length >= 2) {
      updates.businessName = input.trim();
    }

    // If user already has needs saved (product from first message), skip AWAITING_NEEDS
    const existingNeeds: string[] = user?.needs ?? [];
    if (existingNeeds.length > 0) {
      updates.conversationState = 'REGISTERED';
      await this.usersService.update(phone, updates);
      return await this.aiService.reply('registered_buyer', lang, { name: user?.name ?? '' });
    }

    await this.usersService.update(phone, updates);
    return await this.aiService.reply('ask_needs', lang, {});
  }

  // ─── Step 5b: Buyer — Needs ───────────────────────────────────
  // If the user already has needs persisted from turn 1, skip asking entirely.
  private async handleNeeds(
    phone: string,
    input: string,
    lang: Language,
    user: any,
  ): Promise<string> {
    // If needs were already captured from the first message, complete registration
    const existingNeeds: string[] = user?.needs ?? [];
    const isSkip = /^(skip|passer|no|non|nope|later)$/i.test(input.trim());

    let needs: string[] = existingNeeds;

    if (!isSkip) {
      const parsedNeeds = input
        .split(/[,،;\/]/)
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n.length > 1);

      if (parsedNeeds.length > 0) {
        // Merge new entries with any already saved
        needs = [...new Set([...existingNeeds, ...parsedNeeds])];
      }
    }

    if (needs.length === 0) {
      const errors: Record<Language, string> = {
        english: `What are you looking to buy? (e.g. maize, tomatoes)\nType *SKIP* to finish without listing products.`,
        french: `Quels produits cherchez-vous ? (ex: maïs, tomates)\nTapez *PASSER* pour terminer sans liste.`,
        pidgin: `Wetin you wan buy? (e.g. maize, tomatoes)\nType *SKIP* to finish.`,
      };
      return errors[lang];
    }

    const isBoth = user?.role === 'both';

    if (isBoth) {
      await this.usersService.update(phone, { needs, conversationState: 'REGISTERED' });
      return await this.aiService.reply('registered_both', lang, { name: user?.name ?? '' });
    }

    const userUpdated = await this.usersService.update(phone, {
      needs,
      conversationState: 'REGISTERED',
    });

    return await this.aiService.reply('registered_buyer', lang, {
      name: userUpdated.name,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async askProduces(lang: Language): Promise<string> {
    return this.aiService.reply('ask_produces', lang, {});
  }

  private async askNeeds(lang: Language): Promise<string> {
    return this.aiService.reply('ask_needs', lang, {});
  }
}
