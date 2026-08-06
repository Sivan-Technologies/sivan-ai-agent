import { config } from "../config";
import { WorkflowTaskRecord } from "./workflowStore";

export async function notifyWhatsAppBot(to: string, message: string, dealCard?: any, telegramUserId?: string) {
  // Fan out to every channel the user might be reachable on. A user who linked
  // Telegram and a user who linked WhatsApp are the SAME Sivan account, so we do
  // not know here which app they will open. Each channel decides for itself
  // whether it can reach the handle it was given.
  await Promise.all([
    notifyWhatsAppBotStrict(to, message, dealCard).catch((error) => {
      console.error("Failed to notify WhatsApp bot", error);
    }),
    notifyTelegramBot(to, message, dealCard, telegramUserId),
  ]);
}


/**
 * Push an update to the Telegram layer.
 *
 * Deliberately its own function with its own URL and secret rather than a
 * second call site of the WhatsApp one. The two layers are separate
 * deployments that can be rotated, redeployed and turned off independently,
 * and sharing NOTIFICATION_URL would mean one of them silently receiving the
 * other's traffic.
 *
 * PAYLOAD DIFFERS. The WhatsApp layer takes { to, message }. The Telegram
 * layer takes { telegramId?, phone?, message } and needs one of the two to find
 * a chat, because a Telegram bot cannot message a phone number - only a chat
 * that has started it.
 *
 * PREFER telegramId. The phone path only works for users who shared a contact,
 * and it resolves by scanning the layer's in-memory identity store, so it
 * misses anyone whose account carries a Telegram handle but no phone. Sending
 * the id lets the layer skip that lookup entirely. `to` may be an empty string
 * for a user who has no phone at all; the layer ignores it when an id is given.
 *
 * Never throws. A notification is an enhancement to an escrow action that has
 * already succeeded; failing to deliver one must not roll back a payment.
 */
export async function notifyTelegramBot(to: string, message: string, dealCard?: any, telegramUserId?: string) {
  const notifyUrl = config.app.telegramNotificationUrl;
  if (!notifyUrl) return; // Telegram layer not deployed. Nothing to do.

  // Nothing to address the message to. Without this a phone-less, unlinked user
  // would POST { phone: "" } and the layer would scan its whole identity store
  // looking for a blank phone.
  if (!telegramUserId && !to) return;


  const secret = config.app.telegramNotificationSecret;

  try {
    const response = await fetch(`${notifyUrl.replace(/\/$/, "")}/api/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-notify-secret": secret } : {}),
      },
      body: JSON.stringify({
        // The Telegram layer's own field names. It uses telegramId directly as
        // the chat id when present, and only falls back to scanning its linked
        // identities for the phone when it is absent. Send both: the id is the
        // reliable route, the phone still reaches users linked the old way
        // whose id we have not recorded yet.
        ...(telegramUserId ? { telegramId: telegramUserId } : {}),
        ...(to ? { phone: to } : {}),
        message: config.databaseMode === "test" ? `[TEST] ${message}` : message,
        ...(dealCard ? { dealCard } : {}),
      }),

    });

    // 404 is the normal, expected answer for a user who has never linked
    // Telegram - which is most users. Logging it as an error would bury real
    // failures in noise.
    if (response.status === 404) return;

    if (!response.ok) {
      const payload = await response.text();
      console.error(`Telegram notify failed: ${response.status} ${payload}`);
    }
  } catch (error) {
    console.error("Failed to notify Telegram bot", error);
  }
}

export async function notifyWhatsAppBotStrict(to: string, message: string, dealCard?: any, media?: string[]) {
  const notifyUrl = config.app.notificationUrl;
  const secret = config.app.notificationSecret;

  if (!notifyUrl) {
    return;
  }

  const response = await fetch(`${notifyUrl}/api/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-notify-secret": secret } : {}),
    },
    body: JSON.stringify({
      to,
      message: config.databaseMode === "test" ? `[TEST] ${message}` : message,
      ...(dealCard ? { dealCard } : {}),
      ...(media && media.length ? { media } : {}),
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`WhatsApp notify failed: ${response.status} ${payload}`);
  }
}

export async function getWhatsAppProviderStatus() {
  const notifyUrl = config.app.notificationUrl;
  const secret = config.app.notificationSecret;

  if (!notifyUrl) {
    return {
      activeProvider: "unknown",
      configured: false,
      providers: {
        twilio: { configured: false },
        meta: { configured: false },
      },
      warning: "NOTIFICATION_URL is not configured",
    };
  }

  const response = await fetch(`${notifyUrl}/api/whatsapp-provider`, {
    headers: {
      ...(secret ? { "x-notify-secret": secret } : {}),
    },
  });

  if (!response.ok) {
    const payload = await response.text();
    return {
      activeProvider: "unknown",
      configured: false,
      providers: {
        twilio: { configured: false },
        meta: { configured: false },
      },
      warning: `WhatsApp provider status failed: ${response.status}`,
      detail: payload.slice(0, 500),
    };
  }

  return response.json();
}

export async function switchWhatsAppProvider(provider: "twilio" | "meta") {
  const notifyUrl = config.app.notificationUrl;
  const secret = config.app.notificationSecret;

  if (!notifyUrl) {
    throw new Error("NOTIFICATION_URL is not configured");
  }

  const response = await fetch(`${notifyUrl}/api/whatsapp-provider`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-notify-secret": secret } : {}),
    },
    body: JSON.stringify({ provider }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`WhatsApp provider switch failed: ${response.status} ${payload}`);
  }

  return response.json();
}

function tryParseResult(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function formatTaskSummary(task: WorkflowTaskRecord): string {
  const lines: string[] = [];
  lines.push(`✅ Task update: ${task.taskId}`);
  if (task.taskType) {
    lines.push(`Task type: ${task.taskType}`);
  }
  if (task.paymentMethod) {
    lines.push(`Payment method: ${task.paymentMethod}`);
  }
  lines.push(`Status: ${task.paymentStatus}`);
  lines.push(`Amount: ${task.amount} ${task.userPaymentPreference}`);
  if (task.paymentReference) {
    lines.push(`Payment reference: ${task.paymentReference}`);
  }
  if (task.instructions) {
    lines.push(`Instructions: ${task.instructions}`);
  }

  if (task.executionResults) {
    let results: any;
    try {
      results = JSON.parse(task.executionResults);
    } catch {
      results = task.executionResults;
    }

    const formatExecutionItem = (item: any, index: number) => {
      let summary = "";
      if (typeof item === "string") {
        const parsed = tryParseResult(item);
        item = parsed;
      }

      if (item && typeof item === "object") {
        if (item.summary) {
          summary = item.summary;
        } else if (item.result) {
          summary = typeof item.result === "string" ? item.result : JSON.stringify(item.result);
        } else if (item.text) {
          summary = item.text;
        } else if (item.service && item.output) {
          summary = `${item.service}: ${typeof item.output === "string" ? item.output : JSON.stringify(item.output)}`;
        } else {
          summary = JSON.stringify(item);
        }
      } else {
        summary = String(item);
      }

      lines.push(`${index + 1}. ${summary}`);
    };

    lines.push(`\nAI Results:`);
    if (Array.isArray(results)) {
      results.slice(0, 3).forEach((result, index) => {
        formatExecutionItem(result, index);
      });
    } else if (typeof results === "object") {
      lines.push(JSON.stringify(results));
    } else {
      lines.push(String(results));
    }
  }

  if (task.note) {
    lines.push(`Note: ${task.note}`);
  }
  return lines.join("\n");
}
