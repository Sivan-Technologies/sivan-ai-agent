import { AsyncLocalStorage } from "async_hooks";

export const requestStorage = new AsyncLocalStorage<string>();

export const logger = {
  info(message: string, requestId?: string, metadata?: Record<string, any>) {
    const activeTraceId = requestId || requestStorage.getStore();
    console.log(`[INFO] ${activeTraceId ? `[${activeTraceId}] ` : ""}${message}`, metadata ? JSON.stringify(metadata) : "");
  },
  
  warn(message: string, requestId?: string, metadata?: Record<string, any>) {
    const activeTraceId = requestId || requestStorage.getStore();
    console.warn(`[WARN] ${activeTraceId ? `[${activeTraceId}] ` : ""}${message}`, metadata ? JSON.stringify(metadata) : "");
  },
  
  error(message: string, requestId?: string, metadata?: Record<string, any>) {
    const activeTraceId = requestId || requestStorage.getStore();
    console.error(`[ERROR] ${activeTraceId ? `[${activeTraceId}] ` : ""}${message}`, metadata ? JSON.stringify(metadata) : "");
  }
};
