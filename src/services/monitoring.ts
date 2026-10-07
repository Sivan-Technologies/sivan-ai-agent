import * as Sentry from "@sentry/node";
import { warn } from "../lib/logger";

export type OperationalEventLevel = "warning" | "error";

export interface OperationalEvent {
  id: string;
  level: OperationalEventLevel;
  message: string;
  context: Record<string, any>;
  error?: string;
  createdAt: string;
  service?: string;
  location?: string;
  caller?: string;
}

const MAX_EVENTS = 100;
const operationalEvents: OperationalEvent[] = [];
const SENSITIVE_CONTEXT_KEY = /(secret|token|password|authorization|signature|accountnumber|account_number|bvn|nin|document_number)/i;
const DEBUG_ALERT_PATTERN = /(webhook|signature|debugger|abuse reputation|abuse trend|provider.*mismatch|verification reference mismatch|did not match|invalid .*payload|missing .*signature)/i;

function pushOperationalEvent(event: Omit<OperationalEvent, "id" | "createdAt">) {
  const record: OperationalEvent = {
    id: `ops-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    ...event,
  };

  operationalEvents.unshift(record);
  if (operationalEvents.length > MAX_EVENTS) {
    operationalEvents.length = MAX_EVENTS;
  }

  void sendAlert(record);
  return record;
}

const recentAlertTimestamps = new Map<string, number>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown per unique alert signature

function shouldSendAlert(event: OperationalEvent): boolean {
  const sig = `${event.level}:${event.message}:${event.error || ""}:${event.context?.path || ""}`;
  const now = Date.now();
  const lastSent = recentAlertTimestamps.get(sig);
  if (lastSent && now - lastSent < ALERT_COOLDOWN_MS) {
    return false;
  }
  recentAlertTimestamps.set(sig, now);

  if (recentAlertTimestamps.size > 500) {
    for (const [k, ts] of recentAlertTimestamps.entries()) {
      if (now - ts > ALERT_COOLDOWN_MS) recentAlertTimestamps.delete(k);
    }
  }
  return true;
}

async function sendAlert(event: OperationalEvent) {
  if (!shouldSendAlert(event)) return;

  const provider =
    process.env.OPERATIONS_ALERT_PROVIDER ||
    (hasTelegramAlertDestination() ? "telegram" : "webhook");
  if (provider === "telegram") {
    await sendTelegramAlert(event, classifyAlertChannel(event));
    return;
  }

  await sendWebhookAlert(event);
}

function classifyAlertChannel(event: OperationalEvent): "ops" | "debug" {
  if (DEBUG_ALERT_PATTERN.test(event.message)) return "debug";
  if (event.context?.channel === "debug" || event.context?.alertChannel === "debug") return "debug";
  return "ops";
}

function redactAlertValue(key: string, value: any): any {
  if (SENSITIVE_CONTEXT_KEY.test(key)) return "[Filtered]";
  if (Array.isArray(value)) return value.map((item) => redactAlertValue(key, item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactAlertValue(childKey, childValue)]));
  }
  return value;
}

function safeAlertContext(context: Record<string, any>) {
  return Object.fromEntries(Object.entries(context || {}).map(([key, value]) => [key, redactAlertValue(key, value)]));
}

export function extractErrorLocation(err?: unknown): {
  service: string;
  location?: string;
  caller?: string;
} {
  const service = process.env.SERVICE_NAME || "sivan-escrow-agent";
  const stack =
    (err instanceof Error && err.stack ? err.stack : "") ||
    new Error().stack ||
    "";

  if (!stack) return { service };

  const lines = stack.split("\n");
  const frame = lines.find((line) => {
    const isApp =
      line.includes("/src/") ||
      line.includes("src/") ||
      line.includes("/dist/") ||
      line.includes("dist/");
    const isExcluded =
      line.includes("node_modules") ||
      line.includes("services/monitoring.") ||
      line.includes("extractErrorLocation") ||
      line.includes("captureOperationalError") ||
      line.includes("capturePaymentWarning");
    return isApp && !isExcluded;
  });

  if (!frame) return { service };

  const namedMatch = frame.match(/at\s+(?:async\s+)?([^\s(]+)\s+\((?:.*\/)?((?:src|dist)\/[^:]+):(\d+)(?::\d+)?\)/);
  if (namedMatch) {
    return {
      service,
      caller: namedMatch[1],
      location: `${namedMatch[2]}:${namedMatch[3]}`,
    };
  }

  const anonMatch = frame.match(/at\s+(?:.*\/)?((?:src|dist)\/[^:]+):(\d+)(?::\d+)?/);
  if (anonMatch) {
    return {
      service,
      caller: "anonymous",
      location: `${anonMatch[1]}:${anonMatch[2]}`,
    };
  }

  return { service };
}

export function formatTelegramAlert(event: OperationalEvent) {
  const context = safeAlertContext(event.context);
  const service = event.service || process.env.SERVICE_NAME || "sivan-escrow-agent";
  const lines = [
    `🚨 Sivan ${event.level.toUpperCase()} Alert`,
    `Service: ${service}`,
  ];
  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }
  if (event.caller && event.caller !== "anonymous") {
    lines.push(`Caller: ${event.caller}()`);
  }
  lines.push(`Action: ${event.message}`);
  lines.push(`Time: ${event.createdAt}`);
  if (event.error) {
    lines.push(`Error: ${event.error}`);
  }
  if (Object.keys(context).length) {
    lines.push(`Context: ${JSON.stringify(context).slice(0, 1500)}`);
  }
  return lines.join("\n");
}

function telegramAlertDestination(channel: "ops" | "debug") {
  if (channel === "debug") {
    return {
      token:
        process.env.TELEGRAM_DEBUG_ALERT_BOT_TOKEN ||
        process.env.TELEGRAM_ALERT_BOT_TOKEN,
      chatId:
        process.env.TELEGRAM_DEBUG_ALERT_CHAT_ID ||
        process.env.TELEGRAM_ALERT_CHAT_ID,
    };
  }

  return {
    token:
      process.env.TELEGRAM_OPS_ALERT_BOT_TOKEN ||
      process.env.TELEGRAM_ALERT_BOT_TOKEN,
    chatId:
      process.env.TELEGRAM_OPS_ALERT_CHAT_ID ||
      process.env.TELEGRAM_ALERT_CHAT_ID,
  };
}

function hasTelegramAlertDestination() {
  const ops = telegramAlertDestination("ops");
  const debug = telegramAlertDestination("debug");
  return Boolean((ops.token && ops.chatId) || (debug.token && debug.chatId));
}

async function sendTelegramAlert(event: OperationalEvent, channel: "ops" | "debug") {
  const { token, chatId } = telegramAlertDestination(channel);
  if (!token || !chatId) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramAlert(event),
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      warn(`Failed to send Telegram ${channel} alert`, response.status, await response.text());
    }
  } catch (err) {
    warn(`Failed to send Telegram ${channel} alert`, err instanceof Error ? err.message : err);
  }
}

async function sendWebhookAlert(event: OperationalEvent) {
  const webhookUrl = process.env.OPERATIONS_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPERATIONS_ALERT_WEBHOOK_SECRET
          ? { "x-sivan-alert-secret": process.env.OPERATIONS_ALERT_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        service: event.service || process.env.SERVICE_NAME || "sivan-escrow-agent",
        location: event.location,
        caller: event.caller,
        ...event,
        context: safeAlertContext(event.context),
      }),
    });
  } catch (err) {
    warn("Failed to send operations alert", err instanceof Error ? err.message : err);
  }
}

export function captureOperationalError(message: string, err?: unknown, context: Record<string, any> = {}) {
  const errorMessage = err instanceof Error ? err.message : err ? String(err) : undefined;
  const loc = extractErrorLocation(err);
  warn(message, { ...context, location: loc.location, caller: loc.caller }, errorMessage);
  pushOperationalEvent({
    level: "error",
    message,
    context,
    error: errorMessage,
    service: loc.service,
    location: loc.location,
    caller: loc.caller,
  });

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.entries({ ...context, location: loc.location, caller: loc.caller }).forEach(([key, value]) => scope.setExtra(key, value));
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(message, "error");
      }
    });
  }
}

export function capturePaymentWarning(message: string, context: Record<string, any> = {}) {
  const loc = extractErrorLocation();
  warn(message, { ...context, location: loc.location, caller: loc.caller });
  pushOperationalEvent({
    level: "warning",
    message,
    context,
    service: loc.service,
    location: loc.location,
    caller: loc.caller,
  });

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.entries({ ...context, location: loc.location, caller: loc.caller }).forEach(([key, value]) => scope.setExtra(key, value));
      Sentry.captureMessage(message, "warning");
    });
  }
}

export function listOperationalEvents(limit = 50) {
  return operationalEvents.slice(0, limit);
}

export function buildOperationalVisibility() {
  const recent = listOperationalEvents(20);
  const now = Date.now();
  const lastHour = operationalEvents.filter((event) => now - new Date(event.createdAt).getTime() <= 60 * 60 * 1000);

  return {
    status: lastHour.some((event) => event.level === "error") ? "attention" : "ok",
    alertsConfigured: Boolean(process.env.OPERATIONS_ALERT_WEBHOOK_URL || hasTelegramAlertDestination()),
    alertProvider: process.env.OPERATIONS_ALERT_PROVIDER || (hasTelegramAlertDestination() ? "telegram" : process.env.OPERATIONS_ALERT_WEBHOOK_URL ? "webhook" : "none"),
    alertChannels: {
      opsConfigured: Boolean(telegramAlertDestination("ops").token && telegramAlertDestination("ops").chatId),
      debugConfigured: Boolean(telegramAlertDestination("debug").token && telegramAlertDestination("debug").chatId),
    },
    sentryConfigured: Boolean(process.env.SENTRY_DSN),
    recentWarnings: lastHour.filter((event) => event.level === "warning").length,
    recentErrors: lastHour.filter((event) => event.level === "error").length,
    recent,
  };
}
