import { SapAgent } from "./sapAgent";
import { AceDataClient } from "./aceData";
import { PaymentRouter, PaymentResult } from "./paymentRouter";
import { WorkflowStore } from "./workflowStore";
import crypto from "crypto";
import { log } from "../lib/logger";
import { notifyWhatsAppBot, formatTaskSummary } from "./notificationService";

export interface TaskRequest {
  taskType: string;
  userPaymentPreference: "NAIRA" | "USDC";
  userEmail: string;
  amount: number;
  instructions: string;
  usdcChannel?: "x402" | "sap";
}

export class AgentOrchestrator {
  constructor(
    private sapAgent: SapAgent,
    private aceDataClient: AceDataClient,
    private paymentRouter: PaymentRouter,
    private workflowStore: WorkflowStore
  ) {}

  private async executeAiWork(taskId: string, request: TaskRequest, existingAgentKey?: string) {
    const agentKey = existingAgentKey || await this.sapAgent.registerAgent();
    await this.workflowStore.updateTaskAgent(taskId, agentKey);
    log("Agent registered", { taskId, agentKey });

    const tools = await this.sapAgent.discoverTools(request.taskType);
    log("Tools discovered", tools.map((tool) => tool.name));

    const executionResults = [];
    executionResults.push(await this.aceDataClient.textGeneration(request.instructions));
    executionResults.push(await this.aceDataClient.documentSummarization(request.instructions));
    executionResults.push(await this.aceDataClient.dataExtraction(request.instructions));

    log("AI tasks completed", executionResults.map((result) => result.service));

    await this.workflowStore.updateTaskExecution(
      taskId,
      tools.map((tool) => tool.name),
      executionResults.map((result) => JSON.stringify(result))
    );

    return { agentKey, tools, executionResults };
  }

  public async runTask(request: TaskRequest) {
    log("Starting task workflow", request);

    const taskId = crypto.randomUUID();
    const paymentMethod = this.paymentRouter.determinePaymentMethod(request.userPaymentPreference);
    let paymentResult: PaymentResult;

    await this.workflowStore.createTask({
      taskId,
      taskType: request.taskType,
      userPaymentPreference: request.userPaymentPreference,
      userEmail: request.userEmail,
      amount: request.amount,
      instructions: request.instructions,
      paymentMethod,
      paymentStatus: "created",
    });

    if (paymentMethod === "NAIRA") {
      paymentResult = await this.paymentRouter.processNairaPayment(request.amount, request.userEmail);
      await this.workflowStore.updateTaskPayment(taskId, paymentResult.reference, null, "payment_pending");
      await this.workflowStore.updateTaskStatus(taskId, "payment_pending", "Waiting for Paystack webhook confirmation.");
      const task = await this.workflowStore.getTaskById(taskId);
      if (task) {
        const paymentLink = paymentResult.authorizationUrl || paymentResult.reference;
        await notifyWhatsAppBot(
          request.userEmail,
          `✅ Your task ${taskId} is created and awaiting Paystack confirmation.\nPlease pay here: ${paymentLink}`
        );
      }

      return {
        taskId,
        agentKey: null,
        tools: [],
        executionResults: [],
        paymentResult,
      };
    } else {
      const agentKey = await this.sapAgent.registerAgent();
      await this.workflowStore.updateTaskAgent(taskId, agentKey);
      log("Agent registered", { taskId, agentKey });

      if (request.usdcChannel === "sap") {
        paymentResult = await this.paymentRouter.processUsdcSapEscrow(request.amount, agentKey);
      } else {
        paymentResult = await this.paymentRouter.processUsdcEscrow(request.amount, agentKey);
      }
      await this.workflowStore.updateTaskPayment(taskId, paymentResult.reference, paymentResult.paymentId || null, paymentResult.status);
      await this.workflowStore.updateTaskStatus(taskId, paymentResult.status, "USDC payment facility created.");
    }

    log("Payment initialized", paymentResult);

    const task = await this.workflowStore.getTaskById(taskId);
    if (!task?.agentKey) {
      throw new Error("Missing agent key for USDC workflow");
    }
    const { agentKey, tools, executionResults } = await this.executeAiWork(taskId, {
      ...request,
      userPaymentPreference: "USDC",
    }, task.agentKey);

    if (paymentResult.method === "USDC") {
      if (!paymentResult.paymentId) {
        throw new Error("Missing x402 paymentId for USDC settlement");
      }

      if (request.usdcChannel === "sap") {
        const escrowReleased = await this.sapAgent.releaseEscrow(paymentResult.reference);
        await this.workflowStore.updateTaskStatus(taskId, escrowReleased ? "settled" : "release_failed", "SAP on-chain escrow release attempted.");
        paymentResult = {
          method: "USDC",
          status: escrowReleased ? "settled" : "release_failed",
          reference: paymentResult.reference,
          paymentId: paymentResult.paymentId,
          details: { escrowReleased },
        };
        log("SAP escrow released", { escrowReleased, escrowId: paymentResult.reference });
        const task = await this.workflowStore.getTaskById(taskId);
        if (task) {
          await notifyWhatsAppBot(request.userEmail, formatTaskSummary(task));
        }
      } else {
        const settlement = await this.paymentRouter.settleUsdcPayment(paymentResult.paymentId);
        await this.workflowStore.updateTaskPayment(taskId, settlement.reference, settlement.paymentId || null, settlement.status);
        await this.workflowStore.updateTaskStatus(taskId, settlement.status, "USDC payment settled.");
        paymentResult = settlement;
        log("USDC payment settled", settlement);
        const task = await this.workflowStore.getTaskById(taskId);
        if (task) {
          await notifyWhatsAppBot(request.userEmail, formatTaskSummary(task));
        }
      }
    }

    return {
      taskId,
      agentKey,
      tools,
      executionResults,
      paymentResult,
    };
  }

  public async executeConfirmedNairaTask(taskId: string) {
    const claim = await this.workflowStore.claimNairaExecution(taskId);
    if (!claim.claimed) {
      log("Skipping Naira execution request", { taskId, reason: claim.reason, status: claim.task?.paymentStatus });
      return {
        taskId,
        skipped: true,
        status: claim.task?.paymentStatus || "unknown",
        reason: claim.reason,
      };
    }

    const task = claim.task;

    try {
      const request: TaskRequest = {
        taskType: task.taskType,
        userPaymentPreference: "NAIRA",
        userEmail: task.userEmail,
        amount: task.amount,
        instructions: task.instructions,
      };

      const result = await this.executeAiWork(taskId, request);
      await this.workflowStore.updateTaskStatus(taskId, "completed", "Naira payment confirmed and AI work completed.");

      const updatedTask = await this.workflowStore.getTaskById(taskId);
      if (updatedTask) {
        await notifyWhatsAppBot(updatedTask.userEmail, formatTaskSummary(updatedTask));
      }

      return {
        taskId,
        skipped: false,
        ...result,
      };
    } catch (err: any) {
      await this.workflowStore.updateTaskStatus(taskId, "failed", err.message || "Naira task execution failed.");
      throw err;
    }
  }
}
