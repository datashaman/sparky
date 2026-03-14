import type { LogCallback } from "./index.js";

/**
 * Retryable fetch with exponential backoff for transient API failures.
 *
 * Retries on:
 * - Network errors (fetch throws)
 * - 429 (rate limit) — respects Retry-After header
 * - 500, 502, 503, 529 (server errors)
 *
 * Does NOT retry on:
 * - 400, 401, 403, 404 (client errors — retrying won't help)
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: {
    maxRetries?: number;
    baseDelayMs?: number;
    onLog?: LogCallback;
    label?: string;
  },
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const label = opts?.label ?? "API";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.ok || !isRetryable(res.status)) {
        return res;
      }

      // Rate limit — respect Retry-After header if present
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const delayMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 60_000)
          : backoffDelay(attempt, baseDelayMs);

        if (attempt < maxRetries) {
          opts?.onLog?.({
            type: "info",
            message: `${label} rate limited (429), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`,
          });
          await sleep(delayMs);
          continue;
        }
      }

      // Server error — retry with backoff
      if (attempt < maxRetries) {
        const delayMs = backoffDelay(attempt, baseDelayMs);
        opts?.onLog?.({
          type: "info",
          message: `${label} error ${res.status}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`,
        });
        await sleep(delayMs);
        continue;
      }

      return res;
    } catch (err) {
      // Network error (DNS, connection refused, timeout, etc.)
      if (attempt < maxRetries) {
        const delayMs = backoffDelay(attempt, baseDelayMs);
        opts?.onLog?.({
          type: "info",
          message: `${label} network error, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries}): ${err instanceof Error ? err.message : String(err)}`,
        });
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw new Error(`${label}: exhausted ${maxRetries} retries`);
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);

function isRetryable(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function backoffDelay(attempt: number, baseMs: number): number {
  // Exponential backoff with jitter: base * 2^attempt * (0.5 + random*0.5)
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(exponential * jitter, 30_000); // cap at 30s
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
