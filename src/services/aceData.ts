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

  public async analyzeImagePrompt(imageUrl: string, prompt: string): Promise<AceDataResult> {
    console.log("[AceData] Running multimodal image analysis");
    const data = await this.callService("/v1/chat/completions", {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 1000
    });
    return { service: "multimodal-analysis", output: data };
  }

  public async analyzeTextPrompt(prompt: string): Promise<AceDataResult> {
    console.log("[AceData] Running custom text-only analysis");
    const data = await this.callService("/v1/chat/completions", {
      model: "gpt-4o",
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: 1000
    });
    return { service: "text-analysis", output: data };
  }
}
