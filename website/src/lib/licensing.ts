import type { LicensedFeature } from "@contracts/licensing";
export const FEATURES: Record<LicensedFeature, string> = {
  presentation: "Presentation",
  transcription: "Live transcription",
  scripture: "Scripture",
  summaries: "Sermon recaps",
  translation: "Translation",
  webSearch: "Web search",
};
export const PROVIDERS = {
  deepgram: "Deepgram",
  bible: "Bible API",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  brave: "Brave Search",
  googleTranslate: "Google Translate",
} as const;
export function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request failed. Please try again.";
}
export function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "No expiry";
}
export function integer(
  value: string,
  label: string,
  min = 0,
  max = 1_000_000,
): number {
  const n = Number(value);
  if (!value.trim() || !Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
