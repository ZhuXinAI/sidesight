export type SideSightErrorCode =
  | "USAGE_ERROR"
  | "CONFIG_ERROR"
  | "SECURITY_ERROR"
  | "MEDIA_ERROR"
  | "LOCAL_BACKEND_ERROR"
  | "PROVIDER_ERROR"
  | "TEXT_ONLY_MODEL"
  | "MCP_ERROR"
  | "INTERNAL_ERROR";

export class SideSightError extends Error {
  readonly code: SideSightErrorCode;
  readonly exitCode: number;
  readonly details?: Record<string, string | number | boolean>;

  constructor(
    code: SideSightErrorCode,
    message: string,
    options: { exitCode?: number; details?: Record<string, string | number | boolean>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "SideSightError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }
}

export function usageError(message: string): SideSightError {
  return new SideSightError("USAGE_ERROR", message, { exitCode: 2 });
}

export function configError(message: string, cause?: unknown): SideSightError {
  return new SideSightError("CONFIG_ERROR", message, { cause });
}

export function securityError(message: string, cause?: unknown): SideSightError {
  return new SideSightError("SECURITY_ERROR", message, { cause });
}

export function mediaError(message: string, cause?: unknown): SideSightError {
  return new SideSightError("MEDIA_ERROR", message, { cause });
}

export function localBackendError(message: string, cause?: unknown): SideSightError {
  return new SideSightError("LOCAL_BACKEND_ERROR", message, { cause });
}

export function providerError(message: string, cause?: unknown, code: "PROVIDER_ERROR" | "TEXT_ONLY_MODEL" = "PROVIDER_ERROR"): SideSightError {
  return new SideSightError(code, message, { cause });
}

const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(?:api[_-]?key|authorization|token|secret)\s*[:=]\s*[^\s,;]+/gi,
];

export function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  for (const pattern of secretPatterns) redacted = redacted.replace(pattern, "[REDACTED]");
  redacted = redacted.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, "[MEDIA_REDACTED]");
  return redacted;
}

export function asSideSightError(error: unknown, secrets: string[] = []): SideSightError {
  if (error instanceof SideSightError) {
    return new SideSightError(error.code, redactSecrets(error.message, secrets), {
      exitCode: error.exitCode,
      details: error.details,
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SideSightError("INTERNAL_ERROR", redactSecrets(message, secrets), { cause: error });
}
