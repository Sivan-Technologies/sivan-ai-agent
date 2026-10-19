import { config } from "../config";
import { WorkflowTaskRecord } from "./workflowStore";

export async function notifyWhatsAppBot(to: string, message: string, dealCard?: any, telegramUserId?: string, media?: string[]) {
  // Fan out to every channel the user might be reachable on. A user who linked
  // Telegram and a user who linked WhatsApp are the SAME Sivan account, so we do
  // not know here which app they will open. Each channel decides for itself
  // whether it can reach the handle it was given.
  await Promise.all([
    notifyWhatsAppBotStrict(to, message, dealCard, media).catch((error) => {
      console.error("Failed to notify WhatsApp bot", error);
    }),
    notifyTelegramBot(to, message, dealCard, telegramUserId, media),
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
 * layer takes { telegramId?, phone?, message, media? } and needs one of the two to find
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
export function getWhatsAppBaseUrl(): string {
  const raw = (
    process.env.WHATSAPP_NOTIFICATION_URL ||
    config.app.notificationUrl ||
    process.env.NOTIFICATION_URL ||
    ""
  ).trim().replace(/\/$/, "");

  if (!raw) return "";

  let base = raw.replace(/\/api\/notify$/, "");
  // If routing through the Cloudflare Sivantech gateway without /api/whatsapp, prefix /api/whatsapp
  if (base.includes("sivantech.online") && !base.includes("/api/whatsapp")) {
    base = `${base}/api/whatsapp`;
  }
  return base;
}

export function getTelegramBaseUrl(): string {
  const raw = (
    process.env.TELEGRAM_NOTIFICATION_URL ||
    config.app.telegramNotificationUrl ||
    process.env.TELEGRAM_BOT_URL ||
    ""
  ).trim().replace(/\/$/, "");

  if (!raw) return "";

  let base = raw.replace(/\/api\/notify$/, "");
  // If routing through Cloudflare Sivantech gateway without /api/telegram, prefix /api/telegram
  if (base.includes("sivantech.online") && !base.includes("/api/telegram") && !base.includes("telegram.sivantech.online")) {
    base = `${base}/api/telegram`;
  }
  return base;
}

/**
 * Push an update to the Telegram layer.
 */
export async function notifyTelegramBot(to: string, message: string, dealCard?: any, telegramUserId?: string, media?: string[]) {
  const notifyBase = getTelegramBaseUrl();
  if (!notifyBase) return; // Telegram layer not deployed. Nothing to do.

  if (!telegramUserId && !to) return;

  const secret = config.app.telegramNotificationSecret;

  try {
    const response = await fetch(`${notifyBase}/api/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-target-service": "telegram",
        ...(secret ? { "x-notify-secret": secret } : {}),
      },
      body: JSON.stringify({
        ...(telegramUserId ? { telegramId: telegramUserId } : {}),
        ...(to ? { phone: to } : {}),
        message: config.databaseMode === "test" ? `[TEST] ${message}` : message,
        ...(dealCard ? { dealCard } : {}),
        ...(media && media.length ? { media } : {}),
      }),
    });

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
  const notifyBase = getWhatsAppBaseUrl();
  const secret = config.app.notificationSecret;

  if (!notifyBase) {
    return;
  }

  const maxAttempts = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${notifyBase}/api/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-target-service": "whatsapp-bot",
          ...(secret ? { "x-notify-secret": secret } : {}),
        },
        body: JSON.stringify({
          to,
          message: config.databaseMode === "test" ? `[TEST] ${message}` : message,
          ...(dealCard ? { dealCard } : {}),
          ...(media && media.length ? { media } : {}),
        }),
      });

      if (response.ok) return;

      const payload = await response.text();
      const isWarmingUp = response.status === 503 || /UPSTREAM_UNAVAILABLE|suspended/i.test(payload);
      if (isWarmingUp && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
      throw new Error(`WhatsApp notify failed: ${response.status} ${payload}`);
    } catch (err: any) {
      lastError = err;
      const isWarmingUp = /UPSTREAM_UNAVAILABLE|suspended|aborted|timeout|503/i.test(err?.message || "");
      if (isWarmingUp && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
    }
  }

  throw lastError;
}

export async function getWhatsAppProviderStatus() {
  const notifyBase = getWhatsAppBaseUrl();
  const secret = config.app.notificationSecret;

  if (!notifyBase) {
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

  const response = await fetch(`${notifyBase}/api/whatsapp-provider`, {
    headers: {
      "x-target-service": "whatsapp-bot",
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
  const notifyBase = getWhatsAppBaseUrl();
  const secret = config.app.notificationSecret;

  if (!notifyBase) {
    throw new Error("NOTIFICATION_URL is not configured");
  }

  const response = await fetch(`${notifyBase}/api/whatsapp-provider`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-target-service": "whatsapp-bot",
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
