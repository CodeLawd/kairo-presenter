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

  const google =
    env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()
      ? {
          clientId: env.GOOGLE_CLIENT_ID.trim(),
          clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
          callbackUrl:
            env.GOOGLE_CALLBACK_URL?.trim() ||
            "http://localhost:3000/v1/auth/google/callback",
        }
      : null;

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
    publicWebUrl: env.PUBLIC_WEB_URL?.trim() || "http://localhost:3001",
    google,
    mail,
    vaultEncryptionKey,
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
