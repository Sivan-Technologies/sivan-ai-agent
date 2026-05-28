import { config } from "../config";

export function log(message: string, ...args: any[]) {
  if (config.app.env !== "production" || config.app.logLevel === "debug") {
    console.log(`[LOG] ${message}`, ...args);
  }
}

export function info(message: string, ...args: any[]) {
  console.info(`[INFO] ${message}`, ...args);
}

export function warn(message: string, ...args: any[]) {
  console.warn(`[WARN] ${message}`, ...args);
}

export function error(message: string, ...args: any[]) {
  console.error(`[ERROR] ${message}`, ...args);
}
