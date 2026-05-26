import { validateConfig, config } from "./config";
import { SapAgent } from "./services/sapAgent";
import { AceDataClient } from "./services/aceData";
import { PaymentRouter } from "./services/paymentRouter";
import { AgentOrchestrator, TaskRequest } from "./services/agentOrchestrator";
import { WorkflowStore } from "./services/workflowStore";

async function runAgentWorkflow() {
  validateConfig();

  const sapAgent = new SapAgent(config.sap.rpcUrl, config.synapse.apiKey);
  const aceData = new AceDataClient(config.aceData.baseUrl, config.aceData.apiKey);
  const paymentRouter = new PaymentRouter(sapAgent);
  const workflowStore = new WorkflowStore(config.app.databaseUrl);
  const orchestrator = new AgentOrchestrator(sapAgent, aceData, paymentRouter, workflowStore);

  console.log("=== Sivan Escrow Agent Started ===");

  const request: TaskRequest = {
    taskType: process.env.AGENT_TASK_TYPE || "content-creation",
    userPaymentPreference: (process.env.USER_PAYMENT_PREFERENCE as "NAIRA" | "USDC") || "NAIRA",
    userEmail: process.env.USER_EMAIL || "buyer@example.com",
    amount: Number(process.env.PAYMENT_AMOUNT || "50"),
    instructions: process.env.TASK_INSTRUCTIONS || "Write a product description for a trustless escrow service.",
  };

  const result = await orchestrator.runTask(request);
  console.log("=== Sivan Escrow Agent Completed ===");
  console.log("Result summary:", {
    agentKey: result.agentKey,
    tools: result.tools.map((tool) => tool.name),
    payment: result.paymentResult,
  });

  console.log("=== Sivan Escrow Agent Completed ===");
}

runAgentWorkflow().catch((error) => {
  console.error("[ERROR]", error.message || error);
  process.exit(1);
});
