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

    const lang: Language = await this.aiService.detectLanguage(text);

    // ── Brand-new user: extract as much as possible immediately ──
    if (!user) {
      return this.handleNewUser(phone, text, channel, lang);
    }

    // ── Update language if it changed mid-registration ─────────
    const savedLang: Language = (user as any).language ?? 'english';
    if (lang !== 'english' && lang !== savedLang) {
      await this.usersService.updateLanguage(phone, lang);
    }
    const activeLang = lang !== 'english' ? lang : savedLang;

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

    // Determine which state to start at (skip anything we already have)
    const nextState = this.determineFirstMissingState(
      parsed.role ?? null,
      parsed.name ?? null,
      parsed.location ?? null,
    );
    updates.conversationState = nextState;

    await this.usersService.createStub(phone, channel, lang);
    if (Object.keys(updates).length) {
      await this.usersService.update(phone, updates);
    }

    // If the user gave us EVERYTHING needed for a sell/buy intent right away
    // (name + role + location + product), registration is effectively done —
    // mark as REGISTERED and let the listing flow run next turn.
    if (
      nextState === 'REGISTERED' ||
      (parsed.name && parsed.role && parsed.location)
    ) {
      if (nextState === 'REGISTERED') {
        return this.generatePartialConfirm(parsed, lang, nextState);
      }
    }

    return this.generateFirstResponse(parsed, lang, nextState);
  }

  // ─── Determine which state comes first given what we know ─────
  private determineFirstMissingState(
    role: 'farmer' | 'buyer' | 'both' | null,
    name: string | null,
    location: string | null,
  ): string {
    if (!role) return 'AWAITING_ROLE';
    if (!name) return 'AWAITING_NAME';
    if (!location) return 'AWAITING_LOCATION';
    if (role === 'farmer' || role === 'both') return 'AWAITING_PRODUCES';
    return 'AWAITING_BUSINESS';
  }

  // ─── Generate the first bot message for a new user ────────────
  // If we extracted partial info, confirm it and ask only for what's missing.
  // Otherwise, give the standard welcome.
  private async generateFirstResponse(
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
    nextState: string,
  ): Promise<string> {
    const hasName = !!parsed.name;
    const hasRole = !!parsed.role;
    const hasLocation = !!parsed.location;

    // Full info extracted — confirm and ask for crops/business
    if (hasName && hasRole && hasLocation) {
      return this.generatePartialConfirm(parsed, lang, nextState);
    }

    // Partial extraction — acknowledge what we know, ask for first missing
    if (hasName || hasRole || hasLocation) {
      const parts: string[] = [];
      if (lang === 'english') {
        if (hasName) parts.push(`Nice to meet you, *${parsed.name}*!`);
        if (hasRole)
          parts.push(
            `Got it — you're a *${parsed.role === 'farmer' ? 'farmer' : 'buyer'}*.`,
          );
        if (hasLocation) parts.push(`You're based in *${parsed.location}*.`);

        if (nextState === 'AWAITING_ROLE')
          parts.push(
            `Are you a *farmer*, *buyer*, or *both*?\n\n1️⃣ Farmer\n2️⃣ Buyer\n3️⃣ Both`,
          );
        else if (nextState === 'AWAITING_NAME')
          parts.push(`What is your full name?`);
        else if (nextState === 'AWAITING_LOCATION')
          parts.push(`Which city or town are you in?`);
        else if (nextState === 'AWAITING_PRODUCES')
          parts.push(`What crops do you grow? (e.g. maize, cassava, tomatoes)`);
        else if (nextState === 'AWAITING_BUSINESS')
          parts.push(`What is your business or shop name?`);
      } else if (lang === 'french') {
        if (hasName) parts.push(`Enchanté, *${parsed.name}* !`);
        if (hasRole)
          parts.push(
            `Compris — vous êtes *${parsed.role === 'farmer' ? 'agriculteur' : 'acheteur'}*.`,
          );
        if (hasLocation) parts.push(`Vous êtes à *${parsed.location}*.`);

        if (nextState === 'AWAITING_ROLE')
          parts.push(
            `Êtes-vous *agriculteur*, *acheteur*, ou les deux ?\n\n1️⃣ Agriculteur\n2️⃣ Acheteur\n3️⃣ Les deux`,
          );
        else if (nextState === 'AWAITING_NAME')
          parts.push(`Quel est votre nom complet ?`);
        else if (nextState === 'AWAITING_LOCATION')
          parts.push(`Dans quelle ville êtes-vous ?`);
        else if (nextState === 'AWAITING_PRODUCES')
          parts.push(
            `Quels produits cultivez-vous ? (ex: maïs, manioc, tomates)`,
          );
        else if (nextState === 'AWAITING_BUSINESS')
          parts.push(`Quel est le nom de votre commerce ?`);
      } else {
        // Pidgin
        if (hasName) parts.push(`How you dey, *${parsed.name}*!`);
        if (hasRole)
          parts.push(
            `Okay — you be *${parsed.role === 'farmer' ? 'farmer' : 'buyer'}*.`,
          );
        if (hasLocation) parts.push(`You dey *${parsed.location}*.`);

        if (nextState === 'AWAITING_ROLE')
          parts.push(
            `You be farmer, buyer, or both?\n\n1️⃣ Farmer\n2️⃣ Buyer\n3️⃣ Both`,
          );
        else if (nextState === 'AWAITING_NAME')
          parts.push(`Wetin be your full name?`);
        else if (nextState === 'AWAITING_LOCATION')
          parts.push(`For which town you dey?`);
        else if (nextState === 'AWAITING_PRODUCES')
          parts.push(`Wetin you dey farm? (e.g. maize, cassava)`);
        else if (nextState === 'AWAITING_BUSINESS')
          parts.push(`Wetin be your business name?`);
      }
      return parts.join('\n');
    }

    // Nothing extracted — standard welcome
    return await this.aiService.reply('welcome', lang, {});
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
        `Parfait ${parsed.name ? `, *${parsed.name}*` : ''} !` +
        (parsed.location
          ? ` Vous êtes *${roleLabel}* à *${parsed.location}*.`
          : ` Vous êtes *${roleLabel}*.`);

      if (nextState === 'AWAITING_PRODUCES')
        return `${confirm}\n\nQuels produits cultivez-vous ? (ex: maïs, manioc, tomates)`;
      if (nextState === 'AWAITING_BUSINESS')
        return `${confirm}\n\nQuel est le nom de votre commerce ?`;
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
      if (nextState === 'AWAITING_BUSINESS')
        return `${confirm}\n\nWetin be your business name?`;
      return confirm;
    }

    // English
    const confirm =
      `Great${parsed.name ? `, *${parsed.name}*` : ''}!` +
      (parsed.location
        ? ` So you're a *${roleLabel}* based in *${parsed.location}*.`
        : ` So you're a *${roleLabel}*.`);

    if (nextState === 'AWAITING_PRODUCES')
      return `${confirm}\n\nWhat crops do you grow? (e.g. maize, cassava, tomatoes)`;
    if (nextState === 'AWAITING_BUSINESS')
      return `${confirm}\n\nWhat is your business or shop name?`;
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
        return this.handleBusiness(phone, input, lang);
      case 'AWAITING_NEEDS':
        return this.handleNeeds(phone, input, lang);
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
        english: 'your business name',
        french: 'votre commerce',
        pidgin: 'your business',
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
        role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_BUSINESS';
    }

    await this.usersService.update(phone, updates);

    // Skip ahead based on what we just extracted
    if (parsed.location) {
      return role === 'farmer'
        ? await this.askProduces(lang)
        : await this.askBusiness(lang);
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
        role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_BUSINESS';
      await this.usersService.update(phone, updates);
      return role === 'farmer'
        ? await this.askProduces(lang)
        : await this.askBusiness(lang);
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
          : 'AWAITING_BUSINESS',
    });

    return role === 'farmer' || role === 'both'
      ? await this.askProduces(lang)
      : await this.askBusiness(lang);
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
        conversationState: 'AWAITING_BUSINESS',
      });
      return await this.askBusiness(lang);
    }

    const userUpdated = await this.usersService.update(phone, {
      produces,
      conversationState: 'REGISTERED',
    });

    return await this.aiService.reply('registered_farmer', lang, {
      name: userUpdated.name,
    });
  }

  // ─── Step 4b: Buyer — Business ────────────────────────────────
  private async handleBusiness(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    if (input.trim().length < 2) {
      const errors: Record<Language, string> = {
        english: `Please enter your business or shop name.`,
        french: `Veuillez entrer le nom de votre commerce.`,
        pidgin: `Abeg put your business name.`,
      };
      return errors[lang];
    }

    await this.usersService.update(phone, {
      businessName: input.trim(),
      conversationState: 'AWAITING_NEEDS',
    });

    return await this.aiService.reply('ask_needs', lang, {});
  }

  // ─── Step 5b: Buyer — Needs ───────────────────────────────────
  private async handleNeeds(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    const needs = input
      .split(/[,،،;\/]/)
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 1);

    if (needs.length === 0) {
      const errors: Record<Language, string> = {
        english: `List at least one product you need.\nExample: maize, tomatoes`,
        french: `Listez au moins un produit recherché.\nExemple: maíz, tomates`,
        pidgin: `List at least one thing wey you need.\nExample: maize, tomatoes`,
      };
      return errors[lang];
    }

    const user = await this.usersService.findByPhone(phone);
    const isBoth = user?.role === 'both';

    if (isBoth) {
      await this.usersService.update(phone, {
        needs,
        conversationState: 'REGISTERED',
      });
      return await this.aiService.reply('registered_both', lang, {
        name: user.name,
      });
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

  private async askBusiness(lang: Language): Promise<string> {
    return this.aiService.reply('ask_business', lang, {});
  }
}
