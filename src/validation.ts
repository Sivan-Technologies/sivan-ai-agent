import { z } from "zod";

const moneyAmount = z.coerce.number().positive().max(100_000_000);

export const taskRequestSchema = z.object({
  taskType: z.string().trim().min(2).max(80).default("content-creation"),
  userPaymentPreference: z.enum(["NAIRA", "USDC"]),
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
  .min(8)
  .max(80)
  .regex(/^whatsapp:\+?[0-9]{8,20}$/, "Must be a WhatsApp address")
  .transform(normalizeWhatsappAddress);

export const escrowCreateSchema = z.object({
  buyerWhatsapp: whatsappAddress,
  sellerWhatsapp: whatsappAddress.optional(),
  amount: moneyAmount,
  currency: z.enum(["NAIRA", "USDC"]),
  purpose: z.string().trim().min(3).max(1000),
  channel: z.enum(["whatsapp_dm", "whatsapp_group", "admin", "api"]).default("api"),
  clientRequestId: z.string().trim().min(8).max(120).optional(),
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

export const escrowActionSchema = z.object({
  actorWhatsapp: whatsappAddress.optional(),
  reason: z.string().trim().min(2).max(1000).optional(),
});

export const participantEscrowQuerySchema = z.object({
  actorWhatsapp: whatsappAddress,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const disputeEvidenceSchema = z.object({
  evidenceType: z.enum(["message", "payment_proof", "delivery_proof", "identity", "other"]).default("other"),
  source: z.enum(["buyer", "seller", "admin", "support", "payment_provider"]).default("admin"),
  summary: z.string().trim().min(3).max(2000),
  uri: z.string().trim().url().max(1000).optional(),
  submittedBy: z.string().trim().min(2).max(120).optional(),
  notifyParticipants: z.coerce.boolean().default(false),
});

export const participantDisputeEvidenceSchema = disputeEvidenceSchema.extend({
  actorWhatsapp: whatsappAddress,
  source: z.enum(["buyer", "seller"]).optional(),
  notifyParticipants: z.coerce.boolean().default(true),
});

export const deliveryProofSchema = z.object({
  actorWhatsapp: whatsappAddress,
  summary: z.string().trim().max(2000).default(""),
  media: z.array(z.object({
    url: z.string().trim().url().max(1000),
    contentType: z.string().trim().min(3).max(120).optional(),
    filename: z.string().trim().min(1).max(240).optional(),
  })).max(5).default([]),
  notifyBuyer: z.coerce.boolean().default(true),
});

export const disputeResolutionSchema = z.object({
  outcome: z.enum(["release_to_seller", "refund_buyer", "cancel_no_funds", "no_action_close"]),
  reason: z.string().trim().min(5).max(2000),
  reference: z.string().trim().min(3).max(160).optional(),
  notifyParticipants: z.coerce.boolean().default(false),
});

export const adminReleaseApprovalSchema = z.object({
  manualPayoutReference: z.string().trim().min(3).max(160),
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
  expectedVersion: z.coerce.number().int().positive(),
});

export const escrowLimitReviewDecisionSchema = z.object({
  notes: z.string().trim().min(3).max(2000),
});

export const whatsappProviderSwitchSchema = z.object({
  provider: z.enum(["twilio", "meta"]),
});

export const nairaPaymentProviderIdSchema = z.enum(["paystack", "monnify", "palmpay", "flutterwave"]);

export const paymentProviderSettingsSchema = z.object({
  activePaymentProvider: nairaPaymentProviderIdSchema,
  backupPaymentProvider: nairaPaymentProviderIdSchema,
  emergencyPaymentProvider: nairaPaymentProviderIdSchema,
  paymentProviderFallbackEnabled: z.coerce.boolean().default(false),
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
  jobType: z.enum(["whatsapp_notification", "paystack_recheck", "payout_review", "webhook_recovery"]),
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

export function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
}
