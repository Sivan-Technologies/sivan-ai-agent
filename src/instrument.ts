import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

dotenv.config();

const SECRET_KEY_PATTERN = /(secret|token|key|password|private|authorization|signature|accountNumber|account_number|authorizationUrl|paymentAuthorizationUrl)/i;
const SECRET_VALUE_PATTERN = /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk_(test|live)_[A-Za-z0-9]+|https:\/\/checkout\.paystack[^\s"']+)/gi;

function envFlag(key: string, fallback = false) {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function envNumber(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function redact(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 8) return "[Truncated]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.slice(0, 50).map((entry) => redact(entry, seen, depth + 1));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[Filtered]" : redact(entry, seen, depth + 1),
      ])
    );
  }
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_PATTERN, "[Filtered]");
  }
  return value;
}

function scrub(event: any) {
  return redact(event) as any;
}

const dsn = process.env.SENTRY_DSN?.trim();
const isProduction = process.env.NODE_ENV === "production";

if (dsn && !Sentry.isInitialized()) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: envNumber("SENTRY_TRACES_SAMPLE_RATE", isProduction ? 0.1 : 0),
    profileSessionSampleRate: envNumber("SENTRY_PROFILE_SESSION_SAMPLE_RATE", 0),
    profileLifecycle: "trace",
    enableLogs: envFlag("SENTRY_ENABLE_LOGS", false),
    sendDefaultPii: envFlag("SENTRY_SEND_DEFAULT_PII", false),
    beforeSend: scrub,
    beforeSendTransaction: scrub,
    beforeSendLog: scrub,
  });
}

export { Sentry };

export const __test__ = {
  redactForSentry: redact,
};
