import { describe, it, expect } from "vitest";
import { formatTaskSummary } from "../src/services/notificationService";

describe("formatTaskSummary", () => {
  it("renders a compact summary for a task with AI results", () => {
    const task: any = {
      taskId: "task-123",
      taskType: "content-creation",
      paymentMethod: "USDC",
      paymentStatus: "settled",
      amount: 100,
      userPaymentPreference: "USDC",
      paymentReference: "escrow-abc",
      instructions: "Write a short article",
      executionResults: JSON.stringify([
        { service: "ace-text", summary: "Generated intro paragraph." },
        { service: "ace-summary", summary: "3 bullet points." },
      ]),
    };

    const txt = formatTaskSummary(task);
    expect(txt).toContain("task-123");
    expect(txt).toContain("Payment method: USDC");
    expect(txt).toContain("AI Results:");
    expect(txt).toContain("Generated intro paragraph.");
  });
});
