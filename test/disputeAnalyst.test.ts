import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { DisputeAnalystService } from "../src/services/disputeAnalyst";
import { AceDataClient } from "../src/services/aceData";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-dispute-analyst.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

// Dynamically import context stores
const { escrowStore } = await import("../src/context");

describe("AI dispute arbitration analyst tests", () => {
  beforeAll(async () => {
    await escrowStore.initializeSchema();
  }, 30000);

  afterAll(async () => {
    await escrowStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {}
    }
  });

  it("gathers dispute evidence, queries Ace Data, and caches recommendation correctly", async () => {
    // 1. Create mock users first to pass participant verification checks
    const buyerUser = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000001", "buyer");
    const sellerUser = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000002", "seller");

    const buyerUserId = buyerUser.userId;
    const sellerUserId = sellerUser.userId;

    const escrow = await escrowStore.createEscrow({
      buyerWhatsapp: "whatsapp:+2348000000001",
      sellerWhatsapp: "whatsapp:+2348000000002",
      amount: 1500,
      currency: "USDC",
      purpose: "E2E AI dispute design contract test",
      createdByChannel: "api",
      buyerUserId,
      sellerUserId,
    });
    
    // Transition to disputed status
    await escrowStore.markDisputed(escrow.escrowId, "whatsapp:+2348000000001", "whatsapp_dm", "The work delivered does not match original branding guidelines.");

    // Submit some delivery proof
    await escrowStore.addEvent({
      escrowId: escrow.escrowId,
      actor: sellerUserId,
      actorRole: "seller",
      channel: "whatsapp_dm",
      eventType: "seller_delivery_proof_recorded",
      reason: "Here is the Figma layout design.",
      metadata: JSON.stringify({
        media: [{ url: "https://example.com/figma-design.png", filename: "figma-design.png", originalUrl: "https://example.com/figma-design.png" }]
      })
    });

    // Mock AceDataClient response
    const mockOutput = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              recommendedPayoutSellerPercent: 70,
              recommendedRefundBuyerPercent: 30,
              confidenceScore: 85,
              reasons: ["Seller delivered draft design.", "Buyer claims color branding issue."],
              justificationSummary: "The seller completed the core work, but missed the branding specs. Hence we split 70% to seller and 30% to buyer."
            })
          }
        }
      ]
    };

    let calledMultimodal = false;
    let calledText = false;

    const mockAceDataClient = {
      analyzeImagePrompt: async (imageUrl: string, prompt: string) => {
        calledMultimodal = true;
        return { service: "multimodal-analysis", output: mockOutput };
      },
      analyzeTextPrompt: async (prompt: string) => {
        calledText = true;
        return { service: "text-analysis", output: mockOutput };
      }
    } as any as AceDataClient;

    const analyst = new DisputeAnalystService(escrowStore, mockAceDataClient);

    // Call dynamic AI analysis
    const recommendation = await analyst.analyzeDispute(escrow.escrowId);

    expect(calledMultimodal).toBe(true);
    expect(calledText).toBe(false);
    expect(recommendation.recommendedPayoutSellerPercent).toBe(70);
    expect(recommendation.recommendedRefundBuyerPercent).toBe(30);
    expect(recommendation.confidenceScore).toBe(85);

    // Check that caching worked
    const updated = await escrowStore.getEscrowById(escrow.escrowId);
    expect(updated?.aiDisputeRecommendation).toBeDefined();
    const cached = JSON.parse(updated!.aiDisputeRecommendation!);
    expect(cached.recommendedPayoutSellerPercent).toBe(70);

    // Try analyzing again - should hit the cache (which does not call mockAceDataClient!)
    calledMultimodal = false;
    const cacheResult = await analyst.analyzeDispute(escrow.escrowId);
    expect(calledMultimodal).toBe(false);
    expect(cacheResult.recommendedPayoutSellerPercent).toBe(70);
  }, 30000);
});
