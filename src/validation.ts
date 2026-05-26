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

const whatsappAddress = z.string().trim().min(8).max(80).regex(/^whatsapp:\+?[0-9]{8,20}$/, "Must be a WhatsApp address");

export const escrowCreateSchema = z.object({
  buyerWhatsapp: whatsappAddress,
  sellerWhatsapp: whatsappAddress.optional(),
  amount: moneyAmount,
  currency: z.enum(["NAIRA", "USDC"]),
  purpose: z.string().trim().min(3).max(1000),
  channel: z.enum(["whatsapp_dm", "whatsapp_group", "admin", "api"]).default("api"),
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

export const adminReleaseApprovalSchema = z.object({
  manualPayoutReference: z.string().trim().min(3).max(160),
  payoutNotes: z.string().trim().min(2).max(1000).optional(),
});

export const adminSettingsSchema = z.object({
  nairaFeePercent: z.coerce.number().min(0).max(50),
  nairaFeeFixed: z.coerce.number().min(0).max(10_000_000),
  usdcFeePercent: z.coerce.number().min(0).max(50),
  usdcFeeFixed: z.coerce.number().min(0).max(100_000),
  expectedVersion: z.coerce.number().int().positive(),
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
