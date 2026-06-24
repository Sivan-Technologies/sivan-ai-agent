import axios from "axios";
import { config } from "../config";

export interface AceDataResult {
  service: string;
  output: any;
}

export class AceDataClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async callService(endpoint: string, payload: Record<string, any>): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await axios.post(url, payload, {
      headers: this.getHeaders(),
      timeout: 30000,
    });

    if (!response.data || response.status !== 200) {
      throw new Error(`Ace Data Cloud service error: ${response.status} ${response.statusText}`);
    }
    return response.data;
  }

  public async textGeneration(prompt: string): Promise<AceDataResult> {
    console.log("[AceData] Running text generation");
    const data = await this.callService("/v1/text/generate", { prompt, maxTokens: 256 });
    return { service: "text-generation", output: data };
  }

  public async documentSummarization(document: string): Promise<AceDataResult> {
    console.log("[AceData] Running document summarization");
    const data = await this.callService("/v1/document/summarize", { document });
    return { service: "document-summarization", output: data };
  }

  public async dataExtraction(text: string): Promise<AceDataResult> {
    console.log("[AceData] Running data extraction");
    const data = await this.callService("/v1/data/extract", { text });
    return { service: "data-extraction", output: data };
  }
}
