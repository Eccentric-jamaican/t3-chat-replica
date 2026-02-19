import {
  acquireBulkheadSlot,
  BulkheadSaturatedError,
  releaseBulkheadSlot,
  type BulkheadProvider,
} from "./bulkhead";
import {
  assertCircuitClosed,
  CircuitOpenError,
  recordCircuitError,
  recordCircuitResponse,
  type CircuitProvider,
} from "./circuitBreaker";
import {
  getChatGatewayFlags,
  getChatProviderRouteConfig,
} from "./reliabilityConfig";

type ChatModelClass = "fast" | "agent";
type ChatProviderRoute = {
  id: "primary" | "secondary";
  providerId: "openrouter";
  circuitProvider: CircuitProvider;
  bulkheadProvider: BulkheadProvider;
  timeoutMs: number;
  retries: number;
  models: string[];
};

export type ChatUpstreamErrorCode =
  | "upstream_timeout"
  | "upstream_rate_limited"
  | "upstream_quota_exceeded"
  | "upstream_unavailable"
  | "upstream_bad_request"
  | "upstream_auth"
  | "upstream_error";

export class ChatUpstreamError extends Error {
  code: ChatUpstreamErrorCode;
  retryAfterMs?: number;
  status?: number;
  providerId: string;
  routeId: string;
  retryable: boolean;

  constructor(input: {
    code: ChatUpstreamErrorCode;
    message: string;
    providerId: string;
    routeId: string;
    retryable: boolean;
    retryAfterMs?: number;
    status?: number;
  }) {
    super(input.message);
    this.name = "ChatUpstreamError";
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs;
    this.status = input.status;
    this.providerId = input.providerId;
    this.routeId = input.routeId;
    this.retryable = input.retryable;
  }
}

function inferModelClass(modelId: string | null | undefined, fallback: ChatModelClass) {
  const id = (modelId ?? "").toLowerCase();
  if (!id) return fallback;
  if (
    id.includes("mini") ||
    id.includes("flash") ||
    id.includes("haiku") ||
    id.includes("kimi")
  ) {
    return "fast";
  }
  return "agent";
}

function buildCandidateModels(input: {
  requestedModelId?: string | null;
  modelClass: ChatModelClass;
  route: "primary" | "secondary";
}) {
  const config = getChatProviderRouteConfig();
  const requested = (input.requestedModelId ?? "").trim();
  const classDefault =
    input.modelClass === "fast"
      ? input.route === "primary"
        ? config.fastPrimaryModel
        : config.fastSecondaryModel
      : input.route === "primary"
        ? config.agentPrimaryModel
        : config.agentSecondaryModel;
  const fallback =
    input.modelClass === "fast"
      ? config.fastSecondaryModel
      : config.agentSecondaryModel;
  if (requested) {
    if (input.route === "primary") {
      return [requested];
    }
    const secondaryModels = [classDefault, fallback].filter((m) => !!m) as string[];
    return [...new Set(secondaryModels)];
  }
  const models = [classDefault, fallback].filter((m) => !!m) as string[];
  return [...new Set(models)];
}

function getProviderRoutes(input: { requestedModelId?: string | null }) {
  const gatewayFlags = getChatGatewayFlags();
  const routing = getChatProviderRouteConfig();
  const modelClass = inferModelClass(input.requestedModelId, routing.defaultModelClass);
  const routes: ChatProviderRoute[] = [
    {
      id: "primary",
      providerId: "openrouter",
      circuitProvider: "openrouter_chat_primary",
      bulkheadProvider: "openrouter_chat_primary",
      timeoutMs: routing.primaryTimeoutMs,
      retries: routing.primaryRetries,
      models: buildCandidateModels({
        requestedModelId: input.requestedModelId,
        modelClass,
        route: "primary",
      }),
    },
  ];
  if (gatewayFlags.providerFailoverEnabled) {
    routes.push({
      id: "secondary",
      providerId: "openrouter",
      circuitProvider: "openrouter_chat_secondary",
      bulkheadProvider: "openrouter_chat_secondary",
      timeoutMs: routing.secondaryTimeoutMs,
      retries: routing.secondaryRetries,
      models: buildCandidateModels({
        requestedModelId: input.requestedModelId,
        modelClass,
        route: "secondary",
      }),
    });
  }
  return { routes, modelClass };
}

function toRetryAfterMs(value: string | null) {
  if (!value) return undefined;
  const asInt = Number.parseInt(value, 10);
  if (Number.isFinite(asInt) && asInt > 0) {
    return asInt * 1000;
  }
  return undefined;
}

function errorFromHttpStatus(route: ChatProviderRoute, response: Response) {
  const retryAfterMs = toRetryAfterMs(response.headers.get("retry-after"));
  if (response.status === 402) {
    return new ChatUpstreamError({
      code: "upstream_quota_exceeded",
      message:
        "Model provider quota is currently exceeded. Please try again shortly.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: true,
      retryAfterMs,
      status: response.status,
    });
  }
  if (response.status === 429) {
    return new ChatUpstreamError({
      code: "upstream_rate_limited",
      message: "Model provider is rate limited. Please retry in a moment.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: true,
      retryAfterMs,
      status: response.status,
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new ChatUpstreamError({
      code: "upstream_auth",
      message: "Model provider authentication failed.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: false,
      status: response.status,
    });
  }
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return new ChatUpstreamError({
      code: "upstream_bad_request",
      message: "Model provider rejected the request.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: false,
      status: response.status,
    });
  }
  if (response.status >= 500) {
    return new ChatUpstreamError({
      code: "upstream_unavailable",
      message: "Model provider is temporarily unavailable.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: true,
      retryAfterMs,
      status: response.status,
    });
  }
  return new ChatUpstreamError({
    code: "upstream_error",
    message: "Model provider request failed.",
    providerId: route.providerId,
    routeId: route.id,
    retryable: true,
    retryAfterMs,
    status: response.status,
  });
}

function classifyProviderError(route: ChatProviderRoute, error: unknown) {
  if (error instanceof ChatUpstreamError) return error;
  if (error instanceof CircuitOpenError || error instanceof BulkheadSaturatedError) {
    return new ChatUpstreamError({
      code: "upstream_unavailable",
      message: "Model provider is temporarily unavailable.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: true,
      retryAfterMs: error.retryAfterMs,
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ChatUpstreamError({
      code: "upstream_timeout",
      message: "Model provider request timed out.",
      providerId: route.providerId,
      routeId: route.id,
      retryable: true,
      retryAfterMs: 1000,
    });
  }
  return new ChatUpstreamError({
    code: "upstream_error",
    message: "Model provider request failed.",
    providerId: route.providerId,
    routeId: route.id,
    retryable: true,
  });
}

function shouldAttemptFailover(error: ChatUpstreamError) {
  return (
    error.code === "upstream_quota_exceeded" ||
    error.code === "upstream_unavailable" ||
    error.code === "upstream_timeout" ||
    error.code === "upstream_rate_limited" ||
    error.code === "upstream_error"
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRouteTimeout(
  route: ChatProviderRoute,
  init: RequestInit,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), route.timeoutMs);
  const cancelOnExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", cancelOnExternalAbort);
  try {
    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", cancelOnExternalAbort);
  }
}

export async function executeChatProviderRequest(input: {
  ctx: any;
  apiKey: string;
  requestedModelId?: string | null;
  payload: Record<string, unknown>;
  abortSignal?: AbortSignal;
  headers?: Record<string, string>;
}) {
  const { routes, modelClass } = getProviderRoutes({
    requestedModelId: input.requestedModelId,
  });
  let lastError: ChatUpstreamError | null = null;

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    let leaseId: string | null = null;
    try {
      leaseId = await acquireBulkheadSlot(input.ctx, route.bulkheadProvider);
      for (let attempt = 0; attempt <= route.retries; attempt++) {
        try {
          await assertCircuitClosed(input.ctx, route.circuitProvider);
          const response = await fetchWithRouteTimeout(
            route,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${input.apiKey}`,
                "Content-Type": "application/json",
                ...(input.headers ?? {}),
              },
              body: JSON.stringify({
                ...input.payload,
                models: route.models,
                stream: true,
              }),
            },
            input.abortSignal,
          );
          await recordCircuitResponse(input.ctx, route.circuitProvider, response.status);
          if (!response.ok) {
            const statusError = errorFromHttpStatus(route, response);
            if (attempt < route.retries && statusError.retryable) {
              await wait(100 + attempt * 150);
              continue;
            }
            throw statusError;
          }
          if (!response.body) {
            throw new ChatUpstreamError({
              code: "upstream_error",
              message: "Model provider returned no response body.",
              providerId: route.providerId,
              routeId: route.id,
              retryable: true,
            });
          }
          return {
            response,
            route,
            modelClass,
          };
        } catch (error) {
          const isHttpStatusError =
            error instanceof ChatUpstreamError &&
            typeof error.status === "number";
          if (!isHttpStatusError) {
            await recordCircuitError(input.ctx, route.circuitProvider, error);
          }
          const classified = classifyProviderError(route, error);
          if (attempt < route.retries && classified.retryable) {
            await wait(100 + attempt * 150);
            continue;
          }
          throw classified;
        }
      }
    } catch (routeError) {
      const classified = classifyProviderError(route, routeError);
      lastError = classified;
      const hasMoreRoutes = routeIndex < routes.length - 1;
      if (hasMoreRoutes && shouldAttemptFailover(classified)) {
        continue;
      }
      throw classified;
    } finally {
      await releaseBulkheadSlot(input.ctx, route.bulkheadProvider, leaseId);
    }
  }

  throw (
    lastError ??
    new ChatUpstreamError({
      code: "upstream_error",
      message: "Model provider request failed.",
      providerId: "openrouter",
      routeId: "primary",
      retryable: true,
    })
  );
}

export function toClientSafeUpstreamError(error: unknown) {
  const classified =
    error instanceof ChatUpstreamError
      ? error
      : new ChatUpstreamError({
          code: "upstream_error",
          message: "Model provider request failed.",
          providerId: "openrouter",
          routeId: "primary",
          retryable: true,
        });
  return {
    code: classified.code,
    message: classified.message,
    retryAfterMs: classified.retryAfterMs,
    retryable: classified.retryable,
    providerId: classified.providerId,
    routeId: classified.routeId,
    status: classified.status,
  };
}
