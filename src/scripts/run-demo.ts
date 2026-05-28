import dotenv from "dotenv";
import { validateConfig, config } from "../config";
import { SapAgent } from "../services/sapAgent";
import { AceDataClient } from "../services/aceData";
import { PaymentRouter } from "../services/paymentRouter";
import { AgentOrchestrator, TaskRequest } from "../services/agentOrchestrator";
import { WorkflowStore } from "../services/workflowStore";

dotenv.config();

async function runDemo() {
  validateConfig();

  const sapAgent = new SapAgent(config.sap.rpcUrl, config.synapse.apiKey);
  const aceData = new AceDataClient(config.aceData.baseUrl, config.aceData.apiKey);
  const paymentRouter = new PaymentRouter(sapAgent);
  const workflowStore = new WorkflowStore(config.app.databaseUrl, config.app.databaseProvider);
  const orchestrator = new AgentOrchestrator(sapAgent, aceData, paymentRouter, workflowStore);

  const request: TaskRequest = {
    taskType: process.env.AGENT_TASK_TYPE || "content-creation",
    userPaymentPreference: (process.env.USER_PAYMENT_PREFERENCE as "NAIRA" | "USDC") || "NAIRA",
    userEmail: process.env.USER_EMAIL || "buyer@example.com",
    amount: Number(process.env.PAYMENT_AMOUNT || "50"),
    instructions: process.env.TASK_INSTRUCTIONS || "Write a product description for a trustless escrow service.",
    usdcChannel: (process.env.USDC_CHANNEL as "x402" | "sap") || "x402",
  };

  console.log("=== Sivan Escrow Agent Demo ===");
  console.log("Request:", request);

  const result = await orchestrator.runTask(request);

  console.log("=== Demo Completed ===");
  console.log({
    taskId: result.taskId,
    agentKey: result.agentKey,
    tools: result.tools.map((tool) => tool.name),
    paymentResult: result.paymentResult,
  });
}

runDemo().catch((error) => {
  console.error("[DEMO ERROR]", error.message || error);
  process.exit(1);
});
