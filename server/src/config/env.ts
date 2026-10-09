/**
 * Environment contract, validated once at boot.
 *
 * A missing secret must stop the process here rather than surface as a runtime
 * 500 on someone's first login. Optional integrations (Google, SMTP) are the
 * exception: unset means "feature off", not "broken", so a developer can run
 * the whole API with nothing but a Mongo URL.
 */
export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  mongoUrl: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  webOrigins: string[];
  publicWebUrl: string;
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  } | null;
  mail: { apiKey: string; fromEmail: string; fromName: string } | null;
  /** 32-byte material (base64 or passphrase) for org API-key vault AES-GCM. */
  vaultEncryptionKey: string;
  /**
   * Superadmins, by email (SUPERADMIN_EMAILS, comma-separated; ADMIN_EMAILS is
   * read too, its earlier name). Config rather than data, so the owner of the
   * platform can never be removed from the website. Superadmins grant and
   * revoke the database-held `admin` role. Empty = no one.
   */
  superadminEmails: string[];
  /**
   * Shared secret the website sends when it records an installer download
   * (DOWNLOAD_INGEST_KEY). Unset = download tracking is off.
   */
  downloadIngestKey: string | null;
  sermons: SermonConfig;
}

/**
 * How hard the model thinks before writing the recap.
 *
 * Provider-neutral, because the two providers spell it differently: Anthropic's
 * `output_config.effort` has no "none", and DeepSeek's `reasoning_effort` has no
 * "medium". `SermonSummaryService` maps this onto each.
 */
export type SermonReasoningEffort = "none" | "low" | "medium" | "high" | "max";

const REASONING_EFFORTS: readonly SermonReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "max",
];

/** Recap generation. The model is configurable so a church can trade cost for depth. */
export interface SermonConfig {
  /** Anthropic model used when the org has an Anthropic key. */
  model: string;
  /** DeepSeek model used when the org only has a DeepSeek key. */
  deepseekModel: string;
  /** Thinking depth before the recap is written. */
  reasoningEffort: SermonReasoningEffort;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  const production = nodeEnv === "production";

  const jwtSecret = env.JWT_SECRET?.trim() ?? "";
  if (!jwtSecret) throw new ConfigError("JWT_SECRET is required");
  // A short secret is a weak secret; refusing it in production is cheaper than
  // discovering it after tokens have been issued.
  if (production && jwtSecret.length < 32) {
    throw new ConfigError(
      "JWT_SECRET must be at least 32 characters in production",
    );
  }

  const mongoUrl = env.MONGO_URL?.trim() ?? "";
  if (!mongoUrl) throw new ConfigError("MONGO_URL is required");

  // Production must name the website: falling back to localhost there breaks
  // Google sign-in, email links and the cookie origin, and the failure would
  // surface somewhere else with a misleading message.
  if (production && !env.PUBLIC_WEB_URL?.trim()) {
    throw new ConfigError("PUBLIC_WEB_URL is required in production (the website address, e.g. https://kairo-presenter.vercel.app)");
  }
  const publicWebUrl = (env.PUBLIC_WEB_URL?.trim() || "http://localhost:3001").replace(/\/$/, "");

  const google =
    env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()
      ? {
          clientId: env.GOOGLE_CLIENT_ID.trim(),
          clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
          callbackUrl:
            env.GOOGLE_CALLBACK_URL?.trim() ||
            `${publicWebUrl}/v1/auth/google/callback`,
        }
      : null;

  if (google) {
    const expected = `${publicWebUrl}/v1/auth/google/callback`;
    if (google.callbackUrl !== expected) {
      throw new ConfigError(`GOOGLE_CALLBACK_URL must be ${expected} so Google sign-in sets its cookie on the website origin`);
    }
  }

  // Brevo is the transport. Unset means "log the message instead of sending it",
  // which is what lets the whole API run with no third-party account at all.
  const brevoKey = env.BREVO_API_KEY?.trim();
  const senderEmail = env.BREVO_SENDER_EMAIL?.trim();
  // Deliberately no default sender. Brevo rejects any address it has not
  // verified, so a plausible-looking fallback means every email is dropped by
  // the provider — the failure lands in a log nobody is reading while someone
  // waits for a code that is never coming.
  if (brevoKey && !senderEmail) {
    throw new ConfigError(
      "BREVO_API_KEY is set but BREVO_SENDER_EMAIL is missing. It must be an address verified in Brevo, or every send is rejected.",
    );
  }
  const mail =
    brevoKey && senderEmail
      ? {
          apiKey: brevoKey,
          fromEmail: senderEmail,
          fromName: env.BREVO_SENDER_NAME?.trim() || "Kairo",
        }
      : null;

  const vaultEncryptionKey = env.VAULT_ENCRYPTION_KEY?.trim() ?? "";
  if (!vaultEncryptionKey) {
    throw new ConfigError("VAULT_ENCRYPTION_KEY is required");
  }
  if (production && vaultEncryptionKey.length < 32) {
    throw new ConfigError(
      "VAULT_ENCRYPTION_KEY must be at least 32 characters in production",
    );
  }

  return {
    nodeEnv,
    port: toInt(env.PORT, 3000),
    mongoUrl,
    jwtSecret,
    accessTokenTtl: env.ACCESS_TOKEN_TTL?.trim() || "15m",
    refreshTokenTtlDays: toInt(env.REFRESH_TOKEN_TTL_DAYS, 60),
    webOrigins: (env.WEB_ORIGIN ?? "http://localhost:3001")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    publicWebUrl,
    google,
    mail,
    vaultEncryptionKey,
    superadminEmails: (env.SUPERADMIN_EMAILS ?? env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    downloadIngestKey: env.DOWNLOAD_INGEST_KEY?.trim() || null,
    sermons: {
      // The recap is the whole point of the feature and it is read by people
      // who were not there, so quality wins over a few cents a service. The
      // church supplies the key, so make the trade changeable without a deploy.
      model: env.SERMON_MODEL?.trim() || "claude-opus-5",
      // Flash, not pro: DeepSeek's reasoning models spend output budget
      // thinking, and on a real sermon v4-pro consumed an 8k budget entirely on
      // reasoning and emitted nothing. Flash returns a complete recap in a third
      // of the time, and from 2026-09-14 v4-pro routes to this same model anyway.
      deepseekModel: env.SERMON_DEEPSEEK_MODEL?.trim() || "deepseek-flash",
      // Both providers default to "high" thinking, which nobody here chose. A
      // recap is extraction, not a problem to reason through — the thinking is
      // pure latency on the parts that matter least. "low" keeps enough for the
      // two parts that do need judgment (segmenting an hour of unpunctuated ASR
      // into points, and deciding which scriptures were actually cited) without
      // spending thousands of invisible tokens before the first word.
      reasoningEffort: toReasoningEffort(env.SERMON_REASONING_EFFORT),
    },
  };
}

function toReasoningEffort(value: string | undefined): SermonReasoningEffort {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "low";
  const match = REASONING_EFFORTS.find((effort) => effort === normalized);
  // A typo here would silently restore a provider default nobody chose, and the
  // symptom — recaps got slow again — points nowhere near this line.
  if (!match) {
    throw new ConfigError(
      `SERMON_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")}`,
    );
  }
  return match;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
