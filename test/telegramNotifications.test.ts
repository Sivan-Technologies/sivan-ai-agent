import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * telegramNotifications.test.ts
 *
 * Telegram is a delivery channel alongside WhatsApp, with its own URL and its
 * own secret.
 *
 * The reason this file exists is a bug that was live: the escrow agent only
 * ever notified NOTIFICATION_URL, which points at the WhatsApp layer, and the
 * payload it sent was { to, message }. The Telegram layer's /api/notify reads
 * { phone, message } and resolves the phone to a chat id from its own linked
 * identities. Verified against the real Telegram endpoint, the old shape
 * returned 404 "No linked Telegram chat for that user" every single time - so
 * a Telegram user would have silently received nothing, forever.
 *
 * These tests pin the two things that made it silent: the field name, and the
 * fact that a delivery failure must never propagate into an escrow action that
 * has already succeeded.
 */

process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = ":memory:";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "https://whatsapp.sivan.test";
process.env.NOTIFICATION_SECRET = "shared-secret";
process.env.TELEGRAM_NOTIFICATION_URL = "https://telegram.sivan.test";
process.env.TELEGRAM_NOTIFICATION_SECRET = "telegram-secret";

type Call = { url: string; headers: Record<string, string>; body: any };

let calls: Call[] = [];
let responder: (url: string) => { status: number; body?: string };

function installFetch() {
  calls = [];
  responder = () => ({ status: 200, body: "{}" });
  (globalThis as any).fetch = vi.fn(async (url: any, init: any = {}) => {
    calls.push({
      url: String(url),
      headers: (init.headers || {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const { status, body } = responder(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body ?? "",
      json: async () => JSON.parse(body ?? "{}"),
    } as any;
  });
}

function telegramCalls() {
  return calls.filter((c) => c.url.includes("telegram.sivan.test"));
}
function whatsappCalls() {
  return calls.filter((c) => c.url.includes("whatsapp.sivan.test"));
}

describe("Telegram notification channel", () => {
  beforeEach(() => {
    installFetch();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends 'phone', not 'to' - the field the Telegram layer actually reads", async () => {
    const { notifyTelegramBot } = await import("../src/services/notificationService");

    await notifyTelegramBot("+2348012345678", "Your buyer has paid.");

    const sent = telegramCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://telegram.sivan.test/api/notify");

    // The regression. { to } was the WhatsApp field and always 404'd here.
    expect(sent[0].body.phone).toBe("+2348012345678");
    expect(sent[0].body.to).toBeUndefined();
    // A test-mode database prefixes [TEST], exactly as the WhatsApp path does,
    // so a message from a test deployment is never mistaken for a live one.
    expect(sent[0].body.message).toContain("Your buyer has paid.");
  });

  it("uses its own secret, not the WhatsApp one", async () => {
    const { notifyTelegramBot } = await import("../src/services/notificationService");

    await notifyTelegramBot("+2348012345678", "hi");

    expect(telegramCalls()[0].headers["x-notify-secret"]).toBe("telegram-secret");
  });

  it("notifies BOTH channels, because a phone may be linked on either", async () => {
    const { notifyWhatsAppBot } = await import("../src/services/notificationService");

    await notifyWhatsAppBot("+2348012345678", "Funds released.");

    expect(whatsappCalls()).toHaveLength(1);
    expect(telegramCalls()).toHaveLength(1);
    // Each channel gets the field name it understands.
    expect(whatsappCalls()[0].body.to).toBe("+2348012345678");
    expect(telegramCalls()[0].body.phone).toBe("+2348012345678");
  });

  it("sends telegramId when we know it, so delivery does not depend on a phone", async () => {
    const { notifyTelegramBot } = await import("../src/services/notificationService");

    await notifyTelegramBot("+2348012345678", "Funds released.", undefined, "778899");

    const sent = telegramCalls();
    expect(sent).toHaveLength(1);
    // The id is the reliable route: the layer uses it as the chat id directly
    // instead of scanning its identity store for a matching phone.
    expect(sent[0].body.telegramId).toBe("778899");
    // The phone still rides along for users linked before we recorded ids.
    expect(sent[0].body.phone).toBe("+2348012345678");
  });

  it("reaches a Telegram user who has no phone at all", async () => {
    const { notifyTelegramBot } = await import("../src/services/notificationService");

    // A web signup that linked Telegram has no WhatsApp number. Before the id
    // was sent, this person was unreachable: the only handle we had was one the
    // Telegram layer could not resolve.
    await notifyTelegramBot("", "Your escrow expired.", undefined, "778899");

    const sent = telegramCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.telegramId).toBe("778899");
    // No blank phone, which would make the layer scan for an empty string.
    expect(sent[0].body.phone).toBeUndefined();
  });

  it("does not call the layer when there is no handle to address", async () => {
    const { notifyTelegramBot } = await import("../src/services/notificationService");

    await notifyTelegramBot("", "nobody to send this to");

    expect(telegramCalls()).toHaveLength(0);
  });

  it("carries the telegramId through the both-channels fan-out", async () => {
    const { notifyWhatsAppBot } = await import("../src/services/notificationService");

    await notifyWhatsAppBot("+2348012345678", "Funds released.", undefined, "778899");

    // The id must survive the fan-out, otherwise the Telegram leg silently
    // falls back to phone resolution and the fix does not reach production.
    expect(telegramCalls()[0].body.telegramId).toBe("778899");
    // WhatsApp has no concept of a Telegram id and must not receive one.
    expect(whatsappCalls()[0].body.telegramId).toBeUndefined();
  });


  it("treats 404 as normal - most users have never linked Telegram", async () => {
    const { notifyTelegramBot } = await import("../src/services/notificationService");
    responder = (url) =>
      url.includes("telegram")
        ? { status: 404, body: '{"error":"No linked Telegram chat for that user"}' }
        : { status: 200, body: "{}" };

    // Must not throw, and must not be logged as an error.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyTelegramBot("+2349099999999", "hi")).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a Telegram outage cannot break an escrow action or block WhatsApp", async () => {
    const { notifyWhatsAppBot } = await import("../src/services/notificationService");
    vi.spyOn(console, "error").mockImplementation(() => {});

    responder = (url) => {
      if (url.includes("telegram")) throw new Error("ECONNREFUSED");
      return { status: 200, body: "{}" };
    };

    // The money already moved. A failed notification must never surface as a
    // failure of the thing that succeeded.
    await expect(notifyWhatsAppBot("+2348012345678", "Funds released.")).resolves.toBeUndefined();
    // And WhatsApp still got through.
    expect(whatsappCalls()).toHaveLength(1);
  });

  it("is skipped entirely when the Telegram layer is not deployed", async () => {
    vi.resetModules();
    const saved = process.env.TELEGRAM_NOTIFICATION_URL;
    delete process.env.TELEGRAM_NOTIFICATION_URL;

    const { notifyTelegramBot } = await import("../src/services/notificationService");
    await notifyTelegramBot("+2348012345678", "hi");

    expect(telegramCalls()).toHaveLength(0);
    process.env.TELEGRAM_NOTIFICATION_URL = saved;
  });
});
