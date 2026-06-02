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
}

const MAX_EVENTS = 100;
const operationalEvents: OperationalEvent[] = [];
const SENSITIVE_CONTEXT_KEY = /(secret|token|password|authorization|signature|accountnumber|account_number|bvn|nin|document_number)/i;

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

async function sendAlert(event: OperationalEvent) {
  const provider = process.env.OPERATIONS_ALERT_PROVIDER || (process.env.TELEGRAM_ALERT_BOT_TOKEN && process.env.TELEGRAM_ALERT_CHAT_ID ? "telegram" : "webhook");
  if (provider === "telegram") {
    await sendTelegramAlert(event);
    return;
  }

  await sendWebhookAlert(event);
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

function formatTelegramAlert(event: OperationalEvent) {
  const context = safeAlertContext(event.context);
  const lines = [
    `Sivan ${event.level.toUpperCase()} alert`,
    event.message,
    `Time: ${event.createdAt}`,
  ];
  if (event.error) lines.push(`Error: ${event.error}`);
  if (Object.keys(context).length) lines.push(`Context: ${JSON.stringify(context).slice(0, 1500)}`);
  return lines.join("\n");
}

async function sendTelegramAlert(event: OperationalEvent) {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
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
      warn("Failed to send Telegram operations alert", response.status, await response.text());
    }
  } catch (err) {
    warn("Failed to send Telegram operations alert", err instanceof Error ? err.message : err);
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
        service: "sivan-escrow-agent",
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
  warn(message, context, errorMessage);
  pushOperationalEvent({ level: "error", message, context, error: errorMessage });

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(message, "error");
      }
    });
  }
}

export function capturePaymentWarning(message: string, context: Record<string, any> = {}) {
  warn(message, context);
  pushOperationalEvent({ level: "warning", message, context });

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
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
    alertsConfigured: Boolean(process.env.OPERATIONS_ALERT_WEBHOOK_URL || (process.env.TELEGRAM_ALERT_BOT_TOKEN && process.env.TELEGRAM_ALERT_CHAT_ID)),
    alertProvider: process.env.OPERATIONS_ALERT_PROVIDER || (process.env.TELEGRAM_ALERT_BOT_TOKEN && process.env.TELEGRAM_ALERT_CHAT_ID ? "telegram" : process.env.OPERATIONS_ALERT_WEBHOOK_URL ? "webhook" : "none"),
    sentryConfigured: Boolean(process.env.SENTRY_DSN),
    recentWarnings: lastHour.filter((event) => event.level === "warning").length,
    recentErrors: lastHour.filter((event) => event.level === "error").length,
    recent,
  };
}
