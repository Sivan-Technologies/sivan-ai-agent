import * as Sentry from "@sentry/node";
import { warn } from "../lib/logger";

export function captureOperationalError(message: string, err?: unknown, context: Record<string, any> = {}) {
  warn(message, context, err instanceof Error ? err.message : err);

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

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
      Sentry.captureMessage(message, "warning");
    });
  }
}
