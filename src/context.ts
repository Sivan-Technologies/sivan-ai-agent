import { config } from "./config";
import { SapAgent } from "./services/sapAgent";
import { AceDataClient } from "./services/aceData";
import { PaymentRouter } from "./services/paymentRouter";
import { WorkflowStore } from "./services/workflowStore";
import { SettingsStore } from "./services/settingsStore";
import { EscrowStore } from "./services/escrowStore";
import { ProductionOpsStore } from "./services/productionOpsStore";
import { ReconciliationStore } from "./services/reconciliationStore";
import { AbusePreventionService } from "./services/abusePrevention";
import { AgentOrchestrator } from "./services/agentOrchestrator";
import { DisputeAnalystService } from "./services/disputeAnalyst";
import { createNairaPaymentProvider } from "./services/nairaPaymentProvider";
import { PaystackClient } from "./services/paystackClient";
import { MonnifyClient } from "./services/monnifyClient";
import { FlutterwaveClient } from "./services/flutterwaveClient";
import { PalmPayClient } from "./services/palmpayClient";

export const sapAgent = new SapAgent(config.sap.rpcUrl, config.synapse.apiKey);
export const aceData = new AceDataClient(config.aceData.baseUrl, config.aceData.apiKey);
export const paymentRouter = new PaymentRouter(sapAgent);
export const workflowStore = new WorkflowStore(config.app.databaseUrl, config.app.databaseProvider);
export const settingsStore = new SettingsStore(config.app.databaseUrl, config.app.databaseProvider);
export const escrowStore = new EscrowStore(config.app.databaseUrl, config.app.databaseProvider);
export const opsStore = new ProductionOpsStore(config.app.databaseUrl, config.app.databaseProvider);
export const reconciliationStore = new ReconciliationStore(config.app.databaseUrl, config.app.databaseProvider);
export const abusePrevention = new AbusePreventionService(escrowStore, opsStore, settingsStore);
export const disputeAnalyst = new DisputeAnalystService(escrowStore, aceData);

export const orchestrator = new AgentOrchestrator(sapAgent, aceData, paymentRouter, workflowStore);
export const paystackPaymentProvider = createNairaPaymentProvider("paystack");
export const monnifyPaymentProvider = createNairaPaymentProvider("monnify");
export const palmpayPaymentProvider = createNairaPaymentProvider("palmpay");
export const flutterwavePaymentProvider = createNairaPaymentProvider("flutterwave");
export const nombaPaymentProvider = createNairaPaymentProvider("nomba");
export const paystackClient = new PaystackClient();
export const monnifyClient = new MonnifyClient();
export const palmpayClient = new PalmPayClient();
export const flutterwaveClient = new FlutterwaveClient();

export async function initializeDatabaseSchemas() {
  try {
    await settingsStore.initializeSchema();
    await escrowStore.initializeSchema();
    await opsStore.initializeSchema();
    await reconciliationStore.initializeSchema();
  } catch (err: any) {
    console.warn('[context] Non-fatal background schema init warning:', err?.message || err);
  }
}
