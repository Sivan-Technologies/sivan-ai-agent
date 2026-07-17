import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";

export const requestStorage = new AsyncLocalStorage<string>();

interface LogEntry {
  _time: string;
  requestId?: string;
  message: string;
  level: "info" | "warn" | "error";
  service: string;
  [key: string]: any;
}

const logBuffer: LogEntry[] = [];
let flushTimeout: NodeJS.Timeout | null = null;

function flushLogs() {
  if (logBuffer.length === 0) return;
  
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;
  
  if (!token || !dataset) {
    logBuffer.length = 0; // Clear buffer if not configured
    return;
  }
  
  const entriesToSend = [...logBuffer];
  logBuffer.length = 0; // Clear buffer
  
  fetch(`https://api.axiom.co/v1/datasets/${dataset}/ingest`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(entriesToSend)
  }).catch((err) => {
    console.error("[logger] Failed to flush logs to Axiom:", err);
  });
}

function queueLog(entry: LogEntry) {
  logBuffer.push(entry);
  if (!flushTimeout) {
    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      flushLogs();
    }, 1000); // Flush logs every 1 second
  }
}

export const logger = {
  info(message: string, requestId?: string, metadata?: Record<string, any>) {
    const activeTraceId = requestId || requestStorage.getStore();
    console.log(`[INFO] ${activeTraceId ? `[${activeTraceId}] ` : ""}${message}`, metadata ? JSON.stringify(metadata) : "");
    queueLog({
      _time: new Date().toISOString(),
      requestId: activeTraceId,
      message,
      level: "info",
      service: "escrow-agent",
      ...metadata
    });
  },
  
  warn(message: string, requestId?: string, metadata?: Record<string, any>) {
    const activeTraceId = requestId || requestStorage.getStore();
    console.warn(`[WARN] ${activeTraceId ? `[${activeTraceId}] ` : ""}${message}`, metadata ? JSON.stringify(metadata) : "");
    queueLog({
      _time: new Date().toISOString(),
      requestId: activeTraceId,
      message,
      level: "warn",
      service: "escrow-agent",
      ...metadata
    });
  },
  
  error(message: string, requestId?: string, metadata?: Record<string, any>) {
    const activeTraceId = requestId || requestStorage.getStore();
    console.error(`[ERROR] ${activeTraceId ? `[${activeTraceId}] ` : ""}${message}`, metadata ? JSON.stringify(metadata) : "");
    queueLog({
      _time: new Date().toISOString(),
      requestId: activeTraceId,
      message,
      level: "error",
      service: "escrow-agent",
      ...metadata
    });
  }
};
