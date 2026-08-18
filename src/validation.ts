import { z } from "zod";

const moneyAmount = z.coerce.number().positive().max(100_000_000);
const restrictedPurposeTerms = [
  "drugs", "cocaine", "heroin", "meth", "methamphetamine", "mdma", "ecstasy", "lsd", "opioids", "fentanyl",
  "weed", "marijuana", "cannabis", "skunk", "tramadol", "codeine",
  "hookup", "runs", "escort", "prostitute", "prostitution", "sex work", "adult service", "nudes", "onlyfans",
  "gun", "guns", "pistol", "rifle", "ammo", "ammunition", "weapon", "weapons", "knife attack", "bomb", "explosive",
  "killing", "kill", "murder", "assassinate", "kidnap", "kidnapping", "hitman",
  "crypto", "cryptocurrency", "bitcoin", "btc", "ethereum", "eth", "usdt", "usdc", "bnb", "tron", "trx",
  "solana", "sol", "xrp", "ripple", "doge", "dogecoin", "litecoin", "ltc", "ton", "toncoin", "airdrop",
  "wallet", "seed phrase", "private key", "stablecoin", "token", "tokens", "coin", "coins", "nft", "defi",
  "dex", "binance", "bybit", "okx", "kucoin", "trust wallet", "metamask",
  "carding", "stolen card", "bank log", "bank logs", "cashout", "cash out", "money laundering", "launder",
  "fake alert", "scam", "fraud", "forged", "fake id",
];

function hasRestrictedPurposeTerm(value: string) {
  const clean = value.toLowerCase().replace(/[_-]+/g, " ");
  return restrictedPurposeTerms.some((term) =>
    new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(clean)
  );
}

export const taskRequestSchema = z.object({
  taskType: z.string().trim().min(2).max(80).default("content-creation"),
  userPaymentPreference: z.enum(["NAIRA", "USDC", "USDT"]),
  userEmail: z.string().trim().min(3).max(160),
  amount: moneyAmount,
  instructions: z.string().trim().min(5).max(4000),
  usdcChannel: z.enum(["x402", "sap"]).optional(),
});

function normalizeWhatsappAddress(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return `whatsapp:+234${digits.slice(1)}`;
  if (digits.length === 13 && digits.startsWith("234")) return `whatsapp:+${digits}`;
  if (/^whatsapp:\+/.test(trimmed)) return trimmed;
  return `whatsapp:+${digits}`;
}

const whatsappAddress = z.string()
  .trim()
  .transform(normalizeWhatsappAddress)
  .pipe(
    z.string()
      .min(8)
      .max(80)
      .regex(/^whatsapp:\+?[0-9]{8,20}$/, "Must be a WhatsApp address")
  );

export const escrowCreateSchema = z.object({
  buyerWhatsapp: whatsappAddress,
  sellerWhatsapp: whatsappAddress.optional(),
  amount: moneyAmount,
  currency: z.enum(["NAIRA", "USDC", "USDT"]),
  purpose: z.string().trim().min(3).max(1000).refine(
    (value) => !hasRestrictedPurposeTerm(value),
    "Service agreement purpose contains a restricted term"
  ),
  channel: z.enum(["whatsapp_dm", "whatsapp_group", "admin", "api"]).default("api"),
  clientRequestId: z.string().trim().min(8).max(120).optional(),
  feePayer: z.enum(["buyer", "seller", "split"]).default("buyer"),
});

export const userProfileSchema = z.object({
  whatsappNumber: whatsappAddress,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});

export const payoutAccountSchema = z.object({
  whatsappNumber: whatsappAddress,
  bankName: z.string().trim().min(2).max(120),
  bankCode: z.string().trim().min(2).max(20),
  accountNumber: z.string().trim().min(6).max(20).regex(/^[0-9]+$/, "Account number must contain only digits"),
  accountName: z.string().trim().min(2).max(160).optional(),
});

/**
 * The account id an action is attributed to.
 *
 * Exists because whatsappAddress accepts digits only, so it cannot carry a
 * Telegram-linked actor who has no phone on file. That strictness is worth
 * keeping - it is what stops a `web:<userId>` placeholder being replayed as a
 * credential - so identity is widened with a second field instead.
 *
 * Callers may send either or both; escrowService.resolveActorUserId rejects the
 * pair when they disagree.
 */
const actorUserId = z.string().trim().min(1).max(120);

export const escrowActionSchema = z.object({
  actorWhatsapp: whatsappAddress.optional(),
  actorUserId: actorUserId.optional(),
  reason: z.string().trim().min(2).max(1000).optional(),
});

// Shared so every participant endpoint spells identity the same way, and so
// callers can validate identity alone without also demanding a `limit`.
const participantActorFields = {
  actorWhatsapp: whatsappAddress.optional(),
  actorUserId: actorUserId.optional(),
};

// At least one identifier, rather than a specific one. actorWhatsapp used to be
// mandatory, which made these endpoints unreachable for an account with no
// phone on file.
const hasActorIdentity = (value: { actorWhatsapp?: string; actorUserId?: string }) =>
  Boolean(value.actorWhatsapp || value.actorUserId);
const actorIdentityMessage = { message: "actorWhatsapp or actorUserId is required" };

export const participantActorSchema = z
  .object(participantActorFields)
  .refine(hasActorIdentity, actorIdentityMessage);

export const participantEscrowQuerySchema = z
  .object({
    ...participantActorFields,
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(hasActorIdentity, actorIdentityMessage);



export const disputeEvidenceSchema = z.object({
  evidenceType: z.enum(["message", "payment_proof", "delivery_proof", "identity", "other"]).default("other"),
  source: z.enum(["buyer", "seller", "admin", "support", "payment_provider"]).default("admin"),
  summary: z.string().trim().min(3).max(2000),
  uri: z.string().trim().url().max(1000).optional(),
  submittedBy: z.string().trim().min(2).max(120).optional(),
  notifyParticipants: z.coerce.boolean().default(false),
});

export const participantDisputeEvidenceSchema = disputeEvidenceSchema.extend({
  actorWhatsapp: whatsappAddress.optional(),
  actorUserId: actorUserId.optional(),
  source: z.enum(["buyer", "seller"]).optional(),
  notifyParticipants: z.coerce.boolean().default(true),
}).refine((value) => Boolean(value.actorWhatsapp || value.actorUserId), {
  message: "actorWhatsapp or actorUserId is required",
});

export const deliveryProofSchema = z.object({
  actorWhatsapp: whatsappAddress.optional(),
  actorUserId: actorUserId.optional(),
  summary: z.string().trim().max(2000).default(""),
  media: z.array(z.object({
    url: z.string().trim().url().max(1000),
    contentType: z.string().trim().min(3).max(120).optional(),
    filename: z.string().trim().min(1).max(240).optional(),
  })).max(5).default([]),
  notifyBuyer: z.coerce.boolean().default(true),
}).refine((value) => Boolean(value.actorWhatsapp || value.actorUserId), {
  message: "actorWhatsapp or actorUserId is required",
});


export const disputeResolutionSchema = z.object({
  outcome: z.enum(["release_to_seller", "refund_buyer", "cancel_no_funds", "no_action_close"]),
  reason: z.string().trim().min(5).max(2000),
  reference: z.string().trim().min(3).max(160).optional(),
  notifyParticipants: z.coerce.boolean().default(false),
});

export const adminReleaseApprovalSchema = z.object({
  manualPayoutReference: z.string().trim().min(3).max(160).optional(),
  payoutNotes: z.string().trim().min(2).max(1000).optional(),
}).strict();

export const adminSettingsSchema = z.object({
  nairaFeePercent: z.coerce.number().min(0).max(50),
  nairaFeeFixed: z.coerce.number().min(0).max(10_000_000),
  usdcFeePercent: z.coerce.number().min(0).max(50),
  usdcFeeFixed: z.coerce.number().min(0).max(100_000),
  nairaNewUserLimit: z.coerce.number().positive().max(100_000_000).optional(),
  nairaTrustedUserLimit: z.coerce.number().positive().max(100_000_000).optional(),
  nairaEstablishedUserLimit: z.coerce.number().positive().max(100_000_000).optional(),
  nairaSpecialApprovalLimit: z.coerce.number().positive().max(100_000_000).optional(),
  nairaBuyerActiveExposureLimit: z.coerce.number().positive().max(10_000_000_000).optional(),
  nairaPlatformActiveExposureLimit: z.coerce.number().positive().max(10_000_000_000).optional(),
  trustedUserSuccessfulEscrows: z.coerce.number().int().min(1).max(1000).optional(),
  establishedUserSuccessfulEscrows: z.coerce.number().int().min(2).max(1000).optional(),
  platformMode: z.enum(["test", "live", "maintenance"]).optional(),
  maintenanceMessage: z.string().trim().min(10).max(500).optional(),
  nairaPaymentMethod: z.literal("bank_transfer").optional(),
  nairaFeeModel: z.enum(["simple", "tiered"]).optional(),
  nairaFeeTiers: z.string().optional(),
  nairaFundingWindowHours: z.coerce.number().int().positive().max(168).optional(),
  nairaHighValueFundingWindowHours: z.coerce.number().int().positive().max(168).optional(),
  nairaHighValueFundingWindowAmount: z.coerce.number().positive().max(1_000_000_000).optional(),
  nairaFundingReminderBeforeExpiryHours: z.coerce.number().int().positive().max(168).optional(),
  // Compliance & Risk
  payoutSharedAccountReviewCount: z.coerce.number().int().nonnegative().optional(),
  complianceNewSellerEscrowCount: z.coerce.number().int().nonnegative().optional(),
  complianceHighDisputeRatio: z.coerce.number().min(0).max(1).optional(),
  complianceHighDisputeMinEscrows: z.coerce.number().int().nonnegative().optional(),
  nairaHighValueReviewAmount: z.coerce.number().nonnegative().optional(),
  usdcHighValueReviewAmount: z.coerce.number().nonnegative().optional(),
  // Worker Controls
  paymentLifecycleWorkerEnabled: z.coerce.boolean().optional(),
  paymentLifecycleWorkerIntervalMs: z.coerce.number().int().positive().optional(),
  reconciliationWorkerEnabled: z.coerce.boolean().optional(),
  queueWorkerEnabled: z.coerce.boolean().optional(),
  stuckEscrowAlertMinutes: z.coerce.number().int().positive().optional(),
  autoReleaseEnabled: z.coerce.boolean().optional(),
  deliveryInspectionWindowDays: z.coerce.number().int().min(1).max(30).optional(),
  // Disaster Recovery
  outageStatusPageUrl: z.string().trim().optional(),
  outageContacts: z.string().trim().min(5).max(250).optional(),
  // Crypto Network & Mode Controls
  cryptoNetwork: z.enum(["solana", "avalanche", "ethereum", "arbitrum"]).optional(),
  networkMode: z.enum(["devnet", "mainnet"]).optional(),
  expectedVersion: z.coerce.number().int().positive(),
});


export const escrowLimitReviewDecisionSchema = z.object({
  notes: z.string().trim().min(3).max(2000),
});

export const whatsappProviderSwitchSchema = z.object({
  provider: z.enum(["twilio", "meta"]),
});

export const nairaPaymentProviderIdSchema = z.enum(["paystack", "monnify", "palmpay", "flutterwave", "nomba"]);

export const paymentProviderSettingsSchema = z.object({
  activePaymentProvider: nairaPaymentProviderIdSchema,
  backupPaymentProvider: nairaPaymentProviderIdSchema,
  emergencyPaymentProvider: nairaPaymentProviderIdSchema,
  paymentProviderFallbackEnabled: z.coerce.boolean().default(false),
  cryptoNetwork: z.enum(["solana", "avalanche", "ethereum", "arbitrum"]).optional(),
  networkMode: z.enum(["devnet", "mainnet"]).optional(),
  expectedVersion: z.coerce.number().int().positive(),
});

export const supportCaseCreateSchema = z.object({
  subject: z.string().trim().min(3).max(240),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  relatedEscrowId: z.string().trim().min(3).max(80).optional(),
  relatedUser: z.string().trim().min(3).max(120).optional(),
  source: z.string().trim().min(2).max(80).default("admin"),
  note: z.string().trim().min(2).max(2000).optional(),
});

export const supportNoteCreateSchema = z.object({
  body: z.string().trim().min(2).max(4000),
  actionType: z.string().trim().min(2).max(80).optional(),
});

export const supportCaseUpdateSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedTo: z.string().trim().min(2).max(120).optional(),
  note: z.string().trim().min(2).max(2000).optional(),
});

export const supportSearchSchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(250).default(50),
});

export const abuseActionSchema = z.object({
  subjectType: z.enum(["user", "device", "ip", "user_agent", "escrow_create", "other"]).default("user"),
  subjectId: z.string().trim().min(2).max(240),
  action: z.enum(["watch", "warn", "limit", "block", "clear"]),
  reason: z.string().trim().min(3).max(2000),
  expiresAt: z.string().datetime().optional(),
});

export const queueJobCreateSchema = z.object({
  jobType: z.enum(["whatsapp_notification", "payment_recheck", "paystack_recheck", "payout_review", "webhook_recovery", "daily_reconciliation"]),
  payload: z.record(z.string(), z.any()).default({}),
  maxAttempts: z.coerce.number().int().min(1).max(25).default(5),
  runAfter: z.string().datetime().optional(),
});

export const queueRunSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const queueRetrySchema = z.object({
  resetAttempts: z.coerce.boolean().default(false),
});

export const paystackWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  event: z.string().trim().min(1).max(120),
  data: z.object({
    reference: z.string().trim().min(3).max(160),
    status: z.string().trim().max(80).optional(),
    amount: z.number().optional(),
    currency: z.string().trim().max(16).optional(),
  }),
});


export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(50),
});

export const reconciliationRunSchema = z.object({
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  providers: z.array(z.enum(["paystack", "monnify", "palmpay", "flutterwave"])).min(1).max(4).optional(),
  alertOnFindings: z.coerce.boolean().default(true),
});

export function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
}
