export type FunctionErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "misconfigured"
  | "invalid_function_args"
  | "internal_error";

const FUNCTION_ERROR_PATTERN = /^\[([a-z_]+):([^\]]+)\]\s?(.*)$/;

export function createFunctionError(
  code: FunctionErrorCode,
  functionName: string,
  message: string,
) {
  return new Error(`[${code}:${functionName}] ${message}`);
}

export function throwFunctionError(
  code: FunctionErrorCode,
  functionName: string,
  message: string,
): never {
  throw createFunctionError(code, functionName, message);
}

export function parseFunctionError(error: unknown): {
  code: FunctionErrorCode;
  functionName: string;
  message: string;
} | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(FUNCTION_ERROR_PATTERN);
  if (!match) {
    return null;
  }

  const [, code, functionName, details] = match;
  return {
    code: code as FunctionErrorCode,
    functionName,
    message: details || "",
  };
}

export function hasFunctionErrorCode(
  error: unknown,
  code: FunctionErrorCode,
) {
  const parsed = parseFunctionError(error);
  return parsed?.code === code;
}
