/**
 * Resolves r2:// media references on escrow event metadata into presigned
 * download URLs.
 *
 * Extracted verbatim from escrowService.ts as step 3 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1 §1.4). No logic changes.
 *
 * This module is also the single source of truth for disputeAnalyst.ts, which
 * previously carried a byte-for-byte duplicate named localResolveR2MediaUrls.
 */

import { getPresignedDownloadUrl } from "./storageService";

export async function resolveR2MediaUrls(events: any[]): Promise<any[]> {
  const resolved = [];
  for (const event of events) {
    if (event.metadata && typeof event.metadata === "string" && event.metadata.includes("r2://")) {
      try {
        const meta = JSON.parse(event.metadata);
        if (meta.media && Array.isArray(meta.media)) {
          meta.media = await Promise.all(
            meta.media.map(async (m: any) => {
              if (m.url && m.url.startsWith("r2://")) {
                const key = m.url.substring(5);
                try {
                  const presignedUrl = await getPresignedDownloadUrl(key);
                  if (presignedUrl.includes("sivan-mock-presigned-url.test") && m.originalUrl) {
                    return { ...m, url: m.originalUrl };
                  }
                  return { ...m, url: presignedUrl };
                } catch (err) {
                  return m;
                }
              }
              return m;
            })
          );
          resolved.push({
            ...event,
            metadata: JSON.stringify(meta),
          });
          continue;
        }
      } catch {
        // fail-safe fallback
      }
    }
    resolved.push(event);
  }
  return resolved;
}
