import { config } from "../config";
import { PalmPayClient } from "../services/palmpayClient";
import { PalmPayPayoutClient } from "../services/palmpayPayoutClient";

function requirePalmPayCollectionEnv() {
  const missing = [
    ["PALMPAY_APP_ID", config.palmpay.appId],
    ["PALMPAY_MERCHANT_PRIVATE_KEY", config.palmpay.merchantPrivateKey],
    ["PALMPAY_PLATFORM_PUBLIC_KEY", config.palmpay.platformPublicKey],
    ["PALMPAY_WEBHOOK_URL", config.palmpay.webhookUrl],
  ].filter(([, value]) => !value);
  if (missing.length) {
    throw new Error(`Missing PalmPay collection env: ${missing.map(([key]) => key).join(", ")}`);
  }
}

async function main() {
  requirePalmPayCollectionEnv();
  const client = new PalmPayClient();
  const amount = Number(process.env.PALMPAY_PROOF_AMOUNT || "100");
  if (!Number.isFinite(amount) || amount < 100) {
    throw new Error("PALMPAY_PROOF_AMOUNT must be at least 100 NGN for PalmPay create-order proof");
  }

  const paymentReference = process.env.PALMPAY_PROOF_ORDER_ID?.trim() ||
    `PPPROOF${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

  console.log("PalmPay collection proof environment", {
    baseUrl: config.palmpay.baseUrl,
    appIdPresent: Boolean(config.palmpay.appId),
    webhookUrl: config.palmpay.webhookUrl,
    callbackUrl: config.palmpay.callbackUrl,
    countryCode: config.palmpay.countryCode,
    paymentMethods: config.palmpay.paymentMethods,
  });

  const created = await client.initializeBankTransferPayment({
    amount,
    customerEmail: process.env.PALMPAY_PROOF_USER_ID || "palmpay-proof@sivan.local",
    paymentReference,
    paymentDescription: `Sivan PalmPay proof ${paymentReference}`,
    metadata: { escrowId: paymentReference, proof: true },
  });
  console.log("PalmPay create-order proof", {
    paymentReference: created.paymentReference,
    orderNo: created.transactionReference,
    checkoutUrlPresent: Boolean(created.checkoutUrl),
    accountNumberPresent: Boolean(created.accountNumber),
    bankName: created.bankName,
    expiresAt: created.expiresAt,
  });

  const verified = await client.verifyPayment(created.paymentReference);
  console.log("PalmPay query-order proof", {
    paymentReference: verified.paymentReference,
    orderNo: verified.transactionReference,
    status: verified.status,
    amount: verified.amount,
    currency: verified.currency,
    paymentMethod: verified.paymentMethod,
  });

  if (process.env.PALMPAY_PROOF_RUN_PAYOUT !== "true") {
    console.log("Skipping PalmPay payout proof. Set PALMPAY_PROOF_RUN_PAYOUT=true and PALMPAY_PAYOUT_ENABLED=true to test payout.");
    return;
  }
  if (!config.palmpay.payoutEnabled) {
    throw new Error("PALMPAY_PAYOUT_ENABLED=true is required before payout proof can run");
  }

  const payeeName = process.env.PALMPAY_PROOF_PAYEE_NAME?.trim() || "";
  const payeeBankCode = process.env.PALMPAY_PROOF_PAYEE_BANK_CODE?.trim() || "";
  const payeeBankAccNo = process.env.PALMPAY_PROOF_PAYEE_ACCOUNT_NUMBER?.trim() || "";
  if (!payeeName || !payeeBankCode || !payeeBankAccNo) {
    throw new Error("PALMPAY_PROOF_PAYEE_NAME, PALMPAY_PROOF_PAYEE_BANK_CODE, and PALMPAY_PROOF_PAYEE_ACCOUNT_NUMBER are required for payout proof");
  }

  const payoutClient = new PalmPayPayoutClient();
  const payoutOrderId = process.env.PALMPAY_PROOF_PAYOUT_ORDER_ID?.trim() ||
    `PPOPROOF${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  const payout = await payoutClient.initiatePayout({
    orderId: payoutOrderId,
    payeeName,
    payeeBankCode,
    payeeBankAccNo,
    amount: Number(process.env.PALMPAY_PROOF_PAYOUT_AMOUNT || "100"),
    currency: "NAIRA",
    remark: "Sivan PalmPay sandbox payout proof",
  });
  console.log("PalmPay payout proof", {
    orderId: payout.orderId,
    orderNo: payout.orderNo,
    status: payout.status,
    amount: payout.amount,
    fee: payout.fee,
    sessionId: payout.sessionId,
    message: payout.message,
  });

  const queried = await payoutClient.queryPayoutStatus({ orderId: payout.orderId, orderNo: payout.orderNo });
  console.log("PalmPay payout query proof", {
    orderId: queried.orderId,
    orderNo: queried.orderNo,
    status: queried.status,
    amount: queried.amount,
    fee: queried.fee,
    sessionId: queried.sessionId,
    message: queried.message,
  });
}

main().catch((err) => {
  console.error("PalmPay proof failed:", err?.message || err);
  process.exit(1);
});
