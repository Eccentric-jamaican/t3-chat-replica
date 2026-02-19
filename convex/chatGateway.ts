import { createHttpErrorResponse } from "./lib/httpErrors";
import {
  getAdmissionControlConfig,
  getChatProviderRouteConfig,
  getChatGatewayFlags,
  getRegionTopologyConfig,
  type ChatGatewayFlags,
} from "./lib/reliabilityConfig";

export type ChatGatewayMode = "legacy" | "shadow" | "authoritative";

type ChatHandlerOptions = {
  gatewayMode?: ChatGatewayMode;
  forceAdmissionMode?: "shadow" | "enforce";
  failClosedOnRedisError?: boolean;
};

type ChatGatewayHandler = (
  ctx: any,
  request: Request,
  options?: ChatHandlerOptions,
) => Promise<Response>;

export function resolveChatGatewayMode(
  flags: ChatGatewayFlags = getChatGatewayFlags(),
): ChatGatewayMode {
  if (!flags.enabled) return "legacy";
  return flags.shadowMode ? "shadow" : "authoritative";
}

export function resolveAdmissionModeForGateway(
  flags: ChatGatewayFlags = getChatGatewayFlags(),
): "shadow" | "enforce" {
  const admission = getAdmissionControlConfig();
  if (flags.admissionEnforce) return "enforce";
  return admission.shadowMode ? "shadow" : "enforce";
}

export async function runChatGatewayRequest(
  ctx: any,
  request: Request,
  handler: ChatGatewayHandler,
) {
  const flags = getChatGatewayFlags();
  const mode = resolveChatGatewayMode(flags);
  const admissionMode = resolveAdmissionModeForGateway(flags);

  const response = await handler(ctx, request, {
    gatewayMode: mode,
    forceAdmissionMode: admissionMode,
    failClosedOnRedisError: flags.failClosedOnRedisError,
  });
  response.headers.set("X-Sendcat-Chat-Gateway", mode);
  response.headers.set("X-Sendcat-Admission-Mode", admissionMode);
  return response;
}

function buildGatewayHealthPayload() {
  const flags = getChatGatewayFlags();
  const admission = getAdmissionControlConfig();
  const mode = resolveChatGatewayMode(flags);
  const effectiveAdmissionMode = resolveAdmissionModeForGateway(flags);
  const providerRoutes = getChatProviderRouteConfig();
  const regionTopology = getRegionTopologyConfig();
  const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const hasAdmissionCredentials =
    !admission.enabled ||
    (Boolean(admission.redisUrl.trim()) && Boolean(admission.redisToken.trim()));
  const ready =
    hasOpenRouterKey &&
    (!flags.failClosedOnRedisError || hasAdmissionCredentials);

  return {
    ok: ready,
    mode,
    checkedAt: new Date().toISOString(),
    flags: {
      enabled: flags.enabled,
      shadowMode: flags.shadowMode,
      admissionEnforce: flags.admissionEnforce,
      toolQueueEnforce: flags.toolQueueEnforce,
      providerFailoverEnabled: flags.providerFailoverEnabled,
      failClosedOnRedisError: flags.failClosedOnRedisError,
    },
    admission: {
      enabled: admission.enabled,
      configuredShadowMode: admission.shadowMode,
      effectiveMode: effectiveAdmissionMode,
      redisConfigured: hasAdmissionCredentials,
      keyPrefix: admission.keyPrefix,
      enforcePolicy: {
        userInFlight: admission.enforceUserInFlight,
        globalInFlight: admission.enforceGlobalInFlight,
        globalMessageRate: admission.enforceGlobalMessageRate,
        globalToolRate: admission.enforceGlobalToolRate,
      },
      retryAfter: {
        baseMs: admission.retryAfterMs,
        jitterPct: admission.retryAfterJitterPct,
      },
    },
    checks: {
      openRouterApiKeyConfigured: hasOpenRouterKey,
    },
    providerRoutes,
    regionTopology,
  };
}

export async function chatGatewayHealthHandler(_ctx: any, request: Request) {
  if (request.method !== "GET") {
    return createHttpErrorResponse({
      status: 405,
      code: "method_not_allowed",
      message: "Method not allowed",
    });
  }

  const flags = getChatGatewayFlags();
  if (!flags.healthEndpointEnabled) {
    return createHttpErrorResponse({
      status: 403,
      code: "forbidden",
      message: "Health endpoint disabled",
    });
  }

  const payload = buildGatewayHealthPayload();
  return new Response(JSON.stringify(payload), {
    status: payload.ok ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
