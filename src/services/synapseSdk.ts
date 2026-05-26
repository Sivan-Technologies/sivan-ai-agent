import { SynapseClient } from "@oobe-protocol-labs/synapse-client-sdk";
import { config } from "../config";

let client: SynapseClient | null = null;

export function getSynapseClient() {
  if (!client) {
    client = new SynapseClient({
      endpoint: config.synapse.rpcUrl,
      apiKey: config.synapse.apiKey,
      ...(config.synapse.wsUrl ? { wsEndpoint: config.synapse.wsUrl } : {}),
      ...(config.synapse.grpcUrl ? { grpcEndpoint: config.synapse.grpcUrl } : {}),
    });
  }

  return client;
}

export function destroySynapseClient() {
  client?.destroy();
  client = null;
}
