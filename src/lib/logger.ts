import { config } from "../config";

const SENSITIVE_KEY_PATTERN = /(secret|token|key|password|private|authorization|signature|accountNumber|account_number|authorizationUrl|paymentAuthorizationUrl)/i;
const SENSITIVE_VALUE_PATTERN = /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk_(test|live)_[A-Za-z0-9]+|https:\/\/checkout\.paystack[^\s"']+|\b\d{6,20}\b)/gi;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[Filtered]" : redact(entry),
      ])
    );
  }
  if (typeof value === "string") return value.replace(SENSITIVE_VALUE_PATTERN, "[Filtered]");
  return value;
}

function redactArgs(args: any[]) {
  return args.map(redact);
}

export function log(message: string, ...args: any[]) {
  if (config.app.env !== "production" || config.app.logLevel === "debug") {
    console.log(`[LOG] ${message}`, ...redactArgs(args));
  }
}

export function info(message: string, ...args: any[]) {
  console.info(`[INFO] ${message}`, ...redactArgs(args));
}

export function warn(message: string, ...args: any[]) {
  console.warn(`[WARN] ${message}`, ...redactArgs(args));
}

export function error(message: string, ...args: any[]) {
  console.error(`[ERROR] ${message}`, ...redactArgs(args));
}
