import { config } from "../config";
import { NombaPayoutClient } from "../services/nombaPayoutClient";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Nomba transfer proof`);
  return value;
}

async function main() {
  const client = new NombaPayoutClient();
  if (!config.nomba.clientId || !config.nomba.clientSecret || !config.nomba.accountId) {
    throw new Error("NOMBA_CLIENT_ID, NOMBA_CLIENT_SECRET, and NOMBA_ACCOUNT_ID are required");
  }

  console.log("Nomba proof environment", {
    baseUrl: config.nomba.baseUrl,
    accountIdPresent: Boolean(config.nomba.accountId),
    payoutEnabled: config.nomba.payoutEnabled,
    senderName: config.nomba.senderName,
    subAccountMode: Boolean(config.nomba.subAccountId),
  });

  const banks = await client.listBanks();
  console.log("Bank list proof", {
    count: banks.length,
    sample: banks.slice(0, 5),
  });

  const accountNumber = process.env.NOMBA_PROOF_ACCOUNT_NUMBER?.trim();
  const bankCode = process.env.NOMBA_PROOF_BANK_CODE?.trim();
  if (!accountNumber || !bankCode) {
    console.log("Skipping account lookup. Set NOMBA_PROOF_ACCOUNT_NUMBER and NOMBA_PROOF_BANK_CODE to run lookup proof.");
    return;
  }

  const lookup = await client.lookupBankAccount(accountNumber, bankCode);
  console.log("Account lookup proof", {
    accountNumber: lookup.accountNumber,
    bankCode: lookup.bankCode,
    accountName: lookup.accountName,
  });

  if (process.env.NOMBA_PROOF_RUN_TRANSFER !== "true") {
    console.log("Skipping transfer. Set NOMBA_PROOF_RUN_TRANSFER=true to initiate a sandbox transfer.");
    return;
  }

  if (!config.nomba.payoutEnabled) {
    throw new Error("NOMBA_PAYOUT_ENABLED=true is required before the proof script can initiate transfer");
  }

  const amount = Number(process.env.NOMBA_PROOF_AMOUNT || "100");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("NOMBA_PROOF_AMOUNT must be a positive number");
  }

  const merchantTxRef = process.env.NOMBA_PROOF_MERCHANT_TX_REF?.trim() ||
    `NOMBA_PROOF_${Date.now()}`;
  const result = await client.initiateBankTransfer({
    merchantTxRef,
    accountNumber: lookup.accountNumber,
    accountName: lookup.accountName,
    bankCode: lookup.bankCode,
    amount,
    currency: "NAIRA",
    senderName: config.nomba.senderName,
    narration: "Sivan Nomba sandbox transfer proof",
  });

  console.log("Transfer proof", {
    merchantTxRef: result.merchantTxRef,
    transactionId: result.transactionId,
    status: result.status,
    amount: result.amount,
    fee: result.fee,
    message: result.message,
  });

  const requeryReference = result.transactionId || result.merchantTxRef || required("NOMBA_PROOF_MERCHANT_TX_REF");
  const requery = await client.requeryTransfer(requeryReference);
  console.log("Transfer requery proof", {
    merchantTxRef: requery.merchantTxRef,
    transactionId: requery.transactionId,
    status: requery.status,
    amount: requery.amount,
    fee: requery.fee,
    message: requery.message,
  });
}

main().catch((err) => {
  console.error("Nomba transfer proof failed:", err?.message || err);
  process.exit(1);
});
