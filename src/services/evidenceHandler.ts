/**
 * Validation and persistence of delivery proof and dispute evidence, including
 * media upload to R2 and the external-link policy.
 *
 * Extracted verbatim from escrowService.ts as step 10 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 *
 * NOTE: also absorbs recordDeliveryProof, externalDeliveryLinksAllowed and
 * containsExternalLink, which the plan's responsibility map omitted.
 */
import axios from "axios";
import { config } from "../config";
import { EscrowRecord } from "./escrowStore";
import { escrowStore, opsStore } from "../context";
import { uploadEvidenceUrlToR2 } from "./storageService";
import { buildEscrowDetail } from "./escrowDetailBuilder";
import { notifyEscrowParticipants, notifyBuyerDeliverySubmitted } from "./notificationOrchestrator";

export async function recordDisputeEvidence(input: {
  escrow: EscrowRecord;
  actor: string;
  actorRole: string;
  channel: string;
  evidence: {
    evidenceType: string;
    source: string;
    summary: string;
    uri?: string;
    submittedBy?: string;
    notifyParticipants?: boolean;
  };
}) {
  const { escrow, actor, actorRole, channel, evidence } = input;
  await escrowStore.addEvent({
    escrowId: escrow.escrowId,
    actor,
    actorRole,
    channel,
    previousStatus: escrow.status,
    nextStatus: escrow.status,
    eventType: "dispute_evidence_recorded",
    reason: evidence.summary,
    metadata: JSON.stringify({
      evidenceType: evidence.evidenceType,
      uri: evidence.uri || null,
      recordedBy: actor,
      submittedBy: evidence.submittedBy || actor,
    }),
  });
  const supportCases = await opsStore.searchSupportCases(escrow.escrowId, 1);
  if (supportCases[0]) {
    await opsStore.addSupportNote(
      supportCases[0].caseId,
      actor,
      `${evidence.evidenceType}: ${evidence.summary}${evidence.uri ? ` (${evidence.uri})` : ""}`,
      "dispute_evidence"
    );
  }
  if (evidence.notifyParticipants) {
    await notifyEscrowParticipants(escrow, `Issue review update for ${escrow.escrowId}: ${evidence.summary}`);
  }
  return buildEscrowDetail(escrow.escrowId);
}

export function externalDeliveryLinksAllowed() {
  return process.env.DELIVERY_PROOF_ALLOW_EXTERNAL_LINKS === "true";
}

export function containsExternalLink(value: string) {
  return /\bhttps?:\/\/|\bwww\./i.test(value);
}

export async function validateDeliveryProofMedia(
  media: Array<{ url: string; contentType?: string; filename?: string }>
): Promise<void> {
  if (config.databaseMode === "test") {
    return;
  }

  const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "video/mp4",
  ];

  for (const item of media) {
    const url = item.url;
    if (!url) {
      throw new Error("Evidence file URL is required");
    }

    // 1. Storage Isolation Validation
    const sivanBucketPattern = /sivan-(test|live)-bucket/i;
    const match = url.match(sivanBucketPattern);
    if (match) {
      const mode = match[1];
      if (mode !== config.databaseMode) {
        throw new Error(`Evidence storage mismatch: Cannot use a ${mode} storage URL in ${config.databaseMode} mode`);
      }
    }

    // 2. Anti-reuse validation (Immutable evidence check)
    const isLinked = await escrowStore.isMediaUrlLinked(url);
    if (isLinked) {
      throw new Error(`Evidence URL has already been submitted in a different transaction: ${url}`);
    }

    // 3. HTTP HEAD/GET range checks to verify size and content-type
    const isTwilioUrl = url.includes("api.twilio.com");
    const hasTwilioCreds = Boolean(config.twilio?.accountSid && config.twilio?.authToken);

    if (isTwilioUrl && !hasTwilioCreds) {
      if (item.contentType) {
        const matchesMimetype = allowedMimeTypes.some((mime) => item.contentType?.toLowerCase().startsWith(mime));
        if (!matchesMimetype) {
          throw new Error(`Unsupported evidence file type: ${item.contentType}. Only PDF, JPG, PNG, and MP4 are allowed.`);
        }
      }
      continue;
    }

    const requestHeaders: Record<string, string> = { "User-Agent": "SivanEvidenceValidator/1.0" };
    if (isTwilioUrl && hasTwilioCreds) {
      const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
      requestHeaders["Authorization"] = `Basic ${auth}`;
    }

    try {
      const res = await axios.head(url, { timeout: 8000, headers: requestHeaders });
      const serverType = String(res.headers["content-type"] || "").toLowerCase();
      const serverLength = Number(res.headers["content-length"] || 0);

      const matchesMimetype = allowedMimeTypes.some((mime) => serverType.startsWith(mime));
      if (!matchesMimetype) {
        throw new Error(`Unsupported evidence file type: ${serverType || "unknown"}. Only PDF, JPG, PNG, and MP4 are allowed.`);
      }

      const isVideo = serverType.startsWith("video/");
      const limit = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (serverLength > limit) {
        throw new Error(`Evidence file size exceeds the limit of ${isVideo ? "50MB" : "10MB"}: ${(serverLength / (1024 * 1024)).toFixed(1)}MB`);
      }
    } catch (err: any) {
      try {
        const getHeaders = { ...requestHeaders, Range: "bytes=0-10" };
        const res = await axios.get(url, {
          headers: getHeaders,
          timeout: 8000,
        });
        const serverType = String(res.headers["content-type"] || "").toLowerCase();
        const serverLength = Number(res.headers["content-range"]?.split("/")?.[1] || res.headers["content-length"] || 0);

        const matchesMimetype = allowedMimeTypes.some((mime) => serverType.startsWith(mime));
        if (!matchesMimetype) {
          throw new Error(`Unsupported evidence file type: ${serverType || "unknown"}. Only PDF, JPG, PNG, and MP4 are allowed.`);
        }

        const isVideo = serverType.startsWith("video/");
        const limit = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (serverLength > limit) {
          throw new Error(`Evidence file size exceeds the limit of ${isVideo ? "50MB" : "10MB"}: ${(serverLength / (1024 * 1024)).toFixed(1)}MB`);
        }
      } catch (getErr: any) {
        throw new Error(`Invalid or unreachable evidence upload link: ${err.message || String(err)}`);
      }
    }
  }
}

export async function recordDeliveryProof(input: {
  escrow: EscrowRecord;
  /**
   * Audit label for who submitted this proof - a WhatsApp address or a userId,
   * whichever the caller authenticated with. Authorization happened before this
   * point; this value is recorded, not trusted.
   */
  actor: string;
  summary: string;
  media: Array<{ url: string; contentType?: string; filename?: string }>;
  notifyBuyer: boolean;
}) {
  const { escrow, actor, summary, media, notifyBuyer } = input;

  const safeSummary = summary.trim() || "Seller submitted delivery proof";

  // Validate the evidence files first
  await validateDeliveryProofMedia(media);

  // Upload whitelisted media files to Cloudflare R2
  const uploadedMedia = await Promise.all(
    media.map(async (m) => {
      const filename = m.filename || `evidence_${Date.now()}.${m.contentType?.split("/")?.[1] || "pdf"}`;
      const r2Key = await uploadEvidenceUrlToR2(m.url, filename);
      return {
        ...m,
        url: `r2://${r2Key}`,
        originalUrl: m.url,
      };
    })
  );

  // Storage tagging and immutable linking
  const storageMode = config.databaseMode;
  const paymentReference = escrow.paymentReference || "unfunded_or_test";

  // Audit trail logging payload
  const auditTrail = {
    uploadedBy: actor,
    uploadedAt: new Date().toISOString(),
    escrowStage: escrow.status,
    paymentReference,
    storageMode,
  };

  const updated = await escrowStore.markDelivered(
    escrow.escrowId,
    actor,
    "whatsapp_dm",

    safeSummary,
    JSON.stringify({
      summary: safeSummary,
      media: uploadedMedia,
      mediaCount: uploadedMedia.length,
      externalLinksAllowed: externalDeliveryLinksAllowed(),
      auditTrail,
    })
  );

  if (notifyBuyer) await notifyBuyerDeliverySubmitted(updated, safeSummary, uploadedMedia);
  return buildEscrowDetail(escrow.escrowId);
}
