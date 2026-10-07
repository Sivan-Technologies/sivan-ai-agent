/**
 * Shared, dependency-free helpers used across the escrow service modules.
 *
 * Extracted verbatim from escrowService.ts as step 1 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */

export function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function firstPresent(...values: any[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}
