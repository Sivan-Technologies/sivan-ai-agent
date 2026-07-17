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
  flutterwaveClient,
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
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (email) {
    const user = await escrowStore.findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "User profile not found by email" });
    }
    return res.status(200).json(user);
  }

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
    const settings = await settingsStore.getSettings();
    const activeProvider = settings.activePaymentProvider?.toLowerCase();

    if (flutterwaveClient.isCollectionConfigured()) {
      try {
        resolution = await flutterwaveClient.resolveBankAccount(parsed.data.accountNumber, parsed.data.bankCode);
        verificationProvider = "flutterwave_name_enquiry";
      } catch (flwErr: any) {
        warn("Flutterwave account verification failed, trying fallback to Monnify", {
          flutterwaveError: flwErr?.message || String(flwErr),
        });
      }
    }

    if (!resolution && monnifyClient.isConfigured()) {
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
    const escrows = (await Promise.all(rawEscrows.map((escrow) => refreshEscrowPaymentLifecycleForRead(escrow, "participant_deals"))))
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

import crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + (process.env.JWT_SECRET || "sivan_salt")).digest("hex");
}

router.post("/api/users/signup", requireCoreApiAuth, async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const existing = await escrowStore.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "EMAIL_ALREADY_EXISTS", message: "User with this email already exists" });
    }
    const passwordHash = hashPassword(password);
    const user = await escrowStore.createUserWithEmail(email, passwordHash, firstName, lastName);
    res.status(201).json(user);
  } catch (err: any) {
    captureOperationalError("User signup failed", err);
    res.status(500).json({ error: err.message || "Signup failed" });
  }
});

router.post("/api/users/login", requireCoreApiAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const user = await escrowStore.findUserByEmail(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }
    if (user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }
    res.status(200).json(user);
  } catch (err: any) {
    captureOperationalError("User login failed", err);
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

router.post("/api/users/whatsapp/pair-code", requireCoreApiAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const token = await escrowStore.generatePairingToken(userId);
    res.status(200).json({ token });
  } catch (err: any) {
    captureOperationalError("Failed to generate pairing token", err);
    res.status(500).json({ error: err.message || "Failed to generate pairing token" });
  }
});

router.post("/api/users/whatsapp/unlink", requireCoreApiAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const updated = await escrowStore.unlinkWhatsApp(userId);
    res.status(200).json(updated);
  } catch (err: any) {
    captureOperationalError("Failed to unlink WhatsApp", err);
    res.status(500).json({ error: err.message || "Failed to unlink WhatsApp" });
  }
});

router.post("/api/users/whatsapp/pair", requireCoreApiAuth, async (req, res) => {
  try {
    const { token, whatsappNumber } = req.body;
    if (!token || !whatsappNumber) {
      return res.status(400).json({ error: "token and whatsappNumber are required" });
    }
    const user = await escrowStore.usePairingToken(token, whatsappNumber);
    if (!user) {
      return res.status(404).json({ error: "INVALID_OR_EXPIRED_TOKEN", message: "The pairing code is invalid or has expired." });
    }
    res.status(200).json(user);
  } catch (err: any) {
    captureOperationalError("Failed to pair WhatsApp", err);
    res.status(500).json({ error: err.message || "Failed to pair WhatsApp" });
  }
});

router.post("/api/users/link-email", requireCoreApiAuth, async (req, res) => {
  try {
    const { whatsappNumber, email } = req.body;
    if (!whatsappNumber || !email) {
      return res.status(400).json({ error: "whatsappNumber and email are required" });
    }
    const user = await escrowStore.findUserByWhatsapp(whatsappNumber);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const existingEmailUser = await escrowStore.findUserByEmail(normalizedEmail);
    if (existingEmailUser) {
      if (existingEmailUser.userId === user.userId) {
        return res.status(200).json(user); // Already linked to this user
      }
      return res.status(409).json({ error: "EMAIL_ALREADY_LINKED", message: "This email is already linked to another Sivan account." });
    }
    const tempPasswordHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
    const updated = await escrowStore.updateUserProfile(user.userId, undefined, undefined, normalizedEmail, tempPasswordHash);
    res.status(200).json(updated);
  } catch (err: any) {
    captureOperationalError("Failed to link email to user profile", err);
    res.status(500).json({ error: err.message || "Failed to link email" });
  }
});

export default router;
