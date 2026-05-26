import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { WorkflowStore } from "../src/services/workflowStore";

const TEST_DB_PATH = "./data/test-workflow-store.db";

describe("WorkflowStore", () => {
  let store: WorkflowStore;

  beforeEach(() => {
    const folder = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new WorkflowStore(TEST_DB_PATH);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // better-sqlite3 keeps handles open for the store lifetime in this test process.
      }
    }
  });

  it("claims a confirmed Naira task once", () => {
    store.createTask({
      taskId: "task-1",
      taskType: "content-creation",
      userPaymentPreference: "NAIRA",
      userEmail: "whatsapp:+15550000000",
      amount: 5000,
      instructions: "Write a product description",
      paymentMethod: "NAIRA",
      paymentStatus: "payment_confirmed",
      paymentReference: "paystack-ref-1",
    });

    const first = store.claimNairaExecution("task-1");
    expect(first.claimed).toBe(true);
    expect(first.task.paymentStatus).toBe("executing");

    const second = store.claimNairaExecution("task-1");
    expect(second.claimed).toBe(false);
    expect(second.reason).toBe("status_executing");
  });
});
