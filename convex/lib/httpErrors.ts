import { ZodError } from "zod";

export type HttpErrorCode =
  | "method_not_allowed"
  | "unauthorized"
  | "forbidden"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "rate_limited"
  | "upstream_unavailable"
  | "misconfigured"
  | "internal_error";

export const HTTP_ERROR_CODE_HEADER = "x-sendcat-error-code";

export function createHttpErrorResponse(input: {
  status: number;
  code: HttpErrorCode;
  message: string;
  headers?: HeadersInit;
}) {
  const headers = new Headers(input.headers);
  headers.set(HTTP_ERROR_CODE_HEADER, input.code);
  return new Response(input.message, {
    status: input.status,
    headers,
  });
}

export function formatValidationIssues(error: ZodError) {
  return error.issues.map((issue) => issue.message).join(", ");
}
