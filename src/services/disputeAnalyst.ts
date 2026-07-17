import { EscrowStore } from "./escrowStore";
import { AceDataClient } from "./aceData";
import { getPresignedDownloadUrl } from "./storageService";
import { info, warn, error } from "../lib/logger";

export interface DisputeRecommendation {
  recommendedPayoutSellerPercent: number;
  recommendedRefundBuyerPercent: number;
  confidenceScore: number;
  reasons: string[];
  justificationSummary: string;
}

async function localResolveR2MediaUrls(events: any[]): Promise<any[]> {
  const resolved = [];
  for (const event of events) {
    if (event.metadata && typeof event.metadata === "string" && event.metadata.includes("r2://")) {
      try {
        const meta = JSON.parse(event.metadata);
        if (meta.media && Array.isArray(meta.media)) {
          meta.media = await Promise.all(
            meta.media.map(async (m: any) => {
              if (m.url && m.url.startsWith("r2://")) {
                const key = m.url.substring(5);
                try {
                  const presignedUrl = await getPresignedDownloadUrl(key);
                  if (presignedUrl.includes("sivan-mock-presigned-url.test") && m.originalUrl) {
                    return { ...m, url: m.originalUrl };
                  }
                  return { ...m, url: presignedUrl };
                } catch {
                  return m;
                }
              }
              return m;
            })
          );
          resolved.push({
            ...event,
            metadata: JSON.stringify(meta),
          });
          continue;
        }
      } catch {
        // fail-safe
      }
    }
    resolved.push(event);
  }
  return resolved;
}

export class DisputeAnalystService {
  constructor(
    private escrowStore: EscrowStore,
    private aceData: AceDataClient
  ) {}

  public async analyzeDispute(escrowId: string): Promise<DisputeRecommendation> {
    info("Starting AI dispute analysis", { escrowId });

    const escrow = await this.escrowStore.getEscrowById(escrowId);
    if (!escrow) {
      throw new Error(`Agreement ${escrowId} not found`);
    }

    if (escrow.aiDisputeRecommendation) {
      info("Retrieved AI dispute recommendation from cache", { escrowId });
      try {
        return JSON.parse(escrow.aiDisputeRecommendation);
      } catch {
        // Fall back to re-calculation if cache parsing fails
      }
    }

    // Gathers all events related to the agreement
    const events = await this.escrowStore.listEvents(escrowId, 100);
    const resolvedEvents = await localResolveR2MediaUrls(events);

    // Extract dispute reasons, delivery proofs, and evidence details
    const disputeOpened = resolvedEvents.find((e) => e.eventType === "dispute_opened");
    const deliveryProofs = resolvedEvents.filter((e) => e.eventType === "seller_delivery_proof_recorded");
    const disputeEvidences = resolvedEvents.filter((e) => e.eventType === "dispute_evidence_submitted");

    const disputeReason = disputeOpened?.reason || "No explicit dispute reason provided.";
    
    // Extract proof details
    const deliveryNotes: string[] = [];
    const imageUrls: string[] = [];

    for (const proof of deliveryProofs) {
      if (proof.reason) {
        deliveryNotes.push(proof.reason);
      }
      try {
        if (proof.metadata) {
          const meta = typeof proof.metadata === "string" ? JSON.parse(proof.metadata) : proof.metadata;
          if (meta.media && Array.isArray(meta.media)) {
            for (const media of meta.media) {
              if (media.url && typeof media.url === "string") {
                imageUrls.push(media.url);
              }
            }
          }
        }
      } catch (err: any) {
        warn("Failed to parse delivery proof metadata in dispute analyst", { escrowId, error: err.message });
      }
    }

    const evidenceNotes: string[] = [];
    for (const evidence of disputeEvidences) {
      if (evidence.reason) {
        evidenceNotes.push(evidence.reason);
      }
      try {
        if (evidence.metadata) {
          const meta = typeof evidence.metadata === "string" ? JSON.parse(evidence.metadata) : evidence.metadata;
          if (meta.media && Array.isArray(meta.media)) {
            for (const media of meta.media) {
              if (media.url && typeof media.url === "string") {
                imageUrls.push(media.url);
              }
            }
          }
        }
      } catch (err: any) {
        warn("Failed to parse evidence metadata in dispute analyst", { escrowId, error: err.message });
      }
    }

    // Build prompt for AI agent
    const prompt = `
You are Sivan Technologies' AI dispute arbitrator. Your job is to analyze the evidence and provide a structured settlement recommendation to the platform admin.

Agreement Context:
- Reference: ${escrow.escrowId}
- Purpose: ${escrow.purpose}
- Amount: ${escrow.currency} ${escrow.amount}
- Fee Payer: ${escrow.feePayer}

Dispute Context:
- Reason for dispute: "${disputeReason}"
- Dispute evidence submitted:
${evidenceNotes.map((n) => `  * "${n}"`).join("\n") || "  * (No custom text evidence submitted)"}

Freelaner Delivery Details:
- Freelancer delivery description:
${deliveryNotes.map((n) => `  * "${n}"`).join("\n") || "  * (No custom delivery explanation notes)"}

Analysis Guidelines:
1. Examine if the freelancer's work aligns with the original purpose: "${escrow.purpose}".
2. Assess the buyer's dispute reasons against the delivery notes and proof.
3. Recommend how the funds should be split (out of 100%) between the freelancer (seller) and the client (buyer).
4. Provide a clear justification.

Format your response strictly as a JSON block with the following fields:
{
  "recommendedPayoutSellerPercent": <number 0 to 100>,
  "recommendedRefundBuyerPercent": <number 0 to 100>,
  "confidenceScore": <number 0 to 100>,
  "reasons": [<string array of key reasons>],
  "justificationSummary": "<string detailed explanation of your recommendation>"
}
Ensure the sum of recommendedPayoutSellerPercent and recommendedRefundBuyerPercent is exactly 100.
Do not output any markdown text or wrapper quotes around the JSON object. Output raw JSON only.
`;

    let aiResult: any;

    try {
      // If we have an image proof, run multimodal analysis
      const imageToAnalyze = imageUrls.find((url) => {
        const lower = url.toLowerCase();
        return lower.startsWith("http") && (
          lower.includes(".jpg") || 
          lower.includes(".jpeg") || 
          lower.includes(".png") || 
          lower.includes(".webp") ||
          lower.includes("sivan-mock-presigned") // support test URLs
        );
      });

      if (imageToAnalyze) {
        info("Dispute contains image proofs; calling multimodal analysis", { imageToAnalyze });
        const resultObj = await this.aceData.analyzeImagePrompt(imageToAnalyze, prompt);
        aiResult = resultObj.output;
      } else {
        info("Dispute is text-only; calling text analysis");
        const resultObj = await this.aceData.analyzeTextPrompt(prompt);
        aiResult = resultObj.output;
      }
    } catch (err: any) {
      error("Ace Data Cloud prompt call failed", { escrowId, error: err.message });
      throw new Error(`AI analysis failed: ${err.message || String(err)}`);
    }

    // Parse structured JSON recommendation from the model response
    let parsedRecommendation: DisputeRecommendation;
    try {
      let content = "";
      if (aiResult?.choices && aiResult.choices[0]?.message?.content) {
        content = aiResult.choices[0].message.content.trim();
      } else if (typeof aiResult === "string") {
        content = aiResult.trim();
      } else if (aiResult?.output) {
        content = typeof aiResult.output === "string" ? aiResult.output.trim() : JSON.stringify(aiResult.output);
      } else {
        content = JSON.stringify(aiResult);
      }

      // Strip markdown code fences if present (e.g. ```json ... ```)
      content = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

      parsedRecommendation = JSON.parse(content);
      
      // Basic validation
      if (typeof parsedRecommendation.recommendedPayoutSellerPercent !== "number" ||
          typeof parsedRecommendation.recommendedRefundBuyerPercent !== "number" ||
          typeof parsedRecommendation.confidenceScore !== "number") {
        throw new Error("Invalid field types in AI recommendation response");
      }

      // Check sum constraint
      const total = parsedRecommendation.recommendedPayoutSellerPercent + parsedRecommendation.recommendedRefundBuyerPercent;
      if (total !== 100) {
        warn(`Payout splits do not sum to 100 (got ${total}), adjusting proportional balance`, { escrowId });
        const sellerShare = Math.round((parsedRecommendation.recommendedPayoutSellerPercent / total) * 100);
        parsedRecommendation.recommendedPayoutSellerPercent = sellerShare;
        parsedRecommendation.recommendedRefundBuyerPercent = 100 - sellerShare;
      }
    } catch (err: any) {
      warn("Failed to parse structured recommendation from AI output, applying default fallback recommendation", { 
        escrowId, 
        aiResult,
        error: err.message 
      });

      // Default safe fallback recommendation if parsing fails
      parsedRecommendation = {
        recommendedPayoutSellerPercent: 50,
        recommendedRefundBuyerPercent: 50,
        confidenceScore: 30,
        reasons: ["Failed to parse detailed AI model output response format"],
        justificationSummary: `Dispute requires manual arbitration. Raw AI output preview: ${JSON.stringify(aiResult).slice(0, 200)}`
      };
    }

    // Cache the recommendation directly in the database
    await this.escrowStore.saveAiDisputeRecommendation(escrowId, JSON.stringify(parsedRecommendation));
    info("Dispute AI recommendation successfully generated and cached", { escrowId, parsedRecommendation });

    return parsedRecommendation;
  }
}
