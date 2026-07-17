import { describe, expect, it } from "vitest";
import { calculateEscrowPayoutQuote } from "../src/services/paymentService";
import { expectedFundingAmount } from "../src/services/escrowService";
import { formatFundingInstruction } from "../src/services/paymentService";
import { EscrowRecord } from "../src/services/escrowStore";
import { settingsStore } from "../src/context";

describe("Dynamic Fee Allocation Calculations", () => {
  it("calculates quotes correctly when buyer pays Naira fees", async () => {
    const settings = await settingsStore.getSettings();
    const percentFee = Math.round((10000 * settings.nairaFeePercent) / 100);
    const expectedFee = percentFee + settings.nairaFeeFixed;

    const quote = await calculateEscrowPayoutQuote(10000, "NAIRA", "buyer");
    expect(quote.totalPlatformFee).toBe(expectedFee);
    expect(quote.totalWithFee).toBe(10000 + expectedFee);
    expect(quote.sellerNetAmount).toBe(10000);
  });

  it("calculates quotes correctly when seller pays Naira fees", async () => {
    const settings = await settingsStore.getSettings();
    const percentFee = Math.round((10000 * settings.nairaFeePercent) / 100);
    const expectedFee = percentFee + settings.nairaFeeFixed;

    const quote = await calculateEscrowPayoutQuote(10000, "NAIRA", "seller");
    expect(quote.totalPlatformFee).toBe(expectedFee);
    expect(quote.totalWithFee).toBe(10000);
    expect(quote.sellerNetAmount).toBe(10000 - expectedFee);
  });

  it("calculates quotes correctly when Naira fees are split 50/50", async () => {
    const settings = await settingsStore.getSettings();
    const percentFee = Math.round((10000 * settings.nairaFeePercent) / 100);
    const expectedFee = percentFee + settings.nairaFeeFixed;
    const halfFee = Math.round(expectedFee / 2);

    const quote = await calculateEscrowPayoutQuote(10000, "NAIRA", "split");
    expect(quote.totalPlatformFee).toBe(expectedFee);
    expect(quote.totalWithFee).toBe(10000 + halfFee);
    expect(quote.sellerNetAmount).toBe(10000 - (expectedFee - halfFee));
  });

  it("handles odd Naira fee splits correctly without rounding gaps", async () => {
    // Force a dynamic split on an odd number if platform fees are configured
    const settings = await settingsStore.getSettings();
    // Calculate for an amount that results in an odd fee or test general split invariants
    const quote = await calculateEscrowPayoutQuote(500, "NAIRA", "split");
    const expectedFee = quote.totalPlatformFee;
    expect(quote.totalWithFee - quote.sellerNetAmount).toBe(expectedFee);
  });

  it("calculates quotes correctly for USDC fee allocation", async () => {
    const settings = await settingsStore.getSettings();
    const percentFee = parseFloat((100 * (settings.usdcFeePercent / 100)).toFixed(6));
    const expectedFee = parseFloat((percentFee + settings.usdcFeeFixed).toFixed(6));
    const halfFee = expectedFee / 2;

    const quote = await calculateEscrowPayoutQuote(100, "USDC", "split");
    expect(quote.totalPlatformFee).toBe(expectedFee);
    expect(quote.totalWithFee).toBe(parseFloat((100 + halfFee).toFixed(6)));
    expect(quote.sellerNetAmount).toBe(parseFloat((100 - halfFee).toFixed(6)));
  });

  it("derives expectedFundingAmount correctly based on fee allocation", async () => {
    const settings = await settingsStore.getSettings();
    const percentFee = Math.round((10000 * settings.nairaFeePercent) / 100);
    const expectedFee = percentFee + settings.nairaFeeFixed;
    const halfFee = Math.round(expectedFee / 2);

    const buyerEscrow = {
      amount: 10000,
      currency: "NAIRA",
      feePayer: "buyer",
    } as EscrowRecord;

    const sellerEscrow = {
      amount: 10000,
      currency: "NAIRA",
      feePayer: "seller",
    } as EscrowRecord;

    const splitEscrow = {
      amount: 10000,
      currency: "NAIRA",
      feePayer: "split",
    } as EscrowRecord;

    await expect(expectedFundingAmount(buyerEscrow)).resolves.toBe(10000 + expectedFee);
    await expect(expectedFundingAmount(sellerEscrow)).resolves.toBe(10000);
    await expect(expectedFundingAmount(splitEscrow)).resolves.toBe(10000 + halfFee);
  });

  it("formats WhatsApp funding instructions with custom fee suffixes", () => {
    const buyerEscrow = {
      escrowId: "SIV-FEE-BUYER",
      amount: 10000,
      currency: "NAIRA",
      feePayer: "buyer",
    } as EscrowRecord;

    const sellerEscrow = {
      escrowId: "SIV-FEE-SELLER",
      amount: 10000,
      currency: "NAIRA",
      feePayer: "seller",
    } as EscrowRecord;

    const splitEscrow = {
      escrowId: "SIV-FEE-SPLIT",
      amount: 10000,
      currency: "NAIRA",
      feePayer: "split",
    } as EscrowRecord;

    const paymentMeta = {
      totalPayable: 10400,
      platformFeeAmount: 400,
      authorizationUrl: "https://sivantech.online/pay?reference=ref1",
    };

    const buyerInstruction = formatFundingInstruction(buyerEscrow, paymentMeta);
    expect(buyerInstruction).toContain("Sivan fee: NGN 400");
    expect(buyerInstruction).not.toContain("split");

    const sellerInstruction = formatFundingInstruction(sellerEscrow, { ...paymentMeta, totalPayable: 10000 });
    expect(sellerInstruction).toContain("Sivan fee: NGN 0 (paid by seller)");

    const splitInstruction = formatFundingInstruction(splitEscrow, { ...paymentMeta, totalPayable: 10200 });
    expect(splitInstruction).toContain("Sivan fee: NGN 200 (50/50 split)");
  });
});
