import { info, warn } from "../lib/logger";

const DEFAULT_SECRET = "sivan_idlink_FfWCMOrCx8vxoBiq2wpmr67sslFUwkV4OV0reMUXWjETbER_sVMGhAgups0jEwmI";

export function getPaymentApiUrl(pathAndQuery: string): string {
  const base =
    process.env.PAYMENT_API_BASE_URL ||
    process.env.CORE_PAYMENT_URL ||
    process.env.SIVAN_PAYMENT_URL ||
    (process.env.DATABASE_MODE === "test" ? "https://api-staging.sivantech.online" : "https://api.sivantech.online");
  const normalizedBase = base.replace(/\/+$/, "");
  let upstreamPath = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;

  if (normalizedBase.endsWith("/api") && upstreamPath.startsWith("/api/")) {
    upstreamPath = upstreamPath.slice(4);
  }

  const isGateway = ["api.sivantech.online", "api-staging.sivantech.online", "test-sivan.sivantech.online"].some((h) =>
    normalizedBase.includes(h)
  );
  if (isGateway && !normalizedBase.includes("/api/payment")) {
    const stripped = upstreamPath.startsWith("/api/") ? upstreamPath.slice(4) : upstreamPath;
    return `${normalizedBase}/api/payment${stripped}`;
  }
  return `${normalizedBase}${upstreamPath}`;
}

export function getPaymentServiceSecret(): string {
  return (
    process.env.IDENTITY_LINK_SERVICE_SECRET ||
    process.env.PAYMENT_IDENTITY_LINK_SECRET ||
    process.env.ADMIN_API_KEY ||
    DEFAULT_SECRET
  ).trim();
}

export async function releaseAgreementToSivanBalance(
  escrow: {
    escrowId: string;
    buyerUserId?: string | null;
    buyerWhatsapp?: string | null;
    sellerUserId?: string | null;
    sellerWhatsapp?: string | null;
    amount: number;
    currency: string;
  },
  sellerNetAmount?: number,
  platformFeeAmount?: number,
  payoutDestination: "balance" | "bank" = "balance"
): Promise<{ success: boolean; data?: any; error?: string }> {
  const buyerId = escrow.buyerUserId || escrow.buyerWhatsapp;
  const sellerId = escrow.sellerUserId || escrow.sellerWhatsapp;
  if (!sellerId) {
    warn("[paymentBalanceClient] Cannot release to balance: missing seller identity", { escrowId: escrow.escrowId });
    return { success: false, error: "Missing seller identity" };
  }

  const userId = buyerId || sellerId;
  const targetUrl = getPaymentApiUrl(`/api/users/${encodeURIComponent(userId)}/balance/release-agreement`);
  const secret = getPaymentServiceSecret();

  const payload = {
    agreementId: escrow.escrowId,
    buyerUserId: buyerId || userId,
    sellerUserId: sellerId,
    amount: Number(escrow.amount),
    currency: (escrow.currency === "NAIRA" ? "ngn" : escrow.currency).toLowerCase(),
    sellerNetAmount: sellerNetAmount !== undefined ? Number(sellerNetAmount) : Number(escrow.amount),
    feeAmount: platformFeeAmount !== undefined ? Number(platformFeeAmount) : 0,
    payoutDestination,
  };

  try {
    info("[paymentBalanceClient] Notifying sivan-payment to release agreement to seller balance", {
      escrowId: escrow.escrowId,
      sellerId,
      amount: escrow.amount,
      targetUrl,
    });
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sivan-identity-link-secret": secret,
        "x-admin-api-key": secret,
      },
      body: JSON.stringify(payload),
    });

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      warn("[paymentBalanceClient] Payment balance release failed", {
        escrowId: escrow.escrowId,
        status: res.status,
        response: json,
      });
      return { success: false, error: json?.error?.message || json?.error || "Balance release call failed" };
    }

    info("[paymentBalanceClient] Agreement released to seller balance successfully", {
      escrowId: escrow.escrowId,
      sellerId,
      result: json,
    });
    return { success: true, data: json?.data || json };
  } catch (err: any) {
    warn("[paymentBalanceClient] Error calling sivan-payment release endpoint", {
      escrowId: escrow.escrowId,
      error: err.message || String(err),
    });
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Returns a buyer's outstanding balance hold for an agreement. Used when an
 * agreement is cancelled, so the money does not stay locked against an
 * agreement that will never run. The payment service verifies that a hold
 * actually exists and is idempotent, so this is safe to call for agreements
 * that were never funded from balance.
 */
export async function refundAgreementToSivanBalance(escrow: {
  escrowId: string;
  buyerUserId?: string | null;
  buyerWhatsapp?: string | null;
  amount: number;
  currency: string;
}, reason?: string): Promise<{ success: boolean; data?: any; error?: string }> {
  const buyerId = escrow.buyerUserId || escrow.buyerWhatsapp;
  if (!buyerId) {
    warn("[paymentBalanceClient] Cannot refund hold: missing buyer identity", { escrowId: escrow.escrowId });
    return { success: false, error: "Missing buyer identity" };
  }

  const targetUrl = getPaymentApiUrl(`/api/users/${encodeURIComponent(buyerId)}/balance/refund-agreement`);
  const secret = getPaymentServiceSecret();
  const payload = {
    agreementId: escrow.escrowId,
    buyerUserId: buyerId,
    amount: Number(escrow.amount),
    currency: (escrow.currency === "NAIRA" ? "ngn" : escrow.currency).toLowerCase(),
    reason: reason || "Agreement cancelled",
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sivan-identity-link-secret": secret,
        "x-admin-api-key": secret,
      },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      warn("[paymentBalanceClient] Refund of agreement hold failed", {
        escrowId: escrow.escrowId,
        status: res.status,
        response: json,
      });
      return { success: false, error: json?.error?.message || json?.error || "Balance refund call failed" };
    }
    const data = json?.data || json;
    info("[paymentBalanceClient] Agreement hold settled with payment service", {
      escrowId: escrow.escrowId,
      buyerId,
      refunded: !data?.nothingToRefund,
      result: data,
    });
    return { success: true, data };
  } catch (err: any) {
    warn("[paymentBalanceClient] Error calling sivan-payment refund endpoint", {
      escrowId: escrow.escrowId,
      error: err.message || String(err),
    });
    return { success: false, error: err.message || String(err) };
  }
}
