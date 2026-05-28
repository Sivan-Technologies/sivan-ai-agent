import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { log, warn, error } from "../lib/logger";

export interface ToolMetadata {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
}

export interface RegisterAgentResponse {
  success: boolean;
  agentPublicKey: string;
  transactionSignature?: string;
}

export interface DiscoverToolsResponse {
  success: boolean;
  tools: ToolMetadata[];
  timestamp: string;
}

export interface EscrowTransaction {
  escrowId: string;
  payer: string;
  recipient: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

export class SapAgent {
  private rpcClient: AxiosInstance;
  private maxRetries: number = 3;
  private retryDelayMs: number = 1000;

  constructor(private rpcUrl: string, private apiKey: string) {
    this.rpcClient = axios.create({
      baseURL: rpcUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  private async callSynapseSapMethod<T>(
    method: string,
    params: Record<string, any>,
    attempt: number = 1
  ): Promise<T> {
    try {
      log(`[SAP RPC] Calling ${method}`, { params, attempt });
      const response = await this.rpcClient.post("/", {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      });

      if (response.data.error) {
        throw new Error(`SAP RPC error: ${response.data.error.message}`);
      }

      return response.data.result as T;
    } catch (err: any) {
      if (attempt < this.maxRetries) {
        warn(`[SAP RPC] Retry attempt ${attempt}/${this.maxRetries}`, {
          method,
          error: err.message,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelayMs * attempt)
        );
        return this.callSynapseSapMethod(method, params, attempt + 1);
      }
      error(`[SAP RPC] Failed after ${this.maxRetries} attempts`, { method, error: err.message });
      throw err;
    }
  }

  public async registerAgent(): Promise<string> {
    log("Registering agent on Synapse SAP mainnet...");
    if (!config.sap.agentPrivateKey || !config.sap.agentPublicKey) {
      warn("SAP agent keys not configured, using public key placeholder");
      return config.sap.agentPublicKey;
    }

    const response = await this.callSynapseSapMethod<RegisterAgentResponse>(
      "registerSapAgent",
      {
        publicKey: config.sap.agentPublicKey,
        privateKey: config.sap.agentPrivateKey,
        commitment: "finalized",
      }
    );

    log("Agent registered successfully", { agentPublicKey: response.agentPublicKey });
    return response.agentPublicKey;
  }

  public async discoverTools(taskType: string): Promise<ToolMetadata[]> {
    log(`Discovering tools for task type: ${taskType}`);

    const response = await this.callSynapseSapMethod<DiscoverToolsResponse>(
      "discoverToolsForTask",
      {
        taskType,
        limit: 10,
        filters: ["ai-service", "data-processing"],
      }
    );

    if (response.success && Array.isArray(response.tools) && response.tools.length > 0) {
      log("Tools discovered", { count: response.tools.length });
      return response.tools;
    }

    warn("No tools found from SAP, using fallback");
    return [
      {
        id: "ace-data-ai",
        name: "Ace Data Cloud AI Services",
        description: "Bundled AI services from Ace Data Cloud",
        capabilities: ["text-generation", "document-summarization", "data-extraction"],
      },
    ];
  }

  public async verifyConnectivity(taskType = "content-creation", options: { registerAgent?: boolean } = {}) {
    const startedAt = Date.now();
    const tools = await this.discoverTools(taskType);
    let registration: { attempted: boolean; agentPublicKey?: string } = { attempted: false };

    if (options.registerAgent) {
      const agentPublicKey = await this.registerAgent();
      registration = { attempted: true, agentPublicKey };
    }

    return {
      status: "ok" as const,
      rpcUrl: this.rpcUrl,
      taskType,
      toolsDiscovered: tools.length,
      toolIds: tools.map((tool) => tool.id),
      registration,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  public async createEscrow(
    amount: number,
    currency: string,
    recipient: string,
    metadata?: Record<string, any>
  ): Promise<EscrowTransaction> {
    log(`Creating escrow for ${currency} ${amount} to ${recipient}`);

    const escrowData = await this.callSynapseSapMethod<EscrowTransaction>(
      "createEscrow",
      {
        amount,
        currency,
        recipient,
        metadata: {
          ...metadata,
          agentInitiated: true,
          timestamp: new Date().toISOString(),
        },
      }
    );

    log("Escrow created successfully", { escrowId: escrowData.escrowId });
    return escrowData;
  }

  public async releaseEscrow(escrowId: string): Promise<boolean> {
    log(`Releasing escrow ${escrowId}`);

    const result = await this.callSynapseSapMethod<{ success: boolean; txSignature: string }>(
      "releaseEscrow",
      { escrowId }
    );

    log("Escrow released", { escrowId, txSignature: result.txSignature });
    return result.success;
  }

  public async getEscrowStatus(escrowId: string): Promise<EscrowTransaction> {
    log(`Fetching escrow status: ${escrowId}`);

    const status = await this.callSynapseSapMethod<EscrowTransaction>(
      "getEscrowStatus",
      { escrowId }
    );

    return status;
  }
}
