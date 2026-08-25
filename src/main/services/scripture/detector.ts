import { EventEmitter } from "events";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import log from "electron-log/main";
import { matchPlanQuote, type SermonPlanIndex } from "@shared/sermon-plan-match";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DetectionType = "explicit" | "partial" | "quote" | "paraphrase";

export interface ScriptureReference {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  confidence: number;
  detectionType: DetectionType;
  sourceText: string;
}

/** Chapter-only model guesses may be reviewed, but verse 1 is only a schema placeholder. */
export function canAutoPresentScriptureReference(
  ref: ScriptureReference,
): boolean {
  return ref.detectionType !== "partial";
}

export interface DetectorConfig {
  /** LLM provider — 'anthropic' (default) or 'deepseek' (OpenAI-compatible) */
  provider?: "anthropic" | "deepseek";
  /** API key for the selected provider */
  apiKey: string;
  /** Model string — defaults to claude-haiku-4-5-20251001 (anthropic) or deepseek-chat (deepseek) */
  model?: string;
  maxTokens?: number;
  /** Minimum ms between API calls (default 5000) */
  minIntervalMs?: number;
  /** How long the same reference is suppressed in the dedup cache (default 5 min) */
  cacheWindowMs?: number;
  /** Per-call timeout in ms (default 15 000) */
  timeoutMs?: number;
}

export interface DetectorStats {
  totalCalls: number;
  totalDetections: number;
  averageLatencyMs: number;
  cacheHits: number;
  errors: number;
}

// ─── Raw shape returned by the model ─────────────────────────────────────────

interface RawRef {
  book?: unknown;
  chapter?: unknown;
  verseStart?: unknown;
  verseEnd?: unknown;
  confidence?: unknown;
  detectionType?: unknown;
  sourceText?: unknown;
}

// ─── Typed event emitter ──────────────────────────────────────────────────────

interface DetectorEvents {
  detection: [refs: ScriptureReference[]];
  processing: [text: string];
  error: [err: Error];
  requestSuccess: [];
  stats: [stats: DetectorStats];
}

export declare interface ScriptureDetector {
  on<K extends keyof DetectorEvents>(
    event: K,
    listener: (...args: DetectorEvents[K]) => void,
  ): this;
  emit<K extends keyof DetectorEvents>(
    event: K,
    ...args: DetectorEvents[K]
  ): boolean;
  off<K extends keyof DetectorEvents>(
    event: K,
    listener: (...args: DetectorEvents[K]) => void,
  ): this;
  once<K extends keyof DetectorEvents>(
    event: K,
    listener: (...args: DetectorEvents[K]) => void,
  ): this;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL_ANTHROPIC = "claude-haiku-4-5-20251001";
const DEFAULT_MODEL_DEEPSEEK = "deepseek-v4-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MAX_TOKENS = 1536;
const DEFAULT_INTERVAL = 5_000;
const DEFAULT_CACHE_WINDOW = 5 * 60_000;
const DEFAULT_TIMEOUT = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const SOURCE_TEXT_MAX_CHARS = 150; // ~15 words
/** Rolling speech kept for plan-quote matching — mirrors the Operator's reading window. */
const PLAN_QUOTE_WINDOW_CHARS = 600;
/** A gap this long means the preacher moved on; stale half-verses must not match. */
const PLAN_QUOTE_WINDOW_TTL_MS = 60_000;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a scripture detection engine embedded in a live church service transcription pipeline. Your sole function: analyze sermon transcript excerpts and return structured JSON identifying every Bible reference present — explicit citations, direct quotes, and paraphrases alike.

════════════════════════════════════════
OUTPUT CONTRACT — READ FIRST
════════════════════════════════════════
Return ONLY a valid JSON array.
No markdown fences. No explanation. No preamble. No trailing text.
First character must be [. Last character must be ].
Zero detections → return exactly: []

════════════════════════════════════════
DETECTION TYPES
════════════════════════════════════════
explicit   — Speaker states book + chapter + verse directly.
             "Turn to Romans chapter eight verse twenty-eight"
partial    — Speaker gives book + chapter but no verse, or reference is incomplete.
             "Open your Bibles to Psalm 23" / "over in the book of John"
quote      — Text closely matches a known verse; citation absent or secondary.
             "for God so loved the world that he gave his only begotten son"
paraphrase — Biblical concept or passage restated in speaker's own words.
             "Paul reminds us that all things work together for good to those who love God"

════════════════════════════════════════
CONFIDENCE SCALE
════════════════════════════════════════
0.90–1.00  Book + chapter + verse stated explicitly; no ambiguity.
0.70–0.89  Direct quote of a recognizable verse; passage identity is certain.
0.50–0.69  Partial quote or strong paraphrase; specific passage identifiable.
0.30–0.49  Possible paraphrase; biblical language used but passage uncertain.
< 0.30     DO NOT INCLUDE — too speculative.

════════════════════════════════════════
OUTPUT SCHEMA
════════════════════════════════════════
Each array element must have EXACTLY these fields (no extras, no omissions):

  "book"          string   Canonical name from the list below (e.g., "Romans", "1 Samuel")
  "chapter"       integer  Chapter number
  "verseStart"    integer  Starting verse; use 1 for chapter-only (partial) references
  "verseEnd"      integer | null  Ending verse for ranges; null otherwise
  "confidence"    float    0.30–1.00 per scale above
  "detectionType" string   One of: "explicit" | "partial" | "quote" | "paraphrase"
  "sourceText"    string   Verbatim excerpt from the input, ≤15 words, that triggered detection

════════════════════════════════════════
CANONICAL BOOK NAMES + ABBREVIATIONS
════════════════════════════════════════
Always output the canonical name. Accept all listed variants as input signals.

OLD TESTAMENT (39 books)
Genesis        Gen, Gn
Exodus         Exod, Ex
Leviticus      Lev
Numbers        Num, Nu
Deuteronomy    Deut, Dt  |  speech: "Deuteronomy", "the fifth book of Moses"
Joshua         Josh
Judges         Judg, Jdg
Ruth
1 Samuel       1Sam, 1Sa  |  speech: "First Samuel", "one Samuel"
2 Samuel       2Sam, 2Sa  |  speech: "Second Samuel"
1 Kings        1Kgs, 1Ki  |  speech: "First Kings"
2 Kings        2Kgs, 2Ki  |  speech: "Second Kings"
1 Chronicles   1Chr       |  speech: "First Chronicles"
2 Chronicles   2Chr       |  speech: "Second Chronicles"
Ezra
Nehemiah       Neh
Esther
Job
Psalms         Ps, Psalm, Psa  |  speech: "the Psalms", "Psalm 23", "Salms" (STT artifact)
Proverbs       Prov, Pro, Prv
Ecclesiastes   Eccl, Ecc, Qoh
Song of Solomon  Song, SOS  |  also: "Song of Songs", "Canticles"
Isaiah         Isa
Jeremiah       Jer
Lamentations   Lam
Ezekiel        Ezek, Eze
Daniel         Dan
Hosea          Hos
Joel
Amos
Obadiah        Obad, Ob
Jonah          Jon
Micah          Mic
Nahum          Nah
Habakkuk       Hab
Zephaniah      Zeph, Zep
Haggai         Hag
Zechariah      Zech, Zec
Malachi        Mal

NEW TESTAMENT (27 books)
Matthew        Matt, Mt
Mark           Mk, Mrk
Luke           Lk, Luk
John           Jn, Jhn
Acts
Romans         Rom
1 Corinthians  1Cor, 1Co  |  speech: "First Corinthians"
2 Corinthians  2Cor, 2Co  |  speech: "Second Corinthians"
Galatians      Gal
Ephesians      Eph
Philippians    Phil, Php  |  speech: "Filipians" (STT artifact)
Colossians     Col
1 Thessalonians  1Thess, 1Th  |  speech: "First Thessalonians"
2 Thessalonians  2Thess, 2Th  |  speech: "Second Thessalonians"
1 Timothy      1Tim, 1Ti    |  speech: "First Timothy"
2 Timothy      2Tim, 2Ti    |  speech: "Second Timothy"
Titus          Tit
Philemon       Phlm, Phm
Hebrews        Heb
James          Jas
1 Peter        1Pet, 1Pe    |  speech: "First Peter"
2 Peter        2Pet, 2Pe    |  speech: "Second Peter"
1 John         1Jn          |  speech: "First John"
2 John         2Jn          |  speech: "Second John"
3 John         3Jn          |  speech: "Third John"
Jude
Revelation     Rev, Rv      |  speech: "Revelations" → always correct to singular "Revelation"

════════════════════════════════════════
SPEECH-TO-TEXT ARTIFACT HANDLING
════════════════════════════════════════
Live transcription produces spoken-number artifacts. Recognize all of these:

Chapter/verse spoken as words:
  "chapter three verse sixteen"       → chapter 3, verse 16
  "chapter eight verse twenty-eight"  → chapter 8, verse 28
  "four thirteen"                     → chapter 4, verse 13
  "three sixteen"                     → chapter 3, verse 16

Verse ranges:
  "verses 28 through 30"  → verseStart 28, verseEnd 30
  "verse 28 to 30"        → verseStart 28, verseEnd 30
  "verses 1 thru 5"       → verseStart 1,  verseEnd 5

Ordinal prefixes spoken:
  "first corinthians four thirteen"   → 1 Corinthians 4:13
  "second timothy three sixteen"      → 2 Timothy 3:16
  "third john verse four"             → 3 John 1:4

════════════════════════════════════════
BEHAVIORAL RULES
════════════════════════════════════════
1.  Return ONLY the JSON array — no other text whatsoever.
2.  Use canonical book names from the list above, exactly as spelled.
3.  For partial references (book + chapter, no verse), set verseStart = 1.
4.  For verse ranges, always populate verseEnd; otherwise set verseEnd = null.
5.  Never detect the same verse twice within one response.
6.  Only include detections with confidence ≥ 0.30.
7.  "sourceText" must be ≤15 words, copied verbatim from the input.
8.  Generic religious language with no specific passage ("God is good", "praise the
    Lord", "he is faithful") → DO NOT include.
9.  A sermon illustration naming a biblical character ("David faced Goliath") without
    quoting or paraphrasing a specific verse → confidence ≤ 0.40 only if a passage
    is clearly implied; otherwise omit entirely.
10. When context is ambiguous between OT and NT, favor NT.
11. Do not infer a verse from a doctrine alone ("the Trinity", "salvation by faith").
    Require recognizable verse content or an explicit citation.

════════════════════════════════════════
EXAMPLES
════════════════════════════════════════

── EXAMPLE 1: EXPLICIT reference with spoken numbers ──────────────────────────
Input:
"I want you to turn your Bibles to Romans chapter eight verse twenty-eight.
Romans eight twenty-eight says and we know that all things work together for
good to them that love God to them who are the called according to his purpose."

Output:
[{"book":"Romans","chapter":8,"verseStart":28,"verseEnd":null,"confidence":0.97,"detectionType":"explicit","sourceText":"turn your Bibles to Romans chapter eight verse twenty-eight"}]

── EXAMPLE 2: QUOTE — no citation stated ───────────────────────────────────────
Input:
"And the Word became flesh and dwelt among us and we beheld his glory the glory
as of the only begotten of the Father full of grace and truth. That is the
opening declaration of the gospel of John about who Jesus is."

Output:
[{"book":"John","chapter":1,"verseStart":14,"verseEnd":null,"confidence":0.83,"detectionType":"quote","sourceText":"the Word became flesh and dwelt among us full of grace and truth"}]

── EXAMPLE 3: QUOTE introduced by speaker attribution ──────────────────────────
Input:
"Paul writes to the church at Philippi from a prison cell and he says I can do
all things through Christ which strengtheneth me. That is a man who learned
contentment in every state."

Output:
[{"book":"Philippians","chapter":4,"verseStart":13,"verseEnd":null,"confidence":0.90,"detectionType":"quote","sourceText":"I can do all things through Christ which strengtheneth me"}]

── EXAMPLE 4: MULTIPLE scriptures in one passage ───────────────────────────────
Input:
"This theme runs through all of Scripture. In John three sixteen God so loved
the world that he gave his only begotten Son. We see it in Psalm twenty-three
verse one the Lord is my shepherd I shall not want. And Paul declares in
Romans eight that nothing shall separate us from the love of God."

Output:
[{"book":"John","chapter":3,"verseStart":16,"verseEnd":null,"confidence":0.95,"detectionType":"explicit","sourceText":"In John three sixteen God so loved the world"},{"book":"Psalms","chapter":23,"verseStart":1,"verseEnd":null,"confidence":0.97,"detectionType":"explicit","sourceText":"Psalm twenty-three verse one the Lord is my shepherd"},{"book":"Romans","chapter":8,"verseStart":38,"verseEnd":39,"confidence":0.72,"detectionType":"quote","sourceText":"nothing shall separate us from the love of God"}]

── EXAMPLE 5: NO scripture references ──────────────────────────────────────────
Input:
"As we close our time together I just want to encourage you that God is faithful.
He has been faithful in my life and I believe he will be faithful in yours.
Do not give up. Keep pressing forward. Have a safe drive home."

Output:
[]

── EXAMPLE 6: LOW-CONFIDENCE paraphrase — ambiguous passage ────────────────────
Input:
"Jesus calls us to be salt and light in this world. We are people who are meant
to shine in the darkness around us and to add flavor to everything we touch."

Output:
[{"book":"Matthew","chapter":5,"verseStart":13,"verseEnd":16,"confidence":0.45,"detectionType":"paraphrase","sourceText":"be salt and light in this world shine in the darkness"}]`;

// ─── Class ────────────────────────────────────────────────────────────────────

export class ScriptureDetector extends EventEmitter {
  private cfg: Required<DetectorConfig>;
  private anthropic: Anthropic | null = null;
  private openaiCompat: OpenAI | null = null;

  public fallbackMode = false;

  // Queue state
  private pendingText: string | null = null;
  private processing = false;
  private lastCallTime = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private explicitContext: {
    book: string;
    chapter: number;
    awaitingVerse: boolean;
    updatedAt: number;
  } | null = null;

  // Live sermon-playlist matching. Held as a provider rather than a snapshot so
  // re-selecting or editing the playlist takes effect without re-wiring.
  private planIndexProvider: (() => SermonPlanIndex | null) | null = null;
  private planQuoteWindow = "";
  private planQuoteWindowAt = 0;

  // Dedup cache: normalized ref key → reference + expiry timestamp. Keeping the
  // interval lets a later single-verse detection overlap a previously-detected
  // passage range (and vice versa) instead of appearing as a duplicate card.
  private dedupCache = new Map<
    string,
    { ref: ScriptureReference; expiry: number }
  >();

  // Stats
  private statsData = {
    totalCalls: 0,
    totalDetections: 0,
    latencySum: 0,
    cacheHits: 0,
    errors: 0,
  };

  constructor(config: DetectorConfig) {
    super();
    const provider = config.provider ?? "anthropic";
    this.cfg = {
      provider,
      apiKey: config.apiKey,
      model:
        config.model ??
        (provider === "deepseek"
          ? DEFAULT_MODEL_DEEPSEEK
          : DEFAULT_MODEL_ANTHROPIC),
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      minIntervalMs: config.minIntervalMs ?? DEFAULT_INTERVAL,
      cacheWindowMs: config.cacheWindowMs ?? DEFAULT_CACHE_WINDOW,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT,
    };
    this.initClient();
  }

  private initClient(): void {
    if (this.cfg.provider === "deepseek") {
      this.openaiCompat = new OpenAI({
        apiKey: this.cfg.apiKey,
        baseURL: DEEPSEEK_BASE_URL,
      });
      this.anthropic = null;
    } else {
      this.anthropic = new Anthropic({ apiKey: this.cfg.apiKey });
      this.openaiCompat = null;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Submit transcript text for analysis. Queues; only latest text is sent. */
  analyze(text: string): void {
    if (!text.trim()) return;

    // Explicit citations are deterministic and latency-sensitive. Resolve them
    // locally before entering the throttled AI queue; the AI remains the path
    // for quotation/paraphrase detection when no explicit reference is present.
    if (this.analyzeExplicit(text, true)) return;

    this.pendingText = text;

    if (this.processing) return; // flush() called after current call finishes

    const elapsed = Date.now() - this.lastCallTime;
    if (elapsed >= this.cfg.minIntervalMs) {
      this.flush();
    } else if (!this.flushTimer) {
      const delay = this.cfg.minIntervalMs - elapsed;
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, delay);
    }
    // If a timer is already scheduled and new text arrived, pendingText is updated above
  }

  /** Fast deterministic path safe to call for every interim STT update. */
  analyzeExplicit(
    text: string,
    requireVerse = false,
    deferAmbiguousRepeatedPair = false,
  ): boolean {
    const now = Date.now();
    if (this.explicitContext && now - this.explicitContext.updatedAt > 12_000) {
      this.explicitContext = null;
    }

    const direct = matchExplicitScriptures(text);
    const directWithVerse = direct.filter(
      (ref) =>
        (!requireVerse || hasExplicitVerseSignal(ref.sourceText)) &&
        (!deferAmbiguousRepeatedPair ||
          !isAmbiguousRepeatedChapterPair(ref)),
    );
    const remembered = direct[direct.length - 1];
    if (remembered) {
      this.explicitContext = {
        book: remembered.book,
        chapter: remembered.chapter,
        awaitingVerse:
          /\bverses?\b/i.test(text) ||
          !hasExplicitVerseSignal(remembered.sourceText) ||
          this.explicitContext?.awaitingVerse === true,
        updatedAt: now,
      };
    } else if (this.explicitContext && /\bverses?\b/i.test(text)) {
      this.explicitContext.awaitingVerse = true;
      this.explicitContext.updatedAt = now;
    }

    let explicit = directWithVerse;
    if (
      explicit.length === 0 &&
      direct.length === 0 &&
      this.explicitContext?.awaitingVerse
    ) {
      const normalized = normalizeWordNumbers(text);
      const range = normalized.match(
        /\b(\d+)(?:(?:\s*(?:-|to|thru|through)\s*|\s+)(\d+))?\b/,
      );
      if (range) {
        const verseStart = Number(range[1]);
        const verseEnd = range[2] ? Number(range[2]) : undefined;
        if (deferAmbiguousRepeatedPair && verseEnd === undefined) {
          return false;
        }
        explicit = [{
          book: this.explicitContext.book,
          chapter: this.explicitContext.chapter,
          verseStart,
          ...(verseEnd !== undefined && verseEnd > verseStart ? { verseEnd } : {}),
          confidence: 0.9,
          detectionType: "explicit",
          sourceText: `${this.explicitContext.book} ${this.explicitContext.chapter}:${verseStart}${verseEnd !== undefined ? `-${verseEnd}` : ""}`,
        }];
        this.explicitContext.updatedAt = now;
      }
    }
    if (explicit.length === 0) return false;
    // A spoken citation supersedes whatever reading was in progress.
    this.resetPlanQuoteWindow();
    const deduplicated = this.filterDedup(explicit);
    this.statsData.cacheHits += explicit.length - deduplicated.length;
    if (deduplicated.length > 0) {
      this.statsData.totalDetections += deduplicated.length;
      this.emit("detection", deduplicated);
    }
    this.emit("stats", this.getStats());
    return true;
  }

  /** Supplies the live sermon-playlist index used by {@link analyzePlanQuote}. */
  setPlanIndexProvider(provider: (() => SermonPlanIndex | null) | null): void {
    this.planIndexProvider = provider;
    if (!provider) this.resetPlanQuoteWindow();
  }

  /**
   * Matches recent speech against the live playlist's verse text, so a verse the
   * preacher starts reading resolves without waiting for the LLM. Returns true
   * when a detection was emitted.
   *
   * Emissions go through the same dedup cache as every other path, so a spoken
   * citation for the same passage — before or after — is never duplicated.
   */
  analyzePlanQuote(text: string): boolean {
    const index = this.planIndexProvider?.() ?? null;
    if (!index || !text.trim()) return false;

    const now = Date.now();
    if (now - this.planQuoteWindowAt > PLAN_QUOTE_WINDOW_TTL_MS) {
      this.planQuoteWindow = "";
    }
    this.planQuoteWindowAt = now;
    this.planQuoteWindow = `${this.planQuoteWindow} ${text}`
      .trim()
      .slice(-PLAN_QUOTE_WINDOW_CHARS);

    const match = matchPlanQuote(index, this.planQuoteWindow);
    if (!match) return false;

    const { verse } = match.entry;
    const ref: ScriptureReference = {
      book: verse.book,
      chapter: verse.chapter,
      verseStart: verse.verse,
      confidence: Math.min(0.95, match.coverage),
      detectionType: "quote",
      // Must be the current segment, not the rolling window: the Operator finds
      // the transcript line to highlight by substring-matching triggerText.
      sourceText: text.slice(0, SOURCE_TEXT_MAX_CHARS),
    };

    const deduplicated = this.filterDedup([ref]);
    this.resetPlanQuoteWindow();
    if (deduplicated.length === 0) {
      this.statsData.cacheHits += 1;
      this.emit("stats", this.getStats());
      return false;
    }

    this.statsData.totalDetections += deduplicated.length;
    this.emit("detection", deduplicated);
    this.emit("stats", this.getStats());
    return true;
  }

  private resetPlanQuoteWindow(): void {
    this.planQuoteWindow = "";
    this.planQuoteWindowAt = 0;
  }

  reconfigure(config: Partial<DetectorConfig>): void {
    const providerChanged =
      config.provider !== undefined && config.provider !== this.cfg.provider;
    const keyChanged =
      config.apiKey !== undefined && config.apiKey !== this.cfg.apiKey;

    if (config.provider !== undefined) this.cfg.provider = config.provider;
    if (config.apiKey !== undefined) this.cfg.apiKey = config.apiKey;
    if (config.model !== undefined) this.cfg.model = config.model;
    else if (providerChanged) {
      this.cfg.model =
        this.cfg.provider === "deepseek"
          ? DEFAULT_MODEL_DEEPSEEK
          : DEFAULT_MODEL_ANTHROPIC;
    }
    if (config.maxTokens !== undefined) this.cfg.maxTokens = config.maxTokens;
    if (config.minIntervalMs !== undefined)
      this.cfg.minIntervalMs = config.minIntervalMs;
    if (config.cacheWindowMs !== undefined)
      this.cfg.cacheWindowMs = config.cacheWindowMs;
    if (config.timeoutMs !== undefined) this.cfg.timeoutMs = config.timeoutMs;

    if (providerChanged || keyChanged) this.initClient();
    log.info("[ScriptureDetector] Reconfigured", {
      provider: this.cfg.provider,
      model: this.cfg.model,
    });
  }

  getStats(): DetectorStats {
    const d = this.statsData;
    return {
      totalCalls: d.totalCalls,
      totalDetections: d.totalDetections,
      averageLatencyMs:
        d.totalCalls > 0 ? Math.round(d.latencySum / d.totalCalls) : 0,
      cacheHits: d.cacheHits,
      errors: d.errors,
    };
  }

  clearCache(): void {
    this.dedupCache.clear();
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingText = null;
    this.explicitContext = null;
    this.removeAllListeners();
  }

  // ─── Queue / flush ─────────────────────────────────────────────────────────

  private flush(): void {
    if (!this.pendingText || this.processing) return;

    if (this.fallbackMode) {
      const text = this.pendingText;
      this.pendingText = null;
      this.runRegexDetection(text);
      return;
    }

    const text = this.pendingText;
    this.pendingText = null;
    this.processing = true;
    this.lastCallTime = Date.now();

    this.runDetection(text).finally(() => {
      this.processing = false;

      if (this.pendingText) {
        const elapsed = Date.now() - this.lastCallTime;
        const delay = Math.max(0, this.cfg.minIntervalMs - elapsed);
        if (delay === 0) {
          this.flush();
        } else if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
          }, delay);
        }
      }
    });
  }

  private runRegexDetection(text: string): void {
    this.emit("processing", text);
    try {
      const parsed = matchExplicitScriptures(text);
      const deduplicated = this.filterDedup(parsed);
      this.statsData.cacheHits += parsed.length - deduplicated.length;

      if (deduplicated.length > 0) {
        this.statsData.totalDetections += deduplicated.length;
        this.emit("detection", deduplicated);
      }

      this.emit("stats", this.getStats());
      log.info("[ScriptureDetector] Offline regex analysis complete", {
        found: parsed.length,
        emitted: deduplicated.length,
      });
    } catch (err) {
      log.error("[ScriptureDetector] Regex detection error:", err);
    }
  }

  // ─── API call with retry ───────────────────────────────────────────────────

  private async runDetection(text: string): Promise<void> {
    this.emit("processing", text);
    const start = Date.now();

    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        log.warn("[ScriptureDetector] Retry", { attempt, backoffMs: backoff });
        await sleep(backoff);
      }

      try {
        const raw = await this.callModel(text);
        const latency = Date.now() - start;

        this.statsData.totalCalls++;
        this.statsData.latencySum += latency;

        const parsed = parseResponse(raw);
        if (!parsed) {
          log.warn("[ScriptureDetector] Failed to parse response", {
            raw: raw.slice(0, 200),
          });
          return;
        }

        this.emit("requestSuccess");

        const deduplicated = this.filterDedup(parsed);
        this.statsData.cacheHits += parsed.length - deduplicated.length;

        if (deduplicated.length > 0) {
          this.statsData.totalDetections += deduplicated.length;
          this.emit("detection", deduplicated);
        }

        this.emit("stats", this.getStats());
        log.info("[ScriptureDetector] Analysis complete", {
          latencyMs: latency,
          found: parsed.length,
          emitted: deduplicated.length,
          model: this.cfg.model,
        });
        return;
      } catch (err) {
        lastErr = err as Error;

        if (isRateLimitError(err)) {
          log.warn("[ScriptureDetector] Rate limited", { attempt });
          // Use SDK-provided retry-after if available, otherwise exponential backoff
          continue;
        }

        if (isTimeoutError(err)) {
          log.warn("[ScriptureDetector] Request timed out");
          break; // don't retry timeouts — skip this cycle
        }

        // Other errors (auth, network, etc.) — don't retry
        break;
      }
    }

    if (lastErr) {
      this.statsData.errors++;
      this.emit("error", lastErr);
      this.emit("stats", this.getStats());
      log.error("[ScriptureDetector] Detection failed", lastErr.message);
    }
  }

  // ─── Model call ────────────────────────────────────────────────────────────

  private async callModel(text: string): Promise<string> {
    const signal = AbortSignal.timeout(this.cfg.timeoutMs);
    const userContent = `Detect Bible scripture references in this sermon transcript excerpt:\n\n${text}`;

    if (this.cfg.provider === "deepseek" && this.openaiCompat) {
      const resp = await this.openaiCompat.chat.completions.create(
        {
          model: this.cfg.model,
          max_tokens: this.cfg.maxTokens,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        },
        { signal },
      );
      return resp.choices[0]?.message?.content ?? "[]";
    }

    // Anthropic (default)
    const stream = this.anthropic!.messages.stream(
      {
        model: this.cfg.model,
        max_tokens: this.cfg.maxTokens,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      },
      { signal },
    );
    return stream.finalText();
  }

  // ─── Dedup cache ───────────────────────────────────────────────────────────

  private filterDedup(refs: ScriptureReference[]): ScriptureReference[] {
    const now = Date.now();

    // Evict expired entries
    for (const [key, entry] of this.dedupCache) {
      if (now > entry.expiry) this.dedupCache.delete(key);
    }

    return refs.filter((ref) => {
      const key = dedupKey(ref);
      for (const [cachedKey, entry] of this.dedupCache) {
        if (referenceContains(entry.ref, ref)) return false;
        if (referenceContains(ref, entry.ref)) {
          this.dedupCache.delete(cachedKey);
        }
      }
      this.dedupCache.set(key, {
        ref,
        expiry: now + this.cfg.cacheWindowMs,
      });
      return true;
    });
  }
}

function hasExplicitVerseSignal(sourceText: string): boolean {
  return (
    /\bverses?\b/i.test(sourceText) ||
    /:\s*\d+/.test(sourceText) ||
    /\b\d+\s+\d+(?:\s*(?:-|to|thru|through)\s*\d+)?\b/i.test(sourceText)
  );
}

function isAmbiguousRepeatedChapterPair(ref: ScriptureReference): boolean {
  if (ref.chapter !== ref.verseStart || ref.verseEnd !== undefined) return false;
  if (/\bverses?\b|:|(?:-|\bto\b|\bthru\b|\bthrough\b)/i.test(ref.sourceText)) {
    return false;
  }

  const numbers = ref.sourceText.match(/\d+/g) ?? [];
  return numbers.length === 2 && Number(numbers[0]) === Number(numbers[1]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupKey(ref: ScriptureReference): string {
  const end = ref.verseEnd != null ? `-${ref.verseEnd}` : "";
  return `${ref.book.toLowerCase()} ${ref.chapter}:${ref.verseStart}${end}`;
}

function referenceContains(
  container: ScriptureReference,
  candidate: ScriptureReference,
): boolean {
  if (
    container.book.toLowerCase() !== candidate.book.toLowerCase() ||
    container.chapter !== candidate.chapter
  ) {
    return false;
  }
  const containerEnd = container.verseEnd ?? container.verseStart;
  const candidateEnd = candidate.verseEnd ?? candidate.verseStart;
  return (
    container.verseStart <= candidate.verseStart &&
    containerEnd >= candidateEnd
  );
}

function parseResponse(raw: string): ScriptureReference[] | null {
  // Strip markdown fences Claude sometimes adds despite instructions
  let clean = raw.trim();
  const fence = clean.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) clean = fence[1].trim();

  // Find first [ … ] in the text in case there's leading/trailing noise
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const arr = JSON.parse(clean.slice(start, end + 1)) as unknown[];
    if (!Array.isArray(arr)) return null;

    const valid: ScriptureReference[] = [];
    for (const item of arr) {
      const r = item as RawRef;
      if (
        typeof r.book !== "string" ||
        typeof r.chapter !== "number" ||
        typeof r.verseStart !== "number" ||
        typeof r.confidence !== "number" ||
        typeof r.detectionType !== "string" ||
        typeof r.sourceText !== "string"
      )
        continue;

      const ref: ScriptureReference = {
        book: r.book,
        chapter: Math.floor(r.chapter),
        verseStart: Math.floor(r.verseStart),
        confidence: Math.max(0, Math.min(1, r.confidence)),
        detectionType: normalizeDetectionType(r.detectionType as string),
        sourceText: (r.sourceText as string).slice(0, SOURCE_TEXT_MAX_CHARS),
      };
      if (typeof r.verseEnd === "number" && r.verseEnd > ref.verseStart) {
        ref.verseEnd = Math.floor(r.verseEnd);
      }
      valid.push(ref);
    }
    return valid;
  } catch {
    return null;
  }
}

function normalizeDetectionType(raw: string): DetectionType {
  if (
    raw === "explicit" ||
    raw === "partial" ||
    raw === "quote" ||
    raw === "paraphrase"
  ) {
    return raw;
  }
  return "explicit";
}

function isRateLimitError(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    (err instanceof Error && err.message.toLowerCase().includes("rate limit"))
  );
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.message.toLowerCase().includes("timeout"))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ─── Offline Regex Scripture Matcher ──────────────────────────────────────────

const CANONICAL_BOOKS: Record<string, string> = {
  genesis: "Genesis",
  gen: "Genesis",
  gn: "Genesis",
  exodus: "Exodus",
  exod: "Exodus",
  ex: "Exodus",
  leviticus: "Leviticus",
  lev: "Leviticus",
  numbers: "Numbers",
  num: "Numbers",
  nu: "Numbers",
  deuteronomy: "Deuteronomy",
  deut: "Deuteronomy",
  dt: "Deuteronomy",
  joshua: "Joshua",
  josh: "Joshua",
  judges: "Judges",
  judg: "Judges",
  jdg: "Judges",
  ruth: "Ruth",
  "1 samuel": "1 Samuel",
  "1sam": "1 Samuel",
  "1sa": "1 Samuel",
  "1 sam": "1 Samuel",
  "2 samuel": "2 Samuel",
  "2sam": "2 Samuel",
  "2sa": "2 Samuel",
  "2 sam": "2 Samuel",
  "1 kings": "1 Kings",
  "1kgs": "1 Kings",
  "1ki": "1 Kings",
  "1 king": "1 Kings",
  "2 kings": "2 Kings",
  "2kgs": "2 Kings",
  "2ki": "2 Kings",
  "2 king": "2 Kings",
  "1 chronicles": "1 Chronicles",
  "1chr": "1 Chronicles",
  "1 chr": "1 Chronicles",
  "2 chronicles": "2 Chronicles",
  "2chr": "2 Chronicles",
  "2 chr": "2 Chronicles",
  ezra: "Ezra",
  nehemiah: "Nehemiah",
  neh: "Nehemiah",
  esther: "Esther",
  esth: "Esther",
  job: "Job",
  psalms: "Psalms",
  psalm: "Psalms",
  ps: "Psalms",
  psa: "Psalms",
  proverbs: "Proverbs",
  prov: "Proverbs",
  pro: "Proverbs",
  prv: "Proverbs",
  ecclesiastes: "Ecclesiastes",
  eccl: "Ecclesiastes",
  ecc: "Ecclesiastes",
  "song of solomon": "Song of Solomon",
  song: "Song of Solomon",
  sos: "Song of Solomon",
  isaiah: "Isaiah",
  isa: "Isaiah",
  jeremiah: "Jeremiah",
  jer: "Jeremiah",
  lamentations: "Lamentations",
  lam: "Lamentations",
  ezekiel: "Ezekiel",
  ezek: "Ezekiel",
  eze: "Ezekiel",
  daniel: "Daniel",
  dan: "Daniel",
  hosea: "Hosea",
  hos: "Hosea",
  joel: "Joel",
  amos: "Amos",
  obadiah: "Obadiah",
  obad: "Obadiah",
  ob: "Obadiah",
  jonah: "Jonah",
  jon: "Jonah",
  micah: "Micah",
  mic: "Micah",
  nahum: "Nahum",
  nah: "Nahum",
  habakkuk: "Habakkuk",
  hab: "Habakkuk",
  zephaniah: "Zephaniah",
  zeph: "Zephaniah",
  zep: "Zephaniah",
  haggai: "Haggai",
  hag: "Haggai",
  zechariah: "Zechariah",
  zech: "Zechariah",
  zec: "Zechariah",
  malachi: "Malachi",
  mal: "Malachi",
  matthew: "Matthew",
  matt: "Matthew",
  mt: "Matthew",
  mark: "Mark",
  mk: "Mark",
  mrk: "Mark",
  luke: "Luke",
  lk: "Luke",
  luk: "Luke",
  john: "John",
  jn: "John",
  jhn: "John",
  acts: "Acts",
  romans: "Romans",
  rom: "Romans",
  "1 corinthians": "1 Corinthians",
  "1cor": "1 Corinthians",
  "1co": "1 Corinthians",
  "1 cor": "1 Corinthians",
  "2 corinthians": "2 Corinthians",
  "2cor": "2 Corinthians",
  "2co": "2 Corinthians",
  "2 cor": "2 Corinthians",
  galatians: "Galatians",
  gal: "Galatians",
  ephesians: "Ephesians",
  eph: "Ephesians",
  philippians: "Philippians",
  phil: "Philippians",
  php: "Philippians",
  colossians: "Colossians",
  col: "Colossians",
  "1 thessalonians": "1 Thessalonians",
  "1thess": "1 Thessalonians",
  "1th": "1 Thessalonians",
  "1 thess": "1 Thessalonians",
  "2 thessalonians": "2 Thessalonians",
  "2thess": "2 Thessalonians",
  "2th": "2 Thessalonians",
  "2 thess": "2 Thessalonians",
  "1 timothy": "1 Timothy",
  "1tim": "1 Timothy",
  "1ti": "1 Timothy",
  "1 tim": "1 Timothy",
  "2 timothy": "2 Timothy",
  "2tim": "2 Timothy",
  "2ti": "2 Timothy",
  "2 tim": "2 Timothy",
  titus: "Titus",
  tit: "Titus",
  philemon: "Philemon",
  phlm: "Philemon",
  phm: "Philemon",
  hebrews: "Hebrews",
  heb: "Hebrews",
  james: "James",
  jas: "James",
  "1 peter": "1 Peter",
  "1pet": "1 Peter",
  "1pe": "1 Peter",
  "1 pet": "1 Peter",
  "2 peter": "2 Peter",
  "2pet": "2 Peter",
  "2pe": "2 Peter",
  "2 pet": "2 Peter",
  "1 john": "1 John",
  "1jn": "1 John",
  "2 john": "2 John",
  "2jn": "2 John",
  "3 john": "3 John",
  "3jn": "3 John",
  jude: "Jude",
  revelation: "Revelation",
  rev: "Revelation",
  rv: "Revelation",
  revelations: "Revelation",
};

function normalizeWordNumbers(text: string): string {
  const wordsMap: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12",
    thirteen: "13",
    fourteen: "14",
    fifteen: "15",
    sixteen: "16",
    seventeen: "17",
    eighteen: "18",
    nineteen: "19",
    twenty: "20",
    thirty: "30",
    forty: "40",
    fifty: "50",
    sixty: "60",
    seventy: "70",
    eighty: "80",
    ninety: "90",
  };

  let normalized = text.toLowerCase();
  normalized = normalized.replace(/\bchapter\s+number\s+/g, "chapter ");

  // Deepgram occasionally joins one half of a spoken compound number while
  // rendering the other half differently: "2four" / "twenty4" for 24.
  normalized = normalized.replace(
    /\b([2-9])(one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_match, tensDigit: string, unit: string) =>
      String(Number(tensDigit) * 10 + Number(wordsMap[unit])),
  );
  normalized = normalized.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)([1-9])\b/g,
    (_match, tens: string, unitDigit: string) =>
      String(Number(wordsMap[tens]) + Number(unitDigit)),
  );

  // STT commonly spells numbered book prefixes as ordinals. Restrict this
  // conversion to canonical numbered-book names so ordinary sermon phrases
  // such as "the second time" are left untouched.
  normalized = normalized.replace(
    /\b(first|second|third)\s+(?=(?:samuel|kings?|chronicles|corinthians|thessalonians|timothy|peter|john)\b)/g,
    (_match, ordinal: string) =>
      ordinal === "first" ? "1 " : ordinal === "second" ? "2 " : "3 ",
  );

  // Psalm is the only Bible book with three-digit chapter numbers. Speakers
  // commonly say "Psalm one thirty nine" (139) without saying "hundred".
  normalized = normalized.replace(
    /\b(psalms?)\s+one(?:\s+hundred(?:\s+and)?)?\s+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/g,
    (_match, book: string, remainder: string, unit?: string) =>
      `${book} ${100 + parseInt(wordsMap[remainder], 10) + (unit ? parseInt(wordsMap[unit], 10) : 0)}`,
  );

  // Replace compound word numbers (e.g. "twenty-eight" or "twenty eight")
  normalized = normalized.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (match, p1, p2) => {
      const tens = parseInt(wordsMap[p1], 10);
      const ones = parseInt(wordsMap[p2], 10);
      return String(tens + ones);
    },
  );

  // Replace single word numbers
  normalized = normalized.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    (match) => {
      return wordsMap[match] || match;
    },
  );

  return normalized;
}

export function matchExplicitScriptures(text: string): ScriptureReference[] {
  const normalized = normalizeWordNumbers(text);
  const results: ScriptureReference[] = [];

  // Match list of books
  const bookRegexStr =
    "(?:Gen(?:esis)?|Exo(?:dus)?|Lev(?:iticus)?|Num(?:bers)?|Deut(?:eronomy)?|Josh(?:ua)?|Judg(?:es)?|Ruth|" +
    "1\\s*Sam(?:uel)?|2\\s*Sam(?:uel)?|1\\s*Kings?|2\\s*Kings?|1\\s*Chr(?:onicles)?|2\\s*Chr(?:onicles)?|Ezra|Neh(?:emiah)?|Esth(?:er)?|Job|" +
    "Psa?(?:lms?)?|Prov(?:erbs)?|Eccl(?:esiastes)?|Song(?:\\s+of\\s+Solomon)?|Isa(?:iah)?|Jer(?:emiah)?|Lam(?:entations)?|Eze(?:kiel)?|Dan(?:iel)?|" +
    "Hos(?:ea)?|Joel|Amos|Obad(?:iah)?|Jon(?:ah)?|Mic(?:ah)?|Nah(?:um)?|Hab(?:akkuk)?|Zeph(?:aniah)?|Hag(?:gai)?|Zech(?:ariah)?|Mal(?:achi)?|" +
    "Matt(?:hew)?|Mark|Luke|John|Acts|Rom(?:ans)?|1\\s*Cor(?:inthians)?|2\\s*Cor(?:inthians)?|Gal(?:atians)?|Eph(?:esians)?|Phil(?:ippians)?|Col(?:ossians)?|" +
    "1\\s*Thess?(?:alonians)?|2\\s*Thess?(?:alonians)?|1\\s*Tim(?:othy)?|2\\s*Tim(?:othy)?|Tit(?:us)?|Phlm|Philemon|Heb(?:rews)?|Jas|James|" +
    "1\\s*Pet(?:er)?|2\\s*Pet(?:er)?|1\\s*Jn|1\\s*John|2\\s*Jn|2\\s*John|3\\s*Jn|3\\s*John|Jude|Rev(?:elation)?s?)";

  // Match book name, followed by chapter, optionally verse, optionally verse range
  const regex = new RegExp(
    `\\b(${bookRegexStr})\\b\\s*(?:chapter\\s+)?(\\d+)(?:\\s+\\2(?=\\s+(?:verse\\s+)?\\d+\\s*(?:-|thru|through|to)))?(?:\\s*[:\\s]\\s*(?:verse\\s+)?(\\d+)(?:(?:\\s*(?:-|thru|through|to)\\s*|\\s+)(\\d+))?)?`,
    "gi",
  );

  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const rawBook = match[1].toLowerCase().replace(/\s+/g, " ");
    const chapterStr = match[2];
    const verseStartStr = match[3];
    const verseEndStr = match[4];

    // Find canonical book mapping
    let canonicalBook = "";
    for (const key of Object.keys(CANONICAL_BOOKS)) {
      if (rawBook === key || rawBook.replace(/\s+/g, "") === key) {
        canonicalBook = CANONICAL_BOOKS[key];
        break;
      }
    }

    if (!canonicalBook) continue;

    const chapter = parseInt(chapterStr, 10);
    const verseStart = verseStartStr ? parseInt(verseStartStr, 10) : 1;
    const verseEnd = verseEndStr ? parseInt(verseEndStr, 10) : undefined;

    results.push({
      book: canonicalBook,
      chapter,
      verseStart,
      verseEnd,
      confidence: 0.9,
      detectionType: "explicit",
      sourceText: match[0],
    });
  }

  return results;
}
