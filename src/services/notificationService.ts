import { config } from "../config";
import { WorkflowTaskRecord } from "./workflowStore";

export async function notifyWhatsAppBot(to: string, message: string) {
  const notifyUrl = config.app.notificationUrl;
  const secret = config.app.notificationSecret;

  if (!notifyUrl) {
    return;
  }

  try {
    const response = await fetch(`${notifyUrl}/api/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-notify-secret": secret } : {}),
      },
      body: JSON.stringify({ to, message }),
    });

    if (!response.ok) {
      const payload = await response.text();
      console.error("WhatsApp notify failed", response.status, payload);
    }
  } catch (error) {
    console.error("Failed to notify WhatsApp bot", error);
  }
}

function tryParseResult(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function formatTaskSummary(task: WorkflowTaskRecord): string {
  const lines: string[] = [];
  lines.push(`✅ Task update: ${task.taskId}`);
  if (task.taskType) {
    lines.push(`Task type: ${task.taskType}`);
  }
  if (task.paymentMethod) {
    lines.push(`Payment method: ${task.paymentMethod}`);
  }
  lines.push(`Status: ${task.paymentStatus}`);
  lines.push(`Amount: ${task.amount} ${task.userPaymentPreference}`);
  if (task.paymentReference) {
    lines.push(`Payment reference: ${task.paymentReference}`);
  }
  if (task.instructions) {
    lines.push(`Instructions: ${task.instructions}`);
  }

  if (task.executionResults) {
    let results: any;
    try {
      results = JSON.parse(task.executionResults);
    } catch {
      results = task.executionResults;
    }

    const formatExecutionItem = (item: any, index: number) => {
      let summary = "";
      if (typeof item === "string") {
        const parsed = tryParseResult(item);
        item = parsed;
      }

      if (item && typeof item === "object") {
        if (item.summary) {
          summary = item.summary;
        } else if (item.result) {
          summary = typeof item.result === "string" ? item.result : JSON.stringify(item.result);
        } else if (item.text) {
          summary = item.text;
        } else if (item.service && item.output) {
          summary = `${item.service}: ${typeof item.output === "string" ? item.output : JSON.stringify(item.output)}`;
        } else {
          summary = JSON.stringify(item);
        }
      } else {
        summary = String(item);
      }

      lines.push(`${index + 1}. ${summary}`);
    };

    lines.push(`\nAI Results:`);
    if (Array.isArray(results)) {
      results.slice(0, 3).forEach((result, index) => {
        formatExecutionItem(result, index);
      });
    } else if (typeof results === "object") {
      lines.push(JSON.stringify(results));
    } else {
      lines.push(String(results));
    }
  }

  if (task.note) {
    lines.push(`Note: ${task.note}`);
  }
  return lines.join("\n");
}
