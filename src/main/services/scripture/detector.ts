/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- typed EventEmitter idiom: `declare interface` refines the inherited emitter surface. */
import {
  matchChapterQuote,
  recoverDamagedQuote,
  tokenizeChapter,
  type ChapterVerseTokens,
  type QuoteCandidate,
} from "./quote-recovery";
import { isValidScriptureReference } from "./verse-bounds";
import { EventEmitter } from "events";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import log from "electron-log/main";
import {
  matchPlanQuote,
  type SermonPlanIndex,
} from "@shared/sermon-plan-match";
import type { ScriptureResolver } from "@shared/scripture-trace";

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
  /**
   * Latency-tracing origin, stamped from the transcript this reference came out
   * of. Optional because references are also built by tests and recovery paths
   * that have no transcript behind them.
   */
  sttReceivedAt?: number;
  detectionStartedAt?: number;
  transcriptSource?: "interim" | "final";
  resolver?: ScriptureResolver;
  /**
   * Set on model results that landed after a newer local detection. They are
   * still shown for review but are too late to put on screen automatically.
   */
  superseded?: boolean;
}

/** What the caller knows about the transcript currently being analyzed. */
export interface TranscriptOrigin {
  /** When Kairo received it — not when the microphone heard it. */
  sttReceivedAt: number;
  source: "interim" | "final";
}

/** Chapter-only model guesses may be reviewed, but verse 1 is only a schema placeholder. */
export function canAutoPresentScriptureReference(
  ref: ScriptureReference,
): boolean {
  return (
    ref.detectionType !== "partial" &&
    !ref.superseded &&
    isValidScriptureReference(ref)
  );
}

export interface DetectorConfig {
  /** LLM provider — 'anthropic' (default) or 'deepseek' (OpenAI-compatible) */
  provider?: "anthropic" | "deepseek";
  /** API key for the selected provider */
  apiKey: string;
  /** Model string — defaults to claude-haiku-4-5 (anthropic) or deepseek-flash (deepseek) */
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
  planProgress: [reference: string, itemId: string];
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

const DEFAULT_MODEL_ANTHROPIC = "claude-haiku-4-5";
const DEFAULT_MODEL_DEEPSEEK = "deepseek-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MAX_TOKENS = 1536;
const DEFAULT_INTERVAL = 1_500;
const DEFAULT_CACHE_WINDOW = 5 * 60_000;
const DEFAULT_TIMEOUT = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const SOURCE_TEXT_MAX_CHARS = 150; // ~15 words
/** Rolling speech kept for plan-quote matching — mirrors the Operator's reading window. */
const PLAN_QUOTE_WINDOW_CHARS = 600;
/** A gap this long means the preacher moved on; stale half-verses must not match. */
const PLAN_QUOTE_WINDOW_TTL_MS = 60_000;
/** Speech kept for matching a quote inside a named chapter ("In John 3 …"). */
const CHAPTER_QUOTE_WINDOW_CHARS = 600;

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
  private readonly lifetime = new AbortController();
  private anthropic: Anthropic | null = null;
  private openaiCompat: OpenAI | null = null;

  public fallbackMode = false;

  // Queue state
  private pendingText: string | null = null;
  private pendingOrigin: (TranscriptOrigin & { detectionStartedAt: number }) | null = null;
  private pendingGeneration = 0;
  private processing = false;
  private resolutionGeneration = 0;
  private lastCallTime = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private transcriptOrigin: TranscriptOrigin | null = null;
  private detectionStartedAt: number | undefined;
  private quoteSearchProvider: ((phrase: string) => QuoteCandidate[]) | null = null;
  private chapterVerseProvider:
    | ((book: string, chapter: number) => QuoteCandidate[])
    | null = null;
  private pendingBook: { book: string; updatedAt: number } | null = null;
  private explicitContext: {
    book: string;
    chapter: number;
    awaitingVerse: boolean;
    verseStart?: number;
    awaitingRangeEnd?: boolean;
    updatedAt: number;
    /** Speech since a chapter was named without a verse; see analyzeChapterQuote. */
    quoteText?: string;
    /** That chapter's verses, fetched and tokenized once per citation. */
    quoteVerses?: ChapterVerseTokens[];
  } | null = null;

  // Live sermon-playlist matching. Held as a provider rather than a snapshot so
  // re-selecting or editing the playlist takes effect without re-wiring.
  private planIndexProvider: (() => SermonPlanIndex | null) | null = null;
  private planQuoteWindow = "";
  private planQuoteWindowAt = 0;

  // Dedup cache: normalized ref key → reference + expiry timestamp. Keeping the
  // interval lets a later single-verse detection overlap a previously-detected
  // passage range (and vice versa) instead of appearing as a duplicate card.
  // A `released` entry no longer blocks fresh speech (see `release`).
  private dedupCache = new Map<
    string,
    { ref: ScriptureReference; expiry: number; released?: boolean }
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
    if (this.lifetime.signal.aborted || !text.trim()) return;

    // Explicit citations are deterministic and latency-sensitive. Resolve them
    // locally before entering the throttled AI queue; the AI remains the path
    // for quotation/paraphrase detection when no explicit reference is present.
    if (this.analyzeWindowCitation(text)) return;
    if (!this.cfg.apiKey.trim()) return;

    this.pendingText = text;
    this.pendingOrigin = this.transcriptOrigin
      ? { ...this.transcriptOrigin, detectionStartedAt: this.detectionStartedAt ?? Date.now() }
      : null;
    this.pendingGeneration = this.resolutionGeneration;

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
    if (this.lifetime.signal.aborted) return false;
    const now = Date.now();
    if (this.explicitContext && now - this.explicitContext.updatedAt > 12_000) {
      this.explicitContext = null;
    }

    if (this.pendingBook && now - this.pendingBook.updatedAt > 12_000) this.pendingBook = null;
    const spoken = normalizeWordNumbers(text).trim();
    const bookOnly = bareBookName(spoken);
    if (bookOnly) {
      this.pendingBook = { book: bookOnly, updatedAt: now };
      this.explicitContext = null;
      return false;
    }
    const normalized = this.withRememberedBook(spoken);

    // Never carry a previous chapter into an unreadable new citation.
    if (CORRUPTED_CITATION_RE.test(normalized)) {
      this.explicitContext = null;
      this.pendingBook = null;
    }
    const direct = matchNormalizedCitations(normalized, {
      splitMergedDigits: !deferAmbiguousRepeatedPair,
    });
    // A new named citation must never borrow the previous book, even when its
    // numbers are invalid or its chapter has not arrived yet.
    if (direct.length === 0 && NAMED_BOOK_RE.test(normalized)) {
      this.explicitContext = null;
      this.pendingBook = null;
    }
    const directWithVerse = direct.filter(
      (ref) =>
        (!requireVerse || hasExplicitVerseSignal(ref.sourceText)) &&
        (!deferAmbiguousRepeatedPair || !isAmbiguousRepeatedChapterPair(ref)),
    );
    const remembered = direct[direct.length - 1];
    if (remembered) {
      this.pendingBook = null;
      this.explicitContext = {
        book: remembered.book,
        chapter: remembered.chapter,
        awaitingVerse:
          /\bverses?\b/.test(normalized) ||
          !hasExplicitVerseSignal(remembered.sourceText),
        updatedAt: now,
      };
    } else if (this.explicitContext && /\bverses?\b/.test(normalized)) {
      this.explicitContext.awaitingVerse = true;
      this.explicitContext.updatedAt = now;
    }

    let explicit = directWithVerse;
    if (
      explicit.length === 0 &&
      direct.length === 0 &&
      this.explicitContext?.awaitingVerse
    ) {
      const continuation = this.explicitContext.verseStart !== undefined &&
        (/^(?:to|through|thru|and|-)\s*\d+\b/.test(normalized) ||
          (this.explicitContext.awaitingRangeEnd && /^\d+\b/.test(normalized)));
      const rangeText = continuation
        ? `${this.explicitContext.verseStart} to ${normalized.replace(/^(?:to|through|thru|and|-)\s*/, "")}`
        : normalized;
      // Bare numbers are accepted only as a citation fragment, not "16 people".
      const bareFragment = /^(?:\d+)(?:\s*(?:-|to|thru|through|and|,)\s*\d+|\s+\d+)*[.,;!?]?(?:\s+(?:it reads|it says|says|and i quote)\b.*)?$/i.test(rangeText);
      const range = (bareFragment || /\bverses?\b/i.test(rangeText)) ? rangeText.match(
        /^(?:.*?\bverses?\s+)?(\d+)(?:(?:\s*(?:-|to|thru|through|and)\s*|\s+)(\d+))?\b/i,
      ) : null;
      if (range) {
        const verseStart = Number(range[1]);
        const verseEnd = range[2] ? Number(range[2]) : undefined;
        if (deferAmbiguousRepeatedPair && verseEnd === undefined && !/\bverses?\b/i.test(normalized)) {
          return false;
        }
        explicit = [
          {
            book: this.explicitContext.book,
            chapter: this.explicitContext.chapter,
            verseStart,
            ...(verseEnd !== undefined ? { verseEnd } : {}),
            confidence: 0.9,
            detectionType: "explicit",
            sourceText: `${this.explicitContext.book} ${this.explicitContext.chapter}:${verseStart}${verseEnd !== undefined ? `-${verseEnd}` : ""}`,
          },
        ];
        const list = normalized.match(/^(?:.*?\bverses?\s+)?(\d+(?:(?:,\s*(?:and\s+)?|\s+and\s+)\d+)+)/);
        if (list) {
          const numbers = list[1].match(/\d+/g)!.map(Number);
          if (numbers.length > 2 || numbers[1] !== numbers[0] + 1) {
            explicit = numbers.map(number => ({ ...explicit[0], verseStart: number, verseEnd: undefined }));
          }
        }
        this.explicitContext.updatedAt = now;
      }
    }
    explicit = explicit.filter(isValidScriptureReference);
    const latest = explicit[explicit.length - 1];
    if (latest && this.explicitContext) {
      this.explicitContext.verseStart = latest.verseStart;
      this.explicitContext.awaitingRangeEnd = /\b(?:and|to|through|thru)\s*[,.;]?\s*$/.test(normalized);
      this.explicitContext.awaitingVerse = true;
    }
    if (explicit.length === 0) return false;
    for (const ref of explicit) ref.resolver = "explicit";
    this.supersedeModel();
    this.publish(explicit);
    return true;
  }

  /**
   * Finds verse citations anywhere in a rolling transcript window, including
   * one split across finals ("Paul writes in Romans" | "8, verse 28.").
   *
   * Stateless on purpose: every segment in the window has already been through
   * analyzeExplicit, and replaying old announcements into its book/chapter
   * memory would corrupt it. Returns true when a citation was found, even if
   * it is already on the Operator, so the caller can consume the window.
   */
  analyzeWindowCitation(text: string): boolean {
    if (this.lifetime.signal.aborted) return false;
    const refs = matchExplicitScriptures(text, { splitMergedDigits: true })
      .filter((ref) => hasExplicitVerseSignal(ref.sourceText));
    if (refs.length === 0) return false;
    for (const ref of refs) ref.resolver = "explicit";
    this.supersedeModel();
    this.publish(refs);
    return true;
  }

  /**
   * A local resolution outranks the model: results for older requests become
   * review-only, and the playlist reading window starts over.
   */
  private supersedeModel(): void {
    this.resolutionGeneration++;
    this.resetPlanQuoteWindow();
  }

  /** Dedups, counts and emits. Returns the references that were new. */
  private publish(
    refs: ScriptureReference[],
    origin?: (TranscriptOrigin & { detectionStartedAt: number }) | null,
  ): ScriptureReference[] {
    const fresh = this.filterDedup(refs);
    this.statsData.cacheHits += refs.length - fresh.length;
    this.statsData.totalDetections += fresh.length;
    if (fresh.length > 0) this.emitDetection(fresh, origin);
    this.emit("stats", this.getStats());
    return fresh;
  }

  /** Whether this transcript names a book and chapter but has not supplied a verse yet. */
  isIncompleteExplicitCitation(text: string): boolean {
    const spoken = normalizeWordNumbers(text).trim();
    if (bareBookName(spoken)) return true;
    const refs = matchNormalizedCitations(this.withRememberedBook(spoken));
    return refs.length > 0 && refs.every((ref) => !hasExplicitVerseSignal(ref.sourceText));
  }

  /** "Chapter 8" after "Go to Romans." means Romans 8. Takes normalized text. */
  private withRememberedBook(normalized: string): string {
    if (!CHAPTER_ONLY_RE.test(normalized)) return normalized;
    const book = this.pendingBook?.book ?? this.explicitContext?.book;
    return book ? `${book} ${normalized.replace(LEADING_FILLER_RE, "")}` : normalized;
  }

  /**
   * Tell the detector which transcript it is about to analyze.
   *
   * Set immediately before an `analyze*` call and read when references are
   * emitted, so every detection carries the moment its transcript arrived.
   * Without this the latency trace would start at parse time and silently hide
   * everything that happened before it.
   */
  beginTranscript(origin: TranscriptOrigin | null): void {
    this.transcriptOrigin = origin;
    this.detectionStartedAt = origin ? Date.now() : undefined;
  }

  /** Every detection emit goes through here so stamping cannot be forgotten. */
  private emitDetection(
    refs: ScriptureReference[],
    queuedOrigin?: (TranscriptOrigin & { detectionStartedAt: number }) | null,
  ): void {
    const origin = queuedOrigin ?? this.transcriptOrigin;
    if (origin) {
      for (const ref of refs) {
        ref.sttReceivedAt ??= origin.sttReceivedAt;
        ref.detectionStartedAt ??= queuedOrigin?.detectionStartedAt ?? this.detectionStartedAt;
        ref.transcriptSource ??= origin.source;
      }
    }
    this.emit("detection", refs);
  }

  setQuoteSearchProvider(provider: (phrase: string) => QuoteCandidate[]): void {
    this.quoteSearchProvider = provider;
  }

  analyzeQuoteRecovery(text: string): boolean {
    if (this.lifetime.signal.aborted || !this.quoteSearchProvider) return false;
    const refs = recoverDamagedQuote(text, this.quoteSearchProvider);
    if (!refs.length) return false;
    for (const ref of refs) ref.resolver = "quotation-local";
    this.supersedeModel();
    this.publish(refs);
    return true;
  }

  /** Supplies every local translation's verses for one chapter. */
  setChapterVerseProvider(
    provider: ((book: string, chapter: number) => QuoteCandidate[]) | null,
  ): void {
    this.chapterVerseProvider = provider;
  }

  /**
   * Resolves a quotation inside a chapter the speaker has named but not given
   * a verse for: "In John 3 Jesus says, for God so loved the world…". The
   * scope is the citation analyzeExplicit is already holding open, so it
   * covers "Go to John." | "Chapter 3." and lasts as long as that citation.
   * Returns true when a verse was identified, even if it was already shown.
   */
  analyzeChapterQuote(text: string): boolean {
    const scope = this.explicitContext;
    if (
      this.lifetime.signal.aborted ||
      !this.chapterVerseProvider ||
      !scope?.awaitingVerse ||
      scope.verseStart !== undefined ||
      !text.trim()
    ) {
      return false;
    }
    scope.quoteText = `${scope.quoteText ?? ""} ${text}`.slice(-CHAPTER_QUOTE_WINDOW_CHARS);
    scope.quoteVerses ??= tokenizeChapter(this.chapterVerseProvider(scope.book, scope.chapter));
    const match = matchChapterQuote(scope.quoteText, scope.quoteVerses);
    if (!match) return false;

    const ref: ScriptureReference = {
      book: scope.book,
      chapter: scope.chapter,
      verseStart: match.verse,
      confidence: match.confidence,
      detectionType: "quote",
      sourceText: text.slice(0, SOURCE_TEXT_MAX_CHARS),
      resolver: "quotation-local",
    };
    if (!isValidScriptureReference(ref)) return false;
    this.explicitContext = null;
    this.supersedeModel();
    this.publish([ref]);
    return true;
  }

  /**
   * Stops suppressing a reference whose card never reached the operator
   * (lookup failed) or was removed by them, so the next time it is spoken it
   * detects again. Model results stay suppressed until the normal expiry: the
   * model re-reads recent transcript, so a release must not resurrect a card
   * from speech the operator has already dealt with.
   */
  release(ref: { book: string; chapter: number; verseStart: number; verseEnd?: number }): void {
    for (const entry of this.dedupCache.values()) {
      if (referencesOverlap(entry.ref, ref)) entry.released = true;
    }
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

    this.emit("planProgress", match.entry.reference, match.entry.planItemId);
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
      resolver: "sermon-plan",
    };

    const fresh = this.publish([ref]);
    this.resetPlanQuoteWindow();
    if (fresh.length === 0) return false;
    this.resolutionGeneration++;
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
    this.lifetime.abort();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingText = null;
    this.pendingOrigin = null;
    this.explicitContext = null;
    this.removeAllListeners();
  }

  // ─── Queue / flush ─────────────────────────────────────────────────────────

  private flush(): void {
    if (this.lifetime.signal.aborted || !this.pendingText || this.processing)
      return;

    if (this.fallbackMode) {
      const text = this.pendingText;
      const origin = this.pendingOrigin;
      const generation = this.pendingGeneration;
      this.pendingText = null;
      this.pendingOrigin = null;
      this.runRegexDetection(text, origin, generation);
      return;
    }

    const text = this.pendingText;
    const origin = this.pendingOrigin;
    const generation = this.pendingGeneration;
    this.pendingText = null;
    this.pendingOrigin = null;
    this.processing = true;
    this.lastCallTime = Date.now();

    this.runDetection(text, origin, generation).finally(() => {
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

  private runRegexDetection(
    text: string,
    origin: (TranscriptOrigin & { detectionStartedAt: number }) | null = null,
    generation = this.resolutionGeneration,
  ): void {
    this.emit("processing", text);
    try {
      const parsed = matchExplicitScriptures(text);
      if (generation !== this.resolutionGeneration) return;
      for (const ref of parsed) ref.resolver = "explicit";
      const emitted = this.publish(parsed, origin);
      log.info("[ScriptureDetector] Offline regex analysis complete", {
        found: parsed.length,
        emitted: emitted.length,
      });
    } catch (err) {
      log.error("[ScriptureDetector] Regex detection error:", err);
    }
  }

  // ─── API call with retry ───────────────────────────────────────────────────

  private async runDetection(
    text: string,
    origin: (TranscriptOrigin & { detectionStartedAt: number }) | null = this.transcriptOrigin
      ? { ...this.transcriptOrigin, detectionStartedAt: this.detectionStartedAt ?? Date.now() }
      : null,
    generation = this.resolutionGeneration,
  ): Promise<void> {
    this.emit("processing", text);
    const start = Date.now();

    let lastErr: Error | null = null;
    let retryWithoutBackoff = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0 && !retryWithoutBackoff) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        log.warn("[ScriptureDetector] Retry", { attempt, backoffMs: backoff });
        await sleep(backoff);
      }
      retryWithoutBackoff = false;

      if (this.lifetime.signal.aborted) return;
      try {
        const raw = await this.callModel(text);
        if (this.lifetime.signal.aborted) return;
        const latency = Date.now() - start;

        this.statsData.totalCalls++;
        this.statsData.latencySum += latency;

        const parsed = parseResponse(raw);
        if (!parsed) {
          log.warn("[ScriptureDetector] Failed to parse response", {
            raw: raw.slice(0, 200),
            attempt,
          });
          if (attempt < MAX_RETRIES) {
            retryWithoutBackoff = true;
            continue;
          }
          this.statsData.errors++;
          this.emit("stats", this.getStats());
          return;
        }

        this.emit("requestSuccess");

        // A newer local detection landed while the model was working. Its
        // findings are kept — a quote it recognised may be a different verse
        // from the citation that superseded it — but they are too late to
        // auto-present, and chapter placeholders are dropped outright.
        const superseded = generation !== this.resolutionGeneration;
        const found = superseded
          ? parsed.filter((ref) => ref.detectionType !== "partial")
          : parsed;
        if (superseded) {
          log.info("[ScriptureDetector] AI result superseded; review only", {
            generation,
            found: found.length,
          });
        }

        for (const ref of found) {
          ref.resolver = "ai";
          if (superseded) ref.superseded = true;
        }

        const emitted = this.publish(found, origin);
        log.info("[ScriptureDetector] Analysis complete", {
          latencyMs: latency,
          found: parsed.length,
          emitted: emitted.length,
          model: this.cfg.model,
        });
        return;
      } catch (err) {
        if (this.lifetime.signal.aborted) return;
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
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(this.cfg.timeoutMs),
    ]);
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
      if (!isValidScriptureReference(ref)) return false;
      const key = dedupKey(ref);
      for (const [cachedKey, entry] of this.dedupCache) {
        if (entry.released && ref.resolver !== "ai") {
          if (referencesOverlap(entry.ref, ref)) this.dedupCache.delete(cachedKey);
          continue;
        }
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
    /\b\d+[\s,]+\d+(?:\s*(?:-|to|thru|through|and)\s*\d+)?\b/i.test(sourceText)
  );
}

function isAmbiguousRepeatedChapterPair(ref: ScriptureReference): boolean {
  if (ref.chapter !== ref.verseStart || ref.verseEnd !== undefined)
    return false;
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
    container.verseStart <= candidate.verseStart && containerEnd >= candidateEnd
  );
}

function referencesOverlap(
  a: { book: string; chapter: number; verseStart: number; verseEnd?: number },
  b: { book: string; chapter: number; verseStart: number; verseEnd?: number },
): boolean {
  return (
    a.book.toLowerCase() === b.book.toLowerCase() &&
    a.chapter === b.chapter &&
    a.verseStart <= (b.verseEnd ?? b.verseStart) &&
    b.verseStart <= (a.verseEnd ?? a.verseStart)
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
      if (!item || typeof item !== "object") continue;
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
        chapter: r.chapter,
        verseStart: r.verseStart,
        confidence: Math.max(0, Math.min(1, r.confidence)),
        detectionType: normalizeDetectionType(r.detectionType as string),
        sourceText: (r.sourceText as string).slice(0, SOURCE_TEXT_MAX_CHARS),
      };
      if (r.verseEnd != null) {
        if (typeof r.verseEnd !== "number") continue;
        ref.verseEnd = r.verseEnd;
      }
      if (isValidScriptureReference(ref)) valid.push(ref);
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

const BOOK_PATTERN =
  "(?:Gen(?:esis)?|Exo(?:dus)?|Lev(?:iticus)?|Num(?:bers)?|Deut(?:eronomy)?|Josh(?:ua)?|Judg(?:es)?|Ruth|" +
  "1\\s*Sam(?:uel)?|2\\s*Sam(?:uel)?|1\\s*Kings?|2\\s*Kings?|1\\s*Chr(?:onicles)?|2\\s*Chr(?:onicles)?|Ezra|Neh(?:emiah)?|Esth(?:er)?|Job|" +
  "Psa?(?:lms?)?|Prov(?:erbs)?|Eccl(?:esiastes)?|Song(?:\\s+of\\s+Solomon)?|Isa(?:iah)?|Jer(?:emiah)?|Lam(?:entations)?|Eze(?:kiel)?|Dan(?:iel)?|" +
  "Hos(?:ea)?|Joel|Amos|Obad(?:iah)?|Jon(?:ah)?|Mic(?:ah)?|Nah(?:um)?|Hab(?:akkuk)?|Zeph(?:aniah)?|Hag(?:gai)?|Zech(?:ariah)?|Mal(?:achi)?|" +
  "Matt(?:hew)?|Mark|Luke|John|Acts|Rom(?:ans)?|1\\s*Cor(?:inthians)?|2\\s*Cor(?:inthians)?|Gal(?:atians)?|Eph(?:esians)?|Phil(?:ippians)?|Col(?:ossians)?|" +
  "1\\s*Thess?(?:alonians)?|2\\s*Thess?(?:alonians)?|1\\s*Tim(?:othy)?|2\\s*Tim(?:othy)?|Tit(?:us)?|Phlm|Philemon|Heb(?:rews)?|Jas|James|" +
  "1\\s*Pet(?:er)?|2\\s*Pet(?:er)?|1\\s*Jn|1\\s*John|2\\s*Jn|2\\s*John|3\\s*Jn|3\\s*John|Jude|Rev(?:elation)?s?)";

/** Every spelling in CANONICAL_BOOKS, longest first so "1 john" beats "john". */
const BOOK_NAME_ALTERNATION = Object.keys(CANONICAL_BOOKS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NAMED_BOOK_RE = new RegExp(`\\b(?:${BOOK_NAME_ALTERNATION})\\b`, "i");
// A mixed alphanumeric number token straight after a book: "Psalm 1one512".
const CORRUPTED_CITATION_RE = new RegExp(
  `\\b(?:${BOOK_NAME_ALTERNATION})\\b\\s+(?:chapter\\s+)?(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\\d)[a-z0-9]+\\b`,
  "i",
);

// Book, chapter, then optionally a verse and a range end. Groups: 1 book,
// 2 chapter, 3 verse, 4 range separator, 5 range end. A repeated chapter
// ("John nineteen nineteen twenty eight to thirty") is skipped.
const CITATION_RE = new RegExp(
  `\\b(${BOOK_PATTERN})\\b\\s*(?:chapter\\s+)?(\\d+)\\b(?:\\s+\\2(?=\\s+(?:verses?\\s+)?\\d+\\s*(?:-|thru|through|to|and)))?(?:\\s*[:,\\s]\\s*(?:verses?\\s+)?(\\d+)(?:(\\s*,\\s*|\\s*(?:-|thru|through|to|and)\\s*|\\s+)(\\d+))?)?`,
  "gi",
);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD_ALTERNATION = Object.keys(NUMBER_WORDS).join("|");
const SINGLE_NUMBER_WORD_RE = new RegExp(`\\b(?:${NUMBER_WORD_ALTERNATION})\\b`, "g");
/** A chapter number, spoken or in digits, follows — scopes book-name repairs. */
const NUMBER_AHEAD = `(?=\\s+(?:chapter\\s+)?(?:\\d+|${NUMBER_WORD_ALTERNATION})\\b)`;

/** Filler that can open any spoken citation fragment: "So,", "And now". */
const LEADING_FILLER = "(?:(?:and|so|now|okay|ok),?\\s+)?";
const LEADING_FILLER_RE = new RegExp(`^${LEADING_FILLER}`);
/** "Chapter 8" on its own, after the book was announced separately. */
const CHAPTER_ONLY_RE = new RegExp(`^${LEADING_FILLER}chapter\\s+\\d+`);

/**
 * Spoken lead-in before a bare book name: "Go to Romans.", "Open your Bible
 * to the book of Romans." The book is remembered for a following "chapter N".
 */
const BOOK_ONLY_LEAD_IN = new RegExp(
  "^" +
    LEADING_FILLER +
    "(?:(?:let's|let\\s+us|we're\\s+going\\s+to|we\\s+are\\s+going\\s+to|i\\s+want\\s+you\\s+to|please)\\s+)?" +
    "(?:(?:go|turn|open|flip|come)\\s+(?:with\\s+me\\s+)?(?:(?:your|our)\\s+bibles?\\s+)?(?:with\\s+me\\s+)?(?:to|in(?:to)?)\\s+)?" +
    "(?:the\\s+(?:book|gospel|epistle|letter)\\s+of\\s+)?",
);

/**
 * Lead-ins between a chapter and its verse: "from verse", "beginning at
 * verse", "and we begin to read from verse", "and the Bible says in verse",
 * or a sentence break ("Romans chapter 8. Look at verse 28."). Bounded to a
 * verse number so ordinary speech before unrelated numbers is untouched.
 */
const VERSE_LEAD_IN_RE = new RegExp(
  "(?:[,.;]\\s*|\\s+)" +
    LEADING_FILLER +
    "(?:(?:let's|let\\s+us|we(?:'ll|\\s+will|\\s+shall|\\s+are\\s+going\\s+to)?|i\\s+want\\s+us\\s+to)\\s+)?" +
    "(?:(?:begin|start)(?:ning|ing)?\\s+(?:to\\s+)?)?" +
    "(?:(?:look(?:ing)?\\s+at|read(?:ing)?|go(?:ing)?\\s+to|turn(?:ing)?\\s+to|see)\\s+)?" +
    "(?:(?:the\\s+bible|it|he|she|paul|jesus|scripture)\\s+(?:says|said)\\s+)?" +
    "(?:(?:at|from|with|in|on)\\s+)?" +
    "(?=verses?\\s+\\d)",
  "g",
);

/** "verse 28 of Romans chapter 8" → "romans 8 verse 28". */
const VERSE_OF_BOOK_RE = new RegExp(
  `\\bverses?\\s+(\\d+(?:\\s*(?:-|to|through|thru|and)\\s*\\d+)?)\\s+(?:of|in|from)\\s+(?:the\\s+book\\s+of\\s+)?(${BOOK_PATTERN})\\s+(?:chapter\\s+)?(\\d+)\\b`,
  "gi",
);

// ─── Book-name repairs ────────────────────────────────────────────────────────
// STT spellings of book names. Unambiguous misspellings are always repaired;
// words that are also ordinary speech ("Roman", "Hebrew", "the Philippines")
// only when a chapter number follows.

const NUMBERED_BOOKS =
  "(?:samuel|kings?|chronicles|corinthians|thessalonians|timothy|peter|john)";
const PHILIPPIANS_MISSPELLING_RE = /\b(?:phill?ipp?ians?|filipp?ians?)\b/g;
const SONG_OF_SONGS_RE = /\bsongs?\s+of\s+(?:songs|solomon)\b/g;
const PSALMS_MISSPELLING_RE = new RegExp(`\\b(?:pslams?|salms?${NUMBER_AHEAD})`, "g");
const PHILIPPINES_RE = new RegExp(`\\bphilippines${NUMBER_AHEAD}`, "g");
const SINGULAR_BOOK_RE = new RegExp(
  `\\b(roman|hebrew|galatian|ephesian|colossian|corinthian|thessalonian)${NUMBER_AHEAD}`,
  "g",
);
// "First/1st Corinthians", "second/2nd Timothy". Restricted to numbered books
// so "the second time" is left alone.
const ORDINAL_PREFIX_RE = new RegExp(
  `\\b(first|second|third|1st|2nd|3rd)\\s+(?=${NUMBERED_BOOKS}\\b)`,
  "g",
);
const ORDINAL_DIGIT: Record<string, string> = {
  first: "1", second: "2", third: "3", "1st": "1", "2nd": "2", "3rd": "3",
};
// "I Corinthians 13", "II Timothy 3" — only with a chapter, so the pronoun in
// "I John …" is never read as a book number.
const ROMAN_PREFIX_RE = new RegExp(
  `\\b(i{1,3})\\s+(?=${NUMBERED_BOOKS}${NUMBER_AHEAD})`,
  "g",
);

function repairBookNames(text: string): string {
  return text
    .replace(PHILIPPIANS_MISSPELLING_RE, "philippians")
    .replace(SONG_OF_SONGS_RE, "song of solomon")
    .replace(PSALMS_MISSPELLING_RE, "psalms")
    .replace(PHILIPPINES_RE, "philippians")
    .replace(SINGULAR_BOOK_RE, "$1s")
    .replace(ORDINAL_PREFIX_RE, (_match, ordinal: string) => `${ORDINAL_DIGIT[ordinal]} `)
    .replace(ROMAN_PREFIX_RE, (_match, numeral: string) => `${numeral.length} `);
}

function canonicalBookName(raw: string): string | undefined {
  const spaced = raw.toLowerCase().trim().replace(/\s+/g, " ");
  for (const key of [spaced, spaced.replace(/\s+/g, "")]) {
    if (Object.hasOwn(CANONICAL_BOOKS, key)) return CANONICAL_BOOKS[key];
  }
  return undefined;
}

/** The canonical book when a normalized segment only announces one: "Go to Romans." */
function bareBookName(normalized: string): string | undefined {
  // Deepgram punctuates, so "Romans." must still count as a bare book name.
  return canonicalBookName(
    normalized.replace(/[.,!?;:]+$/, "").replace(BOOK_ONLY_LEAD_IN, ""),
  );
}

/**
 * Smart formatting sometimes fuses "three sixteen" into "316". Returns the
 * only chapter:verse reading that exists, or null when the number is a real
 * chapter or more than one reading is valid ("Genesis 111": 1:11 or 11:1).
 */
function splitMergedChapterVerse(
  book: string,
  digits: string,
): { chapter: number; verse: number } | null {
  if (!/^\d{3,4}$/.test(digits)) return null;
  if (isValidScriptureReference({ book, chapter: Number(digits), verseStart: 1 })) {
    return null;
  }
  const readings: Array<{ chapter: number; verse: number }> = [];
  for (let cut = 1; cut < digits.length; cut++) {
    const verseDigits = digits.slice(cut);
    if (verseDigits.startsWith("0")) continue;
    const chapter = Number(digits.slice(0, cut));
    const verse = Number(verseDigits);
    if (isValidScriptureReference({ book, chapter, verseStart: verse })) {
      readings.push({ chapter, verse });
    }
  }
  return readings.length === 1 ? readings[0] : null;
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeWordNumbers(text: string): string {
  let normalized = repairBookNames(text.toLowerCase().replace(/[–—]/g, "-"));
  normalized = normalized.replace(/\b(chapter|verses?)\s+number\s+/g, "$1 ");
  normalized = normalized.replace(/\bacts\s+of\s+the\s+apostles?\b/g, "acts");

  // Deepgram occasionally joins one half of a spoken compound number while
  // rendering the other half differently: "2four" / "twenty4" for 24.
  normalized = normalized.replace(
    /\b([2-9])(one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_match, tensDigit: string, unit: string) =>
      String(Number(tensDigit) * 10 + NUMBER_WORDS[unit]),
  );
  normalized = normalized.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)([1-9])\b/g,
    (_match, tens: string, unitDigit: string) =>
      String(NUMBER_WORDS[tens] + Number(unitDigit)),
  );

  // Psalm is the only Bible book with three-digit chapter numbers. Speakers
  // commonly say "Psalm one thirty nine" (139) without saying "hundred".
  normalized = normalized.replace(
    /\b(psalms?)\s+one(?:\s+hundred(?:\s+and)?)?\s+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/g,
    (_match, book: string, remainder: string, unit?: string) =>
      `${book} ${100 + NUMBER_WORDS[remainder] + (unit ? NUMBER_WORDS[unit] : 0)}`,
  );

  // Replace compound word numbers (e.g. "twenty-eight" or "twenty eight")
  normalized = normalized.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_match, tens: string, ones: string) => String(NUMBER_WORDS[tens] + NUMBER_WORDS[ones]),
  );

  // Replace single word numbers
  normalized = normalized.replace(SINGLE_NUMBER_WORD_RE, (word) => String(NUMBER_WORDS[word]));

  // "one hundred and five" → 105. Psalm chapters are handled above; this covers
  // verse numbers, which otherwise collapse to the leading "1".
  normalized = normalized.replace(
    /\b([1-9])\s+hundred(?:\s+and)?\s+(\d{1,2})\b/g,
    (_match, hundreds: string, rest: string) =>
      String(Number(hundreds) * 100 + Number(rest)),
  );
  normalized = normalized.replace(
    /\b([1-9])\s+hundred\b/g,
    (_match, hundreds: string) => String(Number(hundreds) * 100),
  );

  // "chapter 11, the 6th verse" → "chapter 11, verse 6".
  normalized = normalized.replace(
    /\bthe\s+(\d+)(?:st|nd|rd|th)\s+verse\b/g,
    "verse $1",
  );
  normalized = normalized.replace(VERSE_LEAD_IN_RE, " ");
  normalized = normalized.replace(VERSE_OF_BOOK_RE, "$2 $3 verse $1");

  normalized = normalized.replace(
    /\b(jude|obadiah|philemon|2 john|3 john)\s+(?=verses?\s+\d+)/g,
    "$1 1 ",
  );
  normalized = normalized.replace(
    /(\bverse\s+|:\s*)\d+\s*[,.;-]?\s*(?:sorry|i mean|rather|make that)\s*[,.;-]?\s*(?:verse\s+)?(\d+)/g,
    "$1$2",
  );
  return normalized;
}

// Only flag mixed alphanumeric number tokens immediately following a book.
// Known recoverable forms (e.g. twenty4) have already been normalized.
export function hasCorruptedScriptureCitation(text: string): boolean {
  return CORRUPTED_CITATION_RE.test(normalizeWordNumbers(text));
}

interface MatchOptions {
  /**
   * Split a fused chapter+verse number ("John 316" → John 3:16) when exactly
   * one split names a real verse. Settled speech only: an interim
   * "Jeremiah 291" is usually "Jeremiah 29:11" still arriving.
   */
  splitMergedDigits?: boolean;
}

export function matchExplicitScriptures(
  text: string,
  options: MatchOptions = {},
): ScriptureReference[] {
  return matchNormalizedCitations(normalizeWordNumbers(text), options);
}

function matchNormalizedCitations(
  normalized: string,
  options: MatchOptions = {},
): ScriptureReference[] {
  const results: ScriptureReference[] = [];
  CITATION_RE.lastIndex = 0;

  let match;
  while ((match = CITATION_RE.exec(normalized)) !== null) {
    const [source, rawBook, chapterStr, verseStartStr, separator, verseEndStr] = match;
    const canonicalBook = canonicalBookName(rawBook);
    if (!canonicalBook) continue;

    let chapter = Number(chapterStr);
    let verseStart = verseStartStr ? Number(verseStartStr) : 1;
    let verseEnd = verseEndStr ? Number(verseEndStr) : undefined;
    let sourceText = source;
    // "Luke 4:18,19" is a range; "Luke 4:18, 20" names two verses, and only
    // the first is kept rather than inventing 18–20.
    if (verseEnd !== undefined && separator.includes(",") && verseEnd !== verseStart + 1) {
      verseEnd = undefined;
    }
    const split = !verseStartStr && options.splitMergedDigits
      ? splitMergedChapterVerse(canonicalBook, chapterStr)
      : null;
    if (split) {
      chapter = split.chapter;
      verseStart = split.verse;
      sourceText = `${rawBook} ${split.chapter}:${split.verse}`;
    }

    const ref: ScriptureReference = {
      book: canonicalBook,
      chapter,
      verseStart,
      verseEnd,
      confidence: 0.9,
      detectionType: "explicit",
      sourceText,
    };
    const verseOffset = source.search(/\bverses?\s+/);
    const list = verseOffset < 0 ? null : normalized.slice(match.index + verseOffset).match(
      /^verses?\s+(\d+(?:(?:,\s*(?:and\s+)?|\s+and\s+)\d+)+)/,
    );
    if (list) {
      const listSource = normalized.slice(match.index, match.index + verseOffset + list[0].length);
      const numbers = list[1].match(/\d+/g)!.map(Number);
      if (numbers.length === 2 && numbers[1] === numbers[0] + 1) {
        results.push({ ...ref, verseStart: numbers[0], verseEnd: numbers[1], sourceText: listSource });
      } else {
        results.push(...numbers.map(verseStart => ({ ...ref, verseStart, verseEnd: undefined, sourceText: listSource })));
      }
      CITATION_RE.lastIndex = match.index + verseOffset + list[0].length;
    } else results.push(ref);
  }

  return results.filter(isValidScriptureReference);
}
