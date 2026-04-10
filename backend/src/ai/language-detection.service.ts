import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type Language = 'english' | 'french' | 'pidgin';

export interface DetectionResult {
  language: Language | 'unknown';
  confidence: number; // 0.0 – 1.0
  method: 'llm' | 'statistical' | 'trivial';
}

/**
 * LanguageDetectionService
 *
 * Two-tier detection strategy:
 *
 * Tier 1 — Statistical (fast, no API):
 *   Analyses Unicode character frequency to identify French via diacritics
 *   (é è ê ë à â ç ù û ô î ï œ æ) and character bigram distribution.
 *   Cannot distinguish Cameroonian Pidgin from English without context —
 *   Pidgin is a creole not in any standard NLP n-gram model.
 *
 * Tier 2 — LLM (GPT-4o-mini):
 *   Used as primary detector for Pidgin and ambiguous short text.
 *   The model understands Cameroonian Pidgin contextually.
 *   Returns language label + confidence (0–1).
 *
 * Decision flow:
 *   1. Run statistical detection first.
 *   2. If statistical gives high-confidence French (≥ 0.80) → return immediately.
 *   3. Otherwise call LLM for a definitive answer.
 *   4. If LLM call fails → fall back to statistical result.
 *   5. If confidence < THRESHOLD → return 'unknown' so the bot can ask for
 *      clarification rather than replying in the wrong language.
 */
@Injectable()
export class LanguageDetectionService {
  private readonly logger = new Logger(LanguageDetectionService.name);
  private readonly openai: OpenAI;

  // LLM call is aborted after this many ms to avoid blocking the message flow
  private readonly LLM_TIMEOUT_MS = 3_000;

  // Below this confidence the result is treated as 'unknown'
  private readonly CONFIDENCE_THRESHOLD = 0.55;

  // Fast-path: skip LLM when statistical is already certain
  private readonly STATISTICAL_CERTAINTY = 0.8;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
      timeout: this.LLM_TIMEOUT_MS,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  async detect(text: string): Promise<DetectionResult> {
    const trimmed = text.trim();

    // Too short to determine language reliably
    if (trimmed.length < 2) {
      return { language: 'unknown', confidence: 0, method: 'trivial' };
    }

    // Code-switching fast path: count explicit markers from each language.
    // When a message mixes languages (e.g. "Bonjour, I wan sell maize"),
    // pick the one with the most markers rather than calling the LLM.
    const codeSwitchResult = this.detectCodeSwitching(trimmed);
    if (codeSwitchResult) return codeSwitchResult;

    // Fast path: high-confidence French via diacritics — no LLM needed
    const statistical = this.detectStatistical(trimmed);
    if (
      statistical.language === 'french' &&
      statistical.confidence >= this.STATISTICAL_CERTAINTY
    ) {
      return statistical;
    }

    // LLM path: handles Pidgin + ambiguous text
    try {
      return await this.detectWithLLM(trimmed);
    } catch (err: any) {
      this.logger.warn(
        `LLM language detection failed [${err?.status ?? err?.code ?? 'timeout'}] — using statistical fallback`,
      );
      return statistical;
    }
  }

  /**
   * Detect when a message mixes multiple languages (code-switching).
   * Counts explicit lexical markers from each language and picks the dominant one.
   * Returns null if only one language's markers are present (standard case).
   */
  private detectCodeSwitching(text: string): DetectionResult | null {
    const lower = text.toLowerCase();

    const frenchMarkers = [
      'bonjour', 'salut', 'bonsoir', 'oui', 'non', 'je', "j'ai", 'vous',
      'vendre', 'acheter', 'combien', 'prix', 'sacs', 'merci', 'avec',
      'pour', 'dans', 'est', 'très', 'aussi', 'mais', 'bien', 'même',
    ];
    const pidginMarkers = [
      'i get', 'i wan', 'i dey', 'na so', 'abeg', 'wetin', 'for sell',
      'for buy', 'wey', 'na me', 'sabi', 'oga', 'dis', 'dat', 'fit',
      'don', 'wan', 'dey', 'dem', 'am', 'am o',
    ];

    const frenchScore = frenchMarkers.filter((m) => lower.includes(m)).length;
    const pidginScore = pidginMarkers.filter((m) => lower.includes(m)).length;

    // Only a code-switching situation if BOTH have at least one marker
    if (frenchScore === 0 || pidginScore === 0) return null;

    // Dominant language wins; confidence reflects how uneven the split is
    const total = frenchScore + pidginScore;
    const dominant: Language = frenchScore >= pidginScore ? 'french' : 'pidgin';
    const dominantScore = Math.max(frenchScore, pidginScore);
    const confidence = Math.min(0.5 + (dominantScore / total) * 0.45, 0.95);

    this.logger.debug(
      `Code-switching detected — french:${frenchScore} pidgin:${pidginScore} → ${dominant}`,
    );
    return { language: dominant, confidence, method: 'statistical' };
  }

  /**
   * Synchronous statistical detector — safe to call without await.
   * Used as the LLM fallback and for the French fast-path.
   *
   * Reliability:
   *   - French with diacritics:  high (≥ 0.80)
   *   - English vs Pidgin:       cannot distinguish — always returns 'english' at 0.50
   */
  detectStatistical(text: string): DetectionResult {
    const lower = text.toLowerCase();
    const chars = lower.replace(/\s/g, '');
    if (chars.length === 0) {
      return { language: 'unknown', confidence: 0, method: 'statistical' };
    }

    // ── French signal 1: Unicode diacritics ──────────────────
    // These characters are essentially absent from standard English/Pidgin
    const diacriticPattern = /[éèêëàâäçùûüôîïœæ]/g;
    const diacriticCount = (lower.match(diacriticPattern) ?? []).length;
    const diacriticRatio = diacriticCount / chars.length;

    // ── French signal 2: Character bigrams ───────────────────
    // French has statistically higher frequency of these vowel clusters
    const frenchBigrams = [
      'ou',
      'au',
      'an',
      'en',
      'on',
      'ai',
      'eu',
      'ui',
      'oi',
      'ie',
    ];
    const totalBigrams = Math.max(chars.length - 1, 1);
    let bigramHits = 0;
    for (const bg of frenchBigrams) {
      let pos = 0;
      while ((pos = lower.indexOf(bg, pos)) !== -1) {
        bigramHits++;
        pos++;
      }
    }
    const bigramRatio = bigramHits / totalBigrams;

    // Combined French score (diacritics weighted heavier — more discriminative)
    const frenchScore = diacriticRatio * 0.7 + bigramRatio * 0.3;

    if (frenchScore > 0.06) {
      const confidence = Math.min(0.5 + frenchScore * 4, 0.95);
      return { language: 'french', confidence, method: 'statistical' };
    }

    // Cannot tell English from Pidgin without LLM context
    return { language: 'english', confidence: 0.5, method: 'statistical' };
  }

  // ─────────────────────────────────────────────────────────────
  // Private: LLM detection
  // ─────────────────────────────────────────────────────────────

  private async detectWithLLM(text: string): Promise<DetectionResult> {
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a language classifier for WhatsApp messages sent to an agricultural marketplace in Cameroon.

Classify the language into exactly one of:
- "english"  — Standard or simple English
- "french"   — Standard French or Cameroonian French
- "pidgin"   — Cameroonian Pidgin English (a creole; markers include: dey, don, wan, fit, abeg, wetin, na, sabi, oga, dis, dat, wey)
- "unknown"  — Cannot determine with confidence

Respond with JSON only: {"language":"english"|"french"|"pidgin"|"unknown","confidence":0.0-1.0}
confidence = your certainty that this classification is correct.`,
        },
        { role: 'user', content: text },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw.trim()) as {
      language?: string;
      confidence?: number;
    };

    const validLanguages = ['english', 'french', 'pidgin', 'unknown'];
    const language = validLanguages.includes(parsed.language ?? '')
      ? (parsed.language as Language | 'unknown')
      : 'unknown';

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

    // Treat low-confidence as 'unknown' so bot asks for clarification
    if (confidence < this.CONFIDENCE_THRESHOLD) {
      return { language: 'unknown', confidence, method: 'llm' };
    }

    return { language, confidence, method: 'llm' };
  }
}
