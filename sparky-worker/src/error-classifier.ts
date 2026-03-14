/**
 * Error classification for pipeline failures.
 *
 * Based on Operator's empirical taxonomy from 15,000+ tasks:
 * - API errors (rate limits, server errors) → retry or wait
 * - Auth errors (bad key, expired token) → reconfigure
 * - Config errors (missing provider/model/key) → configure settings
 * - Context errors (too long, invalid schema) → compress or reduce scope
 * - Tool errors (sandbox violations, file not found) → fix tool input
 * - Infrastructure (network, DNS, timeout) → retry later
 */

export type ErrorCategory =
  | "rate_limit"
  | "auth"
  | "config"
  | "server_error"
  | "context_overflow"
  | "invalid_request"
  | "network"
  | "tool_error"
  | "cancelled"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  suggestion: string;
  retryable: boolean;
}

export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Rate limits
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return {
      category: "rate_limit",
      message,
      suggestion: "Rate limited by the API provider. Wait a minute and retry, or switch to a different provider.",
      retryable: true,
    };
  }

  // Configuration errors (missing provider/model/API key)
  if (lower.includes("no api key") || lower.includes("no default provider") ||
      lower.includes("no exec provider") || lower.includes("not configured")) {
    return {
      category: "config",
      message,
      suggestion: "Missing provider, model, or API key configuration. Check your settings.",
      retryable: false,
    };
  }

  // Auth errors (API rejected the key)
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") ||
      lower.includes("invalid api key") || lower.includes("invalid x-api-key") ||
      lower.includes("permission denied")) {
    return {
      category: "auth",
      message,
      suggestion: "API key is invalid or expired. Check your provider settings and update the API key.",
      retryable: false,
    };
  }

  // Context overflow
  if (lower.includes("context length") || lower.includes("token limit") ||
      lower.includes("maximum context") || lower.includes("too long") ||
      lower.includes("max_tokens") || lower.includes("context window")) {
    return {
      category: "context_overflow",
      message,
      suggestion: "The conversation exceeded the model's context window. Try a model with a larger context, or reduce the number of steps.",
      retryable: false,
    };
  }

  // Invalid request — narrowed to HTTP status codes and specific API phrases
  // to avoid catching internal validation errors like "Invalid analysis response"
  if (lower.includes("api 400") || lower.includes("api 422") ||
      lower.includes("malformed") || lower.includes("bad request")) {
    return {
      category: "invalid_request",
      message,
      suggestion: "The API request was malformed. This may be a bug — please report it.",
      retryable: false,
    };
  }

  // Server errors
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") ||
      lower.includes("529") || lower.includes("internal server error") ||
      lower.includes("service unavailable") || lower.includes("bad gateway")) {
    return {
      category: "server_error",
      message,
      suggestion: "The API provider is experiencing issues. Retry in a few minutes.",
      retryable: true,
    };
  }

  // Network errors
  if (lower.includes("econnrefused") || lower.includes("enotfound") ||
      lower.includes("etimedout") || lower.includes("fetch failed") ||
      lower.includes("network") || lower.includes("dns") ||
      lower.includes("connection refused")) {
    return {
      category: "network",
      message,
      suggestion: "Network connection failed. Check your internet connection and verify the provider endpoint is reachable.",
      retryable: true,
    };
  }

  // Cancellation
  if (lower.includes("cancelled") || lower.includes("canceled") || lower.includes("aborted")) {
    return {
      category: "cancelled",
      message,
      suggestion: "The session was cancelled by the user.",
      retryable: false,
    };
  }

  // Tool errors — sandbox violations and common tool failures
  if (lower.includes("worktree") || lower.includes("sandbox") ||
      lower.includes("path escapes") || lower.includes("allowlist") ||
      lower.includes("old_text not found") || lower.includes("old_text matches") ||
      lower.includes("no ready worktree")) {
    return {
      category: "tool_error",
      message,
      suggestion: "A tool operation failed. Check the error details and verify the worktree is set up correctly.",
      retryable: false,
    };
  }

  return {
    category: "unknown",
    message,
    suggestion: "An unexpected error occurred. Check the logs for details.",
    retryable: false,
  };
}
