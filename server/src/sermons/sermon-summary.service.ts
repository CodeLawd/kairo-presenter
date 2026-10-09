import Anthropic from '@anthropic-ai/sdk'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { SermonSummary, SummaryErrorCode } from '@contracts/contracts'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig, SermonReasoningEffort } from '../config/env'
import { OrgSecretsService } from '../orgs/org-secrets.service'
import {
  buildSummaryPrompt,
  buildSummaryReviewPrompt,
  SUMMARY_REVIEW_SYSTEM_PROMPT,
  JSON_OUTPUT_INSTRUCTION,
  SERMON_SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
} from './prompt'
import { parseSermonSummary, SummaryFormatError } from './sermon-summary.parse'

export type { SummaryErrorCode }

export class SummaryError extends Error {
  constructor(
    readonly code: SummaryErrorCode,
    message: string,
    /** False for a bad key or a malformed reply — retrying those wastes minutes. */
    readonly retryable = false,
  ) {
    super(message)
  }
}

export interface SummaryInput {
  orgId: string
  title: string
  speaker: string
  preachedAt: Date
  transcriptText: string
  detectedScriptures: readonly string[]
}

export interface SummaryResult {
  summary: SermonSummary
  model: string
}

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

/** The provider's own words, trimmed to something loggable and never a key. */
function describeProviderError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string }
    const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
    if (message) return message.slice(0, 300)
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body.trim().slice(0, 300)
}
const REQUEST_TIMEOUT_MS = 180_000
/**
 * Generous on purpose.
 *
 * Reasoning models bill and count their thinking against this budget, and a
 * real sermon spends most of it there — one 1,600-word service used 4,993
 * reasoning tokens before writing a word. You are only charged for tokens
 * actually produced, so a high ceiling costs nothing and is the difference
 * between a recap and a truncated one.
 */
const MAX_OUTPUT_TOKENS = 32_000

/**
 * Anthropic's effort scale has no "none" — and disabling thinking outright on
 * Opus 5 has its own failure modes, so the floor here is "low" rather than off.
 */
const ANTHROPIC_EFFORT: Record<SermonReasoningEffort, 'low' | 'medium' | 'high' | 'max'> = {
  none: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
}

/** DeepSeek's scale has no "medium"; the API itself folds it into "high". */
const DEEPSEEK_EFFORT: Record<SermonReasoningEffort, 'none' | 'low' | 'high' | 'max'> = {
  none: 'none',
  low: 'low',
  medium: 'high',
  high: 'high',
  max: 'max',
}

/**
 * Turns a transcript into a recap.
 *
 * Narrow on purpose: one method, no database, no status writes. That is what
 * lets the e2e suite swap it for a canned result and test everything around it
 * without spending a church's money on every test run.
 */
@Injectable()
export class SermonSummaryService {
  private readonly log = new Logger(SermonSummaryService.name)

  constructor(
    private readonly secrets: OrgSecretsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async generate(input: SummaryInput): Promise<SummaryResult> {
    const vault = await this.secrets.get(input.orgId)
    const prompt = buildSummaryPrompt(input)

    if (!vault.anthropicApiKey && !vault.deepseekApiKey) {
      throw new SummaryError(
        'no-api-key',
        'Add an Anthropic or DeepSeek API key to your church vault to generate recaps.',
      )
    }

    // One classifier for both providers: the caller only needs to know whether
    // another attempt is worth making.
    try {
      const request = (userPrompt: string, systemPrompt: string): Promise<SummaryResult> =>
        vault.anthropicApiKey
          ? this.viaAnthropic(vault.anthropicApiKey, userPrompt, input.transcriptText, systemPrompt)
          : this.viaDeepSeek(vault.deepseekApiKey, userPrompt, input.transcriptText, systemPrompt)
      const draft = await request(prompt, SUMMARY_SYSTEM_PROMPT)
      return await request(buildSummaryReviewPrompt(input, draft.summary), SUMMARY_REVIEW_SYSTEM_PROMPT)
    } catch (error) {
      throw this.toSummaryError(error)
    }
  }

  private async viaAnthropic(
    apiKey: string,
    prompt: string,
    transcriptText: string,
    systemPrompt: string,
  ): Promise<SummaryResult> {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: REQUEST_TIMEOUT_MS })
    const model = this.config.sermons.model
    const effort = ANTHROPIC_EFFORT[this.config.sermons.reasoningEffort]
    const startedAt = Date.now()

    // Streamed: a long transcript with a large max_tokens is exactly the shape
    // that trips an HTTP timeout on a plain create.
    const stream = client.messages.stream({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      output_config: {
        effort,
        format: {
          type: 'json_schema',
          schema: SERMON_SUMMARY_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [{ role: 'user', content: prompt }],
    })
    const message = await stream.finalMessage()

    // Thinking is billed as output here and is not reported separately, so the
    // effort level is the only handle on it — log it next to the cost it drove.
    this.log.log(
      `Recap via ${model} effort=${effort} in ${Date.now() - startedAt}ms ` +
        `(in ${message.usage.input_tokens}, out ${message.usage.output_tokens}, ` +
        `stop ${message.stop_reason})`,
    )

    if (message.stop_reason === 'refusal') {
      throw new SummaryError(
        'refusal',
        'The model declined to summarize this service. Regenerate, or write the recap by hand.',
      )
    }

    const body = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    return { summary: parseSermonSummary(body, transcriptText), model }
  }

  /**
   * DeepSeek speaks the OpenAI wire format. One `fetch` rather than a second
   * SDK on the server — the request is a single POST and the response is one
   * JSON body.
   */
  private async viaDeepSeek(
    apiKey: string,
    prompt: string,
    transcriptText: string,
    systemPrompt: string,
  ): Promise<SummaryResult> {
    const model = this.config.sermons.deepseekModel
    const reasoningEffort = DEEPSEEK_EFFORT[this.config.sermons.reasoningEffort]
    const startedAt = Date.now()
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        // Thinking is on by default at "high" on deepseek-flash. Left unset, a
        // recap spends thousands of invisible tokens before writing a word.
        reasoning_effort: reasoningEffort,
        response_format: { type: 'json_object' },
        messages: [
          // The shape goes in the prompt here: DeepSeek has no structured-output
          // schema, and its json_object mode also requires the word "json".
          { role: 'system', content: `${systemPrompt}\n\n${JSON_OUTPUT_INSTRUCTION}` },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500
      // A bare status code sends whoever reads it guessing between a bad model
      // name, a rejected parameter and an expired key. DeepSeek says which in
      // the body; a failed read must not mask the status we already have.
      const detail = await response.text().then(describeProviderError, () => '')
      throw new SummaryError(
        'provider',
        `DeepSeek refused the request (${response.status})${detail ? `: ${detail}` : '.'}`,
        retryable,
      )
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[]
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    const choice = payload.choices?.[0]

    // The one number worth having: reasoning tokens are invisible in the recap
    // but are most of the wait, so a slow service is diagnosable from the log.
    const usage = payload.usage
    const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0
    this.log.log(
      `Recap via ${model} effort=${reasoningEffort} in ${Date.now() - startedAt}ms ` +
        `(in ${usage?.prompt_tokens ?? 0}, out ${usage?.completion_tokens ?? 0}, ` +
        `reasoning ${reasoningTokens}, finish ${choice?.finish_reason ?? 'unknown'})`,
    )
    // A response cut off at the token ceiling is not malformed JSON, and saying
    // so sends whoever reads the error looking in entirely the wrong place.
    if (choice?.finish_reason === 'length') {
      throw new SummaryError(
        'provider',
        `${model} ran out of output budget before finishing the recap. ` +
          'A reasoning model can spend the whole budget thinking — try a faster model.',
      )
    }
    const body = choice?.message?.content ?? ''
    return { summary: parseSermonSummary(body, transcriptText), model }
  }

  /**
   * Classify a failure once, here, so the caller only has to decide whether to
   * retry. A bad key retried three times just burns ten minutes.
   */
  private toSummaryError(error: unknown): SummaryError {
    if (error instanceof SummaryError) return error
    if (error instanceof SummaryFormatError) {
      return new SummaryError('format', error.message)
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return new SummaryError(
        'no-api-key',
        'Your church Anthropic key was rejected. Check it under API keys.',
      )
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new SummaryError('provider', 'The model provider is rate limiting us.', true)
    }
    if (error instanceof Anthropic.APIError) {
      const retryable = typeof error.status === 'number' && error.status >= 500
      return new SummaryError('provider', `The model provider returned an error.`, retryable)
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new SummaryError('timeout', 'The model took too long to answer.', true)
    }
    this.log.warn(`Unclassified summary failure: ${(error as Error)?.message ?? 'unknown'}`)
    return new SummaryError('provider', 'The recap could not be generated.', true)
  }
}
