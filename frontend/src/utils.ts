import { FeeSettings } from "./types";

export const money = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function calculateSellerNet(amount: number, currency: "NAIRA" | "USDC", settings?: FeeSettings | null) {
  if (!settings) return { platformFeeAmount: 0, sellerNetAmount: amount, totalWithFee: amount };
  const percentFee = currency === "NAIRA"
    ? Math.round((amount * settings.nairaFeePercent) / 100)
    : Number((amount * (settings.usdcFeePercent / 100)).toFixed(6));
  const fixedFee = currency === "NAIRA" ? settings.nairaFeeFixed : settings.usdcFeeFixed;
  const platformFeeAmount = Math.max(0, Number((percentFee + fixedFee).toFixed(6)));
  return {
    platformFeeAmount,
    sellerNetAmount: amount,
    totalWithFee: Number((amount + platformFeeAmount).toFixed(6)),
  };
}

export function compactId(value?: string, length = 10) {
  if (!value) return "unassigned";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export function statusTone(status: string) {
  if (/^(high|critical)$/i.test(status)) return "critical";
  if (/^medium$/i.test(status)) return "watch";
  if (/^low$/i.test(status)) return "good";
  if (/failed|error|invalid|release_failed|review_required|mismatch/i.test(status)) return "critical";
  if (/settled|completed|confirmed|success/i.test(status)) return "good";
  if (/pending|created|received|executing|waiting/i.test(status)) return "watch";
  return "neutral";
}

export function formatTime(value?: string) {
  if (!value) return "not recorded";
  return new Date(value).toLocaleString();
}
