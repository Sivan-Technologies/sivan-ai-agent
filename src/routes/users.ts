import { Router } from "express";
import { requireCoreApiAuth } from "../middleware/apiAuth";
import {
  userProfileSchema,
  payoutAccountSchema,
  participantEscrowQuerySchema,
  formatZodError,
} from "../validation";
import {
  escrowStore,
  monnifyClient,
  settingsStore,
} from "../context";
import { getPayoutVerificationTestResolution } from "../services/payoutVerificationTestMode";
import { scoreAccountName } from "../services/nameMatch";
import { filterBanks, NIGERIA_BANK_FALLBACKS } from "../services/bankFallback";
import {
  refreshEscrowPaymentLifecycleForRead,
  buildParticipantDealSummary,
} from "../services/escrowService";
import {
  captureOperationalError,
  capturePaymentWarning,
} from "../services/monitoring";
import { warn } from "../lib/logger";
import { EscrowRecord } from "../services/escrowStore";

const router = Router();

router.post("/api/users/profile", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = userProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid profile payload", details: formatZodError(parsed.error) });
    }
    const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber);
    const updated = await escrowStore.updateUserProfile(user.userId, parsed.data.firstName, parsed.data.lastName);
    res.status(200).json(updated);
  } catch (err: any) {
    captureOperationalError("Failed to save user profile", err, { whatsappNumber: req.body?.whatsappNumber });
    res.status(503).json({ error: "PROFILE_SAVE_UNAVAILABLE", message: "Profile save is temporarily unavailable" });
  }
});

router.get("/api/users/profile", requireCoreApiAuth, async (req, res) => {
  const whatsappNumber = typeof req.query.whatsappNumber === "string" ? req.query.whatsappNumber : "";
  const parsed = userProfileSchema.shape.whatsappNumber.safeParse(whatsappNumber);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid WhatsApp number" });
  }
  const user = await escrowStore.findUserByWhatsapp(parsed.data);
  if (!user) {
    return res.status(404).json({ error: "User profile not found" });
  }
  res.status(200).json(user);
});

router.post("/api/users/payout-account", requireCoreApiAuth, async (req, res) => {
  const parsed = payoutAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payout account payload", details: formatZodError(parsed.error) });
  }
  const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber, "seller");
  const sellerName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  let resolution = getPayoutVerificationTestResolution({
    accountNumber: parsed.data.accountNumber,
    whatsappNumber: parsed.data.whatsappNumber,
    sellerName,
  }, parsed.data.bankCode);
  let verificationProvider = "monnify_name_enquiry";
  if (resolution) {
    verificationProvider = "sandbox_test_override";
    warn("Using allowlisted sandbox payout verification override", {
      whatsappNumber: parsed.data.whatsappNumber,
      bankCode: parsed.data.bankCode,
      accountNumberLast4: parsed.data.accountNumber.slice(-4),
    });
  } else {
    if (monnifyClient.isConfigured()) {
      try {
        resolution = await monnifyClient.validateBankAccount(parsed.data.accountNumber, parsed.data.bankCode);
        verificationProvider = "monnify_name_enquiry";
      } catch (monnifyErr: any) {
        warn("Monnify account verification failed", {
          monnifyError: monnifyErr?.message || String(monnifyErr),
        });
      }
    }
  }

  if (!resolution) {
    const payout = await escrowStore.upsertPayoutAccount({
      userId: user.userId,
      bankName: parsed.data.bankName,
      bankCode: parsed.data.bankCode,
      accountNumber: parsed.data.accountNumber,
      accountName: parsed.data.accountName,
      verificationStatus: "failed",
    });
    return res.status(422).json({ error: "Bank account verification failed", payout });
  }

  const nameMatch = scoreAccountName(sellerName, resolution.accountName);
  const sharedAccountCount = (await escrowStore.countUsersWithPayoutAccountNumber(parsed.data.accountNumber, user.userId)) + 1;
  const settings = await settingsStore.getSettings();
  const sharedAccountReviewCount = settings.payoutSharedAccountReviewCount;
  const sharedAccountFlag = sharedAccountCount >= sharedAccountReviewCount;
  const verificationStatus =
    nameMatch.level === "failed"
      ? "failed"
      : nameMatch.acceptable && !sharedAccountFlag
      ? "verified"
      : "pending";
  const payout = await escrowStore.upsertPayoutAccount({
    userId: user.userId,
    bankName: parsed.data.bankName,
    bankCode: parsed.data.bankCode,
    accountNumber: parsed.data.accountNumber,
    accountName: resolution.accountName,
    resolvedAccountName: resolution.accountName,
    nameMatchScore: nameMatch.score,
    nameMatchLevel: nameMatch.level,
    accountVerifiedAt: verificationStatus === "verified" ? new Date().toISOString() : undefined,
    accountVerificationProvider: verificationProvider,
    sharedAccountCount,
    sharedAccountFlag,
    verificationStatus,
  });
  if (verificationStatus !== "verified") {
    return res.status(nameMatch.level === "failed" ? 422 : 409).json({
      error: nameMatch.level === "failed" ? "ACCOUNT_NAME_MATCH_FAILED" : "PAYOUT_REQUIRES_REVIEW",
      message: sharedAccountFlag
        ? "This payout account is shared by multiple sellers and requires compliance review"
        : "The resolved account name needs manual compliance review before payout approval",
      payout,
    });
  }
  res.status(200).json(payout);
});

router.get("/api/banks", requireCoreApiAuth, async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    res.status(200).json(filterBanks(NIGERIA_BANK_FALLBACKS, query, query ? 8 : 100));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch banks" });
  }
});

router.get("/api/users/escrows", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = participantEscrowQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Participant WhatsApp is required", details: formatZodError(parsed.error) });
    }
    const rawEscrows = await escrowStore.listEscrowsForWhatsapp(parsed.data.actorWhatsapp, parsed.data.limit);
    const escrows = (await Promise.all(rawEscrows.map((escrow) => refreshEscrowPaymentLifecycleForRead(escrow.escrowId, "participant_deals"))))
      .filter(Boolean) as EscrowRecord[];
    const deals = await Promise.all(escrows.map(async (escrow) => {
      try {
        return await buildParticipantDealSummary(escrow, parsed.data.actorWhatsapp);
      } catch (err: any) {
        console.warn("Skipping participant deal summary", {
          escrowId: escrow.escrowId,
          actorWhatsapp: parsed.data.actorWhatsapp,
          error: err?.message || err,
        });
        return null;
      }
    }));
    res.status(200).json({ deals: deals.filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Unable to load participant deals" });
  }
});

export default router;
