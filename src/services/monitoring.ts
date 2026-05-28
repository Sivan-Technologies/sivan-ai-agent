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
    alertsConfigured: Boolean(process.env.OPERATIONS_ALERT_WEBHOOK_URL),
    sentryConfigured: Boolean(process.env.SENTRY_DSN),
    recentWarnings: lastHour.filter((event) => event.level === "warning").length,
    recentErrors: lastHour.filter((event) => event.level === "error").length,
    recent,
  };
}
