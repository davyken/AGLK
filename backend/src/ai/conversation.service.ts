import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { LanguageDetectionService } from './language-detection.service';
import type { Language } from './language-detection.service';

/**
 * ConversationService
 *
 * Single source of truth for per-user language state.
 * Combines language detection, session caching, and DB persistence.
 *
 * Language resolution rules (in priority order):
 *
 * 1. If the incoming message has high-confidence language signal (≥ 0.70)
 *    AND it differs from saved language → switch immediately, persist.
 *
 * 2. If confidence is below 0.70 but above 0.55 → keep saved language,
 *    do NOT switch (avoids thrashing on short ambiguous inputs like "ok").
 *
 * 3. If confidence < 0.55 (unknown) AND no saved language exists
 *    → return 'english' + set needsClarification = true so the bot
 *    can ask the user which language they prefer.
 *
 * 4. Otherwise → return the saved language unchanged.
 *
 * Session cache: avoids a DB round-trip on every message for established
 * users. Cache is process-scoped (cleared on restart). DB is the
 * authoritative store.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  // In-memory cache for language per phone number
  // Keyed by phone → { language, cachedAt }
  private readonly sessionCache = new Map<
    string,
    { language: Language; cachedAt: number }
  >();

  private readonly CACHE_TTL = 30 * 60 * 1_000; // 30 minutes
  private readonly SWITCH_THRESHOLD = 0.7; // min confidence to switch language
  private readonly CLARIFICATION_MINIMUM = 0.55; // below this on new user → ask

  constructor(
    private readonly usersService: UsersService,
    private readonly langDetect: LanguageDetectionService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /**
   * Main entry point: detects language from incoming text, resolves
   * the language to use for the reply, persists any changes.
   *
   * @returns language to reply in, and whether to ask for clarification
   */
  async resolveLanguage(
    phone: string,
    text: string,
  ): Promise<{ language: Language; needsClarification: boolean }> {
    const detection = await this.langDetect.detect(text);
    const saved = await this.getLanguage(phone);

    this.logger.debug(
      `[${phone}] Detected: ${detection.language} (${(detection.confidence * 100).toFixed(0)}% via ${detection.method}), saved: ${saved}`,
    );

    // High-confidence detection → switch if different from saved
    if (
      detection.language !== 'unknown' &&
      detection.confidence >= this.SWITCH_THRESHOLD
    ) {
      const detected = detection.language;
      if (detected !== saved) {
        await this.setLanguage(phone, detected);
        this.logger.log(`[${phone}] Language switched: ${saved} → ${detected}`);
        return { language: detected, needsClarification: false };
      }
      return { language: saved, needsClarification: false };
    }

    // Unknown confidence on a brand-new user → ask for clarification
    if (detection.language === 'unknown' && !saved) {
      return { language: 'english', needsClarification: true };
    }

    // Use saved language (don't override on ambiguous input)
    return { language: saved ?? 'english', needsClarification: false };
  }

  /**
   * Get the stored language for a user. Returns 'english' as default
   * for users who have not yet set a language preference.
   */
  async getLanguage(phone: string): Promise<Language> {
    // Check in-memory cache first
    const cached = this.sessionCache.get(phone);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
      return cached.language;
    }

    // Load from DB
    const user = await this.usersService.findByPhone(phone);
    const lang = ((user as any)?.language as Language) ?? 'english';
    this.sessionCache.set(phone, { language: lang, cachedAt: Date.now() });
    return lang;
  }

  /**
   * Persist a language preference for a user and update the session cache.
   */
  async setLanguage(phone: string, lang: Language): Promise<void> {
    this.sessionCache.set(phone, { language: lang, cachedAt: Date.now() });
    await this.usersService.updateLanguage(phone, lang);
  }

  /**
   * Explicitly set a language based on user's manual choice
   * (e.g. replying "1" for English, "2" for French, "3" for Pidgin).
   * Always persists regardless of confidence.
   */
  async setLanguageExplicit(phone: string, lang: Language): Promise<void> {
    this.logger.log(`[${phone}] Language explicitly set to: ${lang}`);
    await this.setLanguage(phone, lang);
  }

  /**
   * Invalidate the in-memory cache for a phone number.
   * Call this when you know the DB has been updated externally.
   */
  invalidateCache(phone: string): void {
    this.sessionCache.delete(phone);
  }
}
