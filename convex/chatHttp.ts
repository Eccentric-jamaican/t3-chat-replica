import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { getModelCapabilities } from "./lib/models";
import { normalizeEbaySearchArgs } from "./lib/ebaySearch";
import { chatRequestSchema } from "./lib/httpContracts";
import {
  createHttpErrorResponse,
  formatValidationIssues,
} from "./lib/httpErrors";
import {
  executeChatProviderRequest,
  toClientSafeUpstreamError,
} from "./lib/chatProviderRouter";
import {
  getBasePrompt,
  getStrategyPrompt,
  getRegexFallbackPrompt,
} from "./lib/prompts";
import {
  dedupeProducts,
  parseFunctionCallsFromContent,
  parseFallbackToolCallsFromContent,
  hasOpenFallbackToolCall,
} from "./lib/toolHelpers";
import {
  buildProductSearchCacheKey,
  normalizeToolCacheText,
} from "./lib/toolCacheKeys";
import {
  getRateLimits,
  buildRateLimitErrorMessage,
  buildRetryAfterSeconds,
  isRateLimitContentionError,
} from "./lib/rateLimit";
import {
  getAdmissionControlConfig,
  getToolCacheConfig,
  getToolCacheNamespaces,
} from "./lib/reliabilityConfig";
import { enqueueToolJobAndWait } from "./lib/toolJobClient";
import {
  checkAndAcquireAdmission,
  releaseAdmission,
  type AdmissionTicket,
} from "./lib/admissionControl";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current time in helpful format",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for current information",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search for products across eBay and global retailers to compare options",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The product search query" },
          limit: {
            type: "number",
            description: "Number of results (max 36)",
            default: 36,
          },
          categoryId: {
            type: "string",
            description: "Optional eBay category ID (preferred when known)",
          },
          categoryName: {
            type: "string",
            description: "Optional category name (matched to eBay taxonomy)",
          },
          minPrice: {
            type: "number",
            description: "Minimum price in USD",
          },
          maxPrice: {
            type: "number",
            description: "Maximum price in USD",
          },
          condition: {
            type: "string",
            enum: ["new", "used", "refurbished", "open_box"],
          },
          shipping: {
            type: "string",
            enum: ["free", "fast"],
          },
          sellerRating: {
            type: "number",
            description: "Minimum seller feedback percentage (default 95)",
          },
          location: {
            type: "string",
            description: "Optional location (eBay country code or city/region)",
          },
        },
        required: ["query"],
      },
    },
  },
];

const MAX_CHAT_REQUEST_BYTES = 64 * 1024;

type ChatHandlerRuntimeOptions = {
  gatewayMode?: "legacy" | "shadow" | "authoritative";
  forceAdmissionMode?: "shadow" | "enforce";
  failClosedOnRedisError?: boolean;
};

function buildProductToolSummary(products: Array<{ source?: string }>) {
  const ebayCount = products.filter((item) => item.source === "ebay").length;
  const globalCount = products.filter((item) => item.source === "global").length;
  const summaryParts: string[] = [];
  if (ebayCount > 0) summaryParts.push(`${ebayCount} eBay items`);
  if (globalCount > 0) summaryParts.push(`${globalCount} global items`);
  if (summaryParts.length === 0) summaryParts.push("no items");
  return `Found ${summaryParts.join(" and ")}. They have been displayed to the user.`;
}

function getContentLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function enforceJsonBodyGuards(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return createHttpErrorResponse({
      status: 415,
      code: "unsupported_media_type",
      message: "Content-Type must be application/json",
    });
  }

  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    return createHttpErrorResponse({
      status: 413,
      code: "payload_too_large",
      message: "Request payload too large",
    });
  }

  return null;
}

export async function chatHandler(
  ctx: any,
  request: Request,
  runtime: ChatHandlerRuntimeOptions = {},
) {
  if (request.method !== "POST") {
    return createHttpErrorResponse({
      status: 405,
      code: "method_not_allowed",
      message: "Method not allowed",
    });
  }

  // 1. Auth check
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return createHttpErrorResponse({
      status: 401,
      code: "unauthorized",
      message: "Unauthorized",
    });
  }

  const jsonGuard = enforceJsonBodyGuards(request, MAX_CHAT_REQUEST_BYTES);
  if (jsonGuard) {
    return jsonGuard;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return createHttpErrorResponse({
      status: 400,
      code: "invalid_json",
      message: "Invalid JSON body",
    });
  }
  const parsed = chatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return createHttpErrorResponse({
      status: 400,
      code: "invalid_request",
      message: `Invalid request body: ${formatValidationIssues(parsed.error)}`,
    });
  }

  const { threadId, modelId, webSearch } = parsed.data;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return createHttpErrorResponse({
      status: 500,
      code: "misconfigured",
      message: "API Key not configured",
    });
  }

  const emitRateLimitEvent = async (input: {
    bucket: string;
    key: string;
    outcome: "allowed" | "blocked" | "contention_fallback";
    reason?: string;
    retryAfterMs?: number;
  }) => {
    try {
      await ctx.scheduler.runAfter(0, internal.rateLimit.recordEvent, {
        source: "chat_http",
        bucket: input.bucket,
        key: input.key,
        outcome: input.outcome,
        reason: input.reason,
        retryAfterMs: input.retryAfterMs,
        path: "/api/chat",
        method: request.method,
      });
    } catch {
      // Observability should not block the response path.
    }
  };
  const admissionConfig = getAdmissionControlConfig();
  const shouldSampleAllowedEvent = () =>
    admissionConfig.allowedEventSamplePct > 0 &&
    Math.random() * 100 < admissionConfig.allowedEventSamplePct;
  const effectiveAdmissionMode =
    runtime.forceAdmissionMode ??
    (admissionConfig.shadowMode ? "shadow" : "enforce");
  const admissionPrincipal = `user:${userId}`;
  const admissionEventKey = `chat_admission:${admissionPrincipal}`;
  let admissionTicket: AdmissionTicket | null = null;
  let shouldFallbackToLegacyRateLimit = false;

  if (admissionConfig.enabled) {
    const estimatedToolCalls = webSearch
      ? admissionConfig.estimatedToolCallsPerMessage
      : Math.max(admissionConfig.estimatedToolCallsPerMessage - 1, 0);
    const admissionResult = await checkAndAcquireAdmission({
      principalKey: admissionPrincipal,
      mode: effectiveAdmissionMode,
      estimatedToolCalls,
      config: admissionConfig,
    });

    if (admissionResult.mode === "shadow") {
      if (admissionResult.wouldBlock) {
        await emitRateLimitEvent({
          bucket: "chat_admission_shadow",
          key: admissionEventKey,
          outcome:
            admissionResult.reason === "redis_unavailable"
              ? "contention_fallback"
              : "blocked",
          reason: admissionResult.reason,
          retryAfterMs: admissionResult.retryAfterMs,
        });
      } else if (shouldSampleAllowedEvent()) {
        await emitRateLimitEvent({
          bucket: "chat_admission_shadow",
          key: admissionEventKey,
          outcome: "allowed",
        });
      }
    } else if (admissionResult.mode === "enforce" && !admissionResult.allowed) {
      const failClosedOnRedisError = runtime.failClosedOnRedisError ?? true;
      const shouldFailOpenOnRedisError =
        admissionResult.reason === "redis_unavailable" &&
        !failClosedOnRedisError;
      await emitRateLimitEvent({
        bucket: "chat_admission",
        key: admissionEventKey,
        outcome:
          admissionResult.reason === "redis_unavailable"
            ? "contention_fallback"
            : "blocked",
        reason: admissionResult.reason,
        retryAfterMs: admissionResult.retryAfterMs,
      });
      if (!shouldFailOpenOnRedisError) {
        return createHttpErrorResponse({
          status: 429,
          code: "rate_limited",
          message: buildRateLimitErrorMessage(admissionResult.retryAfterMs),
          headers: {
            "Retry-After": buildRetryAfterSeconds(admissionResult.retryAfterMs),
          },
        });
      } else {
        shouldFallbackToLegacyRateLimit = true;
      }
    } else if (admissionResult.mode === "enforce") {
      admissionTicket = admissionResult.ticket;
      if (shouldSampleAllowedEvent()) {
        await emitRateLimitEvent({
          bucket: "chat_admission",
          key: admissionEventKey,
          outcome: "allowed",
          reason: admissionResult.softBlockedReasons[0],
        });
      }
    }
  }

  const shouldUseLegacyRateLimit =
    !admissionConfig.enabled ||
    effectiveAdmissionMode === "shadow" ||
    shouldFallbackToLegacyRateLimit;
  const rateLimits = getRateLimits();
  const toolCacheConfig = getToolCacheConfig();
  const toolCacheNamespaces = getToolCacheNamespaces();
  if (shouldUseLegacyRateLimit) {
    const limitKey = `chat_stream:user:${userId}`;
    let limit;
    try {
      limit = await ctx.runMutation(internal.rateLimit.checkAndIncrement, {
        key: limitKey,
        max: rateLimits.chatStream.max,
        windowMs: rateLimits.chatStream.windowMs,
      });
    } catch (error) {
      if (isRateLimitContentionError(error)) {
        await emitRateLimitEvent({
          bucket: "chat_stream",
          key: limitKey,
          outcome: "contention_fallback",
          retryAfterMs: 1000,
        });
        return createHttpErrorResponse({
          status: 429,
          code: "rate_limited",
          message: "Too many requests. Please retry in a moment.",
          headers: { "Retry-After": "1" },
        });
      }
      throw error;
    }
    if (!limit.allowed) {
      await emitRateLimitEvent({
        bucket: "chat_stream",
        key: limitKey,
        outcome: "blocked",
        retryAfterMs: limit.retryAfterMs,
      });
      return createHttpErrorResponse({
        status: 429,
        code: "rate_limited",
        message: buildRateLimitErrorMessage(limit.retryAfterMs),
        headers: {
          "Retry-After": buildRetryAfterSeconds(limit.retryAfterMs),
        },
      });
    }
  }

  const encoder = new TextEncoder();
  let isAborted = false;

  // Detect client abort
  request.signal.addEventListener("abort", () => {
    console.log("[SSE] Client aborted request");
    isAborted = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        if (isAborted) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const emitToolBackpressure = (
        toolName: string,
        backpressure:
          | { reason: string; retryable: boolean; retryAfterMs?: number }
          | undefined,
      ) => {
        if (!backpressure) return;
        send({
          type: "tool-backpressure",
          toolName,
          ...backpressure,
        });
      };
      let requestStart: number | null = null;
      let responseModel: string | null = null;

      try {
        let messageId = await ctx.runMutation(
          internal.messages.internalInitializeAssistantMessage,
          {
            threadId,
            modelId,
          },
        );

        send({ type: "start", messageId });

        let cycle = 0;
        const MAX_CYCLES = 10; // Safety ceiling, real limits are per-tool below
        let shouldContinue = true;
        let fullContent = "";
        let contentBuffer = "";
        let fullReasoning = "";
        let firstTokenAt: number | null = null;
        let lastUsage: any = null;

        // [COST CONTROL] Per-turn tool usage counters
        let webSearchCount = 0;
        let timeCheckCount = 0;
        let globalSearchCount = 0;
        let productSearchCount = 0;
        let toolLimitsReached = false;
        const MAX_WEB_SEARCH_PER_TURN = 2;
        const MAX_TIME_CHECK_PER_TURN = 1;
        const MAX_GLOBAL_SEARCH_PER_TURN = 2;
        const MAX_PRODUCT_SEARCH_PER_TURN = 2;

        let currentAbortController: AbortController | null = null;
        request.signal.addEventListener("abort", () => {
          currentAbortController?.abort();
        });

        while (shouldContinue && cycle < MAX_CYCLES && !isAborted) {
          shouldContinue = false;
          cycle++;

          const messages = await ctx.runQuery(internal.messages.internalList, {
            threadId,
          });
          const capabilities = getModelCapabilities(modelId);
          const openRouterMessages = messages
            .filter((m: any) => {
              // Exclude current empty assistant message from history
              // (it was just created for this cycle and has no content yet)
              if (m._id === messageId) {
                return !!(
                  m.content ||
                  m.toolCalls?.length ||
                  m.reasoningContent
                );
              }
              return true;
            })
            .map((m: any) => {
              const msg: any = { role: m.role };

              if (m.role === "tool") {
                msg.tool_call_id = m.toolCallId;
                msg.content = m.content ?? "";
                return msg;
              }

              if (m.toolCalls && m.toolCalls.length > 0) {
                msg.tool_calls = m.toolCalls;
                // Tool call messages should have null content per OpenRouter spec
                msg.content = null;
                return msg;
              }

              if (m.attachments && m.attachments.length > 0) {
                const content = [] as any[];
                const text = m.content ?? "";
                if (text.trim().length > 0) {
                  content.push({ type: "text", text });
                }
                m.attachments.forEach((att: any) => {
                  if (!att.url) return;
                  if (att.type?.startsWith("image/")) {
                    content.push({
                      type: "image_url",
                      image_url: { url: att.url },
                    });
                    return;
                  }
                  if (att.type === "application/pdf") {
                    content.push({
                      type: "file",
                      file: {
                        filename: att.name || "document.pdf",
                        file_data: att.url,
                      },
                    });
                  }
                });
                msg.content = content.length > 0 ? content : m.content;
                return msg;
              }

              msg.content = m.content;
              return msg;
            });

          // [AGENTIC] Inject Base System Prompt (Sendcat Assistant identity & guidelines)
          openRouterMessages.unshift({
            role: "system",
            content: getBasePrompt(),
          });

          // [AGENTIC] Add strategy-specific overlay (standard vs reasoning models)
          const strategyPrompt = getStrategyPrompt(capabilities);
          if (strategyPrompt) {
            openRouterMessages.unshift({
              role: "system",
              content: strategyPrompt,
            });
          }

          // [AGENTIC] Add regex fallback for models without native tool support
          if (capabilities.toolFallback === "regex" && webSearch) {
            const fallbackPrompt = getRegexFallbackPrompt(capabilities);
            if (fallbackPrompt) {
              openRouterMessages.unshift({
                role: "system",
                content: fallbackPrompt,
              });
            }
          }

          // Regex fallback prompt is handled by getRegexFallbackPrompt above

          const abortController = new AbortController();
          currentAbortController = abortController;
          requestStart = Date.now();
          firstTokenAt = null;
          lastUsage = null;
          responseModel = null;
          let response: Response;
          let upstreamRouteId = "primary";
          let upstreamProviderId = "openrouter";
          try {
            const upstream = await executeChatProviderRequest({
              ctx,
              apiKey,
              requestedModelId: modelId,
              abortSignal: abortController.signal,
              headers: {
                "HTTP-Referer": "https://sendcat.app",
                "X-Title": "Sendcat",
              },
              payload: {
                messages: openRouterMessages,
                // [AGENTIC] Filter by capability
                tools: getModelCapabilities(modelId).supportsTools
                  ? TOOLS.filter(
                      (t) => t.function.name !== "search_web" || webSearch,
                    )
                  : undefined,
                ...(getModelCapabilities(modelId).supportsTools
                  ? {
                      tool_choice: toolLimitsReached ? "none" : "auto",
                      parallel_tool_calls: false,
                    }
                  : {}),
              },
            });
            response = upstream.response;
            upstreamRouteId = upstream.route.id;
            upstreamProviderId = upstream.route.providerId;
            send({
              type: "provider-route",
              providerId: upstreamProviderId,
              routeId: upstreamRouteId,
              modelClass: upstream.modelClass,
            });
          } catch (error) {
            throw toClientSafeUpstreamError(error);
          }

          // Controller is now handled by the outer listener
          if (!response.body) {
            throw toClientSafeUpstreamError(
              new Error("Model provider returned no response body."),
            );
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulatedToolCalls: any[] = [];
          let finishReason: string | null = null;

          readLoop: while (!isAborted) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk
              .split("\n")
              .filter((l) => l.trim().startsWith("data: "));

            for (const line of lines) {
              const dataStr = line.replace("data: ", "");
              if (dataStr === "[DONE]") break readLoop;

              let data;
              try {
                data = JSON.parse(dataStr);
              } catch {
                continue;
              }

              if (data.model && !responseModel) {
                responseModel = data.model;
              }
              if (data.usage) {
                lastUsage = data.usage;
              }

              // Handle mid-stream errors from OpenRouter
              if (data.error) {
                console.error(`OpenRouter stream error: ${data.error.message}`);
                isAborted = true;
                try {
                  await reader.cancel();
                } catch {}
                break readLoop;
              }

              const choice = data.choices?.[0];
              const delta = choice?.delta;
              const chunkFinishReason = choice?.finish_reason;

              if (chunkFinishReason) {
                finishReason = chunkFinishReason;
              }

              if (delta?.content) {
                if (!firstTokenAt) {
                  firstTokenAt = Date.now();
                }
                contentBuffer += delta.content;
                const functionCallParse =
                  parseFunctionCallsFromContent(contentBuffer);
                if (functionCallParse.toolCalls.length > 0) {
                  accumulatedToolCalls.push(...functionCallParse.toolCalls);
                  contentBuffer = "";
                  break readLoop;
                }
                if (functionCallParse.cleaned !== contentBuffer) {
                  contentBuffer = functionCallParse.cleaned;
                }
                if (functionCallParse.hasOpenTag) {
                  continue;
                }

                // [AGENTIC] Regex/tool-fallback parsing (before streaming content to client).
                // Some models (e.g. minimax) will emit bracket-style tool hints like:
                //   [search_web: "..."] or [search_products: "..."]
                // We must intercept these before sending them as assistant text.
                if (capabilities.toolFallback === "regex") {
                  const candidate = fullContent + contentBuffer;
                  const parsed = parseFallbackToolCallsFromContent(candidate, {
                    allowWebSearch: !!webSearch,
                  });
                  // Always strip fallback tool markup from assistant text, even if we
                  // can't parse it into an executable tool call.
                  if (parsed.cleaned !== candidate) {
                    if (parsed.cleaned.startsWith(fullContent)) {
                      contentBuffer = parsed.cleaned.slice(fullContent.length);
                    } else {
                      // Unexpected, but safest is to replace our accumulated content.
                      fullContent = parsed.cleaned;
                      contentBuffer = "";
                    }
                  }
                  if (parsed.toolCalls.length > 0) {
                    accumulatedToolCalls.push(...parsed.toolCalls);
                    fullContent = parsed.cleaned;
                    contentBuffer = "";
                    break readLoop;
                  }
                  if (hasOpenFallbackToolCall(candidate)) {
                    // Wait for the tool markup to complete before streaming or flushing.
                    continue;
                  }
                }

                if (contentBuffer) {
                  fullContent += contentBuffer;
                  send({ type: "content", content: contentBuffer });
                  contentBuffer = "";
                }
              }

              // [AGENTIC] Stream Reasoning
              if (delta?.reasoning) {
                if (!firstTokenAt) {
                  firstTokenAt = Date.now();
                }
                fullReasoning += delta.reasoning;
                send({ type: "reasoning", content: delta.reasoning });
              }

              if (delta?.tool_calls) {
                if (!firstTokenAt) {
                  firstTokenAt = Date.now();
                }
                for (const toolDelta of delta.tool_calls) {
                  const index = toolDelta.index;

                  // Initialize if new
                  if (!accumulatedToolCalls[index]) {
                    accumulatedToolCalls[index] = {
                      id: toolDelta.id || "",
                      type: "function",
                      function: { name: "", arguments: "" }, // Start empty, let update logic handle name
                    };
                    // Notify client of new tool call starting
                    // Note: Name might be empty here if only ID came first, but typically name comes with ID or in first chunk
                    // We can defer sending "tool-input-start" until we have a name, or send update later.
                    // For now, if name is present in delta, it will be added below immediately.
                  }

                  // Update fields
                  if (toolDelta.id && !accumulatedToolCalls[index].id) {
                    accumulatedToolCalls[index].id = toolDelta.id;
                  }
                  if (toolDelta.function?.name) {
                    accumulatedToolCalls[index].function.name +=
                      toolDelta.function.name;

                    // If we just got the name (and it was empty before), we can emit the start event now if we haven't?
                    // Or just emit it every time? The frontend dedupes by ID so it's fine.
                    // But good practice:
                    send({
                      type: "tool-input-start",
                      toolCallId: accumulatedToolCalls[index].id,
                      toolName: accumulatedToolCalls[index].function.name,
                      state: "streaming",
                    });
                  }

                  // Stream arguments delta
                  if (toolDelta.function?.arguments) {
                    const argDelta = toolDelta.function.arguments;
                    accumulatedToolCalls[index].function.arguments += argDelta;
                    send({
                      type: "tool-input-delta",
                      toolCallId: accumulatedToolCalls[index].id,
                      inputTextDelta: argDelta,
                      argsSnapshot:
                        accumulatedToolCalls[index].function.arguments,
                    });
                  }
                }
              }

              // Stop reading once the model signals completion
              if (finishReason === "tool_calls" || finishReason === "stop") {
                break readLoop;
              }
            }
          }

          if (isAborted) {
            await reader.cancel();
            break;
          }

          if (requestStart) {
            const latencyMs = Date.now() - requestStart;
            const ttftMs =
              typeof firstTokenAt === "number"
                ? firstTokenAt - requestStart
                : null;
            if (lastUsage || latencyMs >= 0) {
              send({
                type: "usage",
                usage: lastUsage,
                metrics: {
                  latencyMs,
                  ttftMs,
                  modelId: responseModel ?? modelId ?? null,
                  finishReason,
                },
              });
            }
          }

          if (accumulatedToolCalls.length > 0) {
            await ctx.runMutation(internal.messages.internalSaveToolCalls, {
              messageId,
              toolCalls: accumulatedToolCalls,
            });

            for (const tc of accumulatedToolCalls) {
              let argsObj: any = {};
              try {
                argsObj = JSON.parse(tc.function.arguments || "{}");
              } catch (e) {
                console.error(
                  "[TOOL ARG PARSE ERROR]",
                  e,
                  tc.function.arguments,
                );
                // Fallback to empty object to prevent crash
              }

              // [AGENTIC] Notify client input is complete and tool is ready to run
              // We only emit tool-input-available to transition from streaming to a static "pending" state
              send({
                type: "tool-input-available",
                toolCallId: tc.id,
                toolName: tc.function.name,
                input: argsObj,
                state: "completed",
              });

              let result = "Error";
              const name = tc.function.name;

              // [COST CONTROL] Check per-turn limits before executing tools
              if (name === "get_current_time") {
                if (timeCheckCount >= MAX_TIME_CHECK_PER_TURN) {
                  toolLimitsReached = true;
                  result =
                    "Time check limit reached for this turn. Use existing information to answer.";
                } else {
                  timeCheckCount++;
                  result = new Date().toLocaleString("en-US", {
                    timeZone: "America/Jamaica",
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  });
                }
              } else if (name === "search_web") {
                if (webSearchCount >= MAX_WEB_SEARCH_PER_TURN) {
                  toolLimitsReached = true;
                  result =
                    "Maximum web searches reached for this turn. Use existing information to answer.";
                } else {
                  webSearchCount++;
                  const rawQuery =
                    typeof argsObj.query === "string" ? argsObj.query : "";
                  const searchQuery = rawQuery.trim();
                  if (!searchQuery) {
                    result = "Missing web search query";
                  } else {
                    const cacheKey = normalizeToolCacheText(searchQuery);
                    const cachedResult = await ctx.runQuery(
                      internal.toolCache.get,
                      {
                        namespace: toolCacheNamespaces.webSearch,
                        key: cacheKey,
                      },
                    );

                    if (cachedResult) {
                      result = cachedResult;
                      try {
                        const cachedOutput = JSON.parse(cachedResult);
                        send({
                          type: "tool-output-partially-available",
                          toolCallId: tc.id,
                          output: cachedOutput,
                        });
                      } catch {
                        // Keep cached text result even if structured payload parsing fails.
                      }
                    } else {
                      const jobOutcome = await enqueueToolJobAndWait<{
                        kind: "search_web";
                        textResult: string;
                        jsonResult: string;
                        searchResults: Array<{
                          title: string;
                          link: string;
                          snippet?: string;
                        }>;
                      }>(ctx, {
                        source: "chat_http",
                        toolName: "search_web",
                        args: { query: searchQuery },
                      });

                      if (jobOutcome.status === "completed") {
                        const searchResults = Array.isArray(
                          jobOutcome.result?.searchResults,
                        )
                          ? jobOutcome.result.searchResults
                          : [];
                        if (searchResults.length > 0) {
                          send({
                            type: "tool-output-partially-available",
                            toolCallId: tc.id,
                            output: searchResults,
                          });
                        }
                        result =
                          (typeof jobOutcome.result?.jsonResult === "string" &&
                          jobOutcome.result.jsonResult
                            ? jobOutcome.result.jsonResult
                            : JSON.stringify(searchResults)) || "[]";

                        try {
                          await ctx.runMutation(internal.toolCache.set, {
                            namespace: toolCacheNamespaces.webSearch,
                            key: cacheKey,
                            value: result,
                            ttlMs: toolCacheConfig.webSearchTtlMs,
                          });
                        } catch (cacheError) {
                          console.warn(
                            "[SEARCH_WEB_HTTP] Failed to write tool cache",
                            cacheError,
                          );
                        }
                      } else if (jobOutcome.status === "failed") {
                        emitToolBackpressure(
                          "search_web",
                          jobOutcome.backpressure,
                        );
                        result = `Search failed: ${jobOutcome.error}`;
                      } else {
                        emitToolBackpressure("search_web", jobOutcome.backpressure);
                        result =
                          "Live web search is under high load and still queued. Continue with known information for now.";
                      }
                    }
                  }
                }
              } else if (name === "search_products") {
                if (productSearchCount >= MAX_PRODUCT_SEARCH_PER_TURN) {
                  toolLimitsReached = true;
                  result =
                    "Maximum product searches reached for this turn. Use existing information to answer.";
                } else {
                  productSearchCount++;
                  try {
                    const normalized = normalizeEbaySearchArgs(argsObj);
                    if (!normalized.query) {
                      result = "Error: Missing product search query.";
                    } else {
                      const marketplaceId =
                        process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
                      let categoryId = normalized.categoryId;
                      if (!categoryId && normalized.categoryName) {
                        const resolvedCategoryId = await ctx.runQuery(
                          internal.ebayTaxonomy.findEbayCategoryId,
                          {
                            categoryName: normalized.categoryName,
                            marketplaceId,
                          },
                        );
                        if (typeof resolvedCategoryId === "string") {
                          categoryId = resolvedCategoryId;
                        }
                      }

                      const productCacheKey = buildProductSearchCacheKey({
                        query: normalized.query,
                        limit: normalized.limit,
                        categoryId,
                        categoryName: normalized.categoryName,
                        minPrice: normalized.minPrice,
                        maxPrice: normalized.maxPrice,
                        condition: normalized.condition,
                        shipping: normalized.shipping,
                        sellerRating: normalized.sellerRating,
                        location: normalized.location,
                        marketplaceId,
                      });

                      const cachedProductsRaw = await ctx.runQuery(
                        internal.toolCache.get,
                        {
                          namespace: toolCacheNamespaces.productSearch,
                          key: productCacheKey,
                        },
                      );

                      let cachedProducts: any[] | null = null;
                      if (cachedProductsRaw) {
                        try {
                          const parsed = JSON.parse(cachedProductsRaw);
                          if (Array.isArray(parsed)) {
                            cachedProducts = parsed;
                          }
                        } catch {
                          // Ignore malformed cache payload and continue to live fetch.
                        }
                      }

                      if (cachedProducts && cachedProducts.length > 0) {
                        const combined = dedupeProducts(cachedProducts);
                        await ctx.runMutation(
                          internal.messages.internalSaveProducts,
                          {
                            messageId,
                            products: combined,
                          },
                        );
                        send({
                          type: "tool-output-partially-available",
                          toolCallId: tc.id,
                          output: combined,
                        });
                        result = buildProductToolSummary(combined);
                      } else {
                        const globalSkipped =
                          globalSearchCount >= MAX_GLOBAL_SEARCH_PER_TURN;

                        if (globalSkipped) {
                          toolLimitsReached = true;
                        } else {
                          globalSearchCount++;
                        }

                        const globalLimit = Math.min(
                          12,
                          normalized.limit ?? 12,
                        );

                        const jobOutcome = await enqueueToolJobAndWait<{
                          kind: "search_products";
                          products: any[];
                        }>(ctx, {
                          source: "chat_http",
                          toolName: "search_products",
                          args: {
                            query: normalized.query,
                            limit: normalized.limit,
                            categoryId,
                            categoryName: normalized.categoryName,
                            minPrice: normalized.minPrice,
                            maxPrice: normalized.maxPrice,
                            condition: normalized.condition,
                            shipping: normalized.shipping,
                            sellerRating: normalized.sellerRating,
                            location: normalized.location,
                            marketplaceId,
                            includeGlobal: !globalSkipped,
                            globalLimit,
                          },
                        });

                        if (jobOutcome.status === "completed") {
                          const combined = Array.isArray(jobOutcome.result?.products)
                            ? dedupeProducts(jobOutcome.result.products)
                            : [];
                          result = buildProductToolSummary(combined);
                          if (globalSkipped) {
                            result += ` Global search limit reached (${MAX_GLOBAL_SEARCH_PER_TURN} per turn).`;
                          }

                          if (combined.length > 0) {
                            send({
                              type: "tool-output-partially-available",
                              toolCallId: tc.id,
                              output: combined,
                            });
                          }

                          if (combined.length > 0) {
                            await ctx.runMutation(
                              internal.messages.internalSaveProducts,
                              {
                                messageId,
                                products: combined,
                              },
                            );
                          }

                          if (combined.length > 0 && !globalSkipped) {
                            try {
                              await ctx.runMutation(internal.toolCache.set, {
                                namespace: toolCacheNamespaces.productSearch,
                                key: productCacheKey,
                                value: JSON.stringify(combined),
                                ttlMs: toolCacheConfig.productSearchTtlMs,
                              });
                            } catch (cacheError) {
                              console.warn(
                                "[SEARCH_PRODUCTS_HTTP] Failed to write tool cache",
                                cacheError,
                              );
                            }
                          }
                        } else if (jobOutcome.status === "failed") {
                          emitToolBackpressure(
                            "search_products",
                            jobOutcome.backpressure,
                          );
                          result = `Product Search Error: ${jobOutcome.error}`;
                        } else {
                          emitToolBackpressure(
                            "search_products",
                            jobOutcome.backpressure,
                          );
                          result =
                            "Product search is under high load and still queued. Continue with known information for now.";
                        }
                      }
                    }
                  } catch (err: any) {
                    result = `Product Search Error: ${err.message}`;
                  }
                }
              } else if (name === "search_global") {
                // Legacy tool support for older messages
                if (globalSearchCount >= MAX_GLOBAL_SEARCH_PER_TURN) {
                  toolLimitsReached = true;
                  result =
                    "Maximum global searches reached for this turn. Use existing information to answer.";
                } else {
                  globalSearchCount++;
                  try {
                    const query =
                      typeof argsObj.query === "string" ? argsObj.query : "";
                    const limit =
                      typeof argsObj.limit === "number" ? argsObj.limit : 12;
                    const location =
                      typeof argsObj.location === "string"
                        ? argsObj.location
                        : undefined;
                    if (!query) {
                      result = "Error: Missing global search query.";
                    } else {
                      const jobOutcome = await enqueueToolJobAndWait<{
                        kind: "search_global";
                        products: any[];
                      }>(ctx, {
                        source: "chat_http",
                        toolName: "search_global",
                        args: {
                          query,
                          limit,
                          location,
                        },
                      });

                      if (jobOutcome.status === "completed") {
                        const items = Array.isArray(jobOutcome.result?.products)
                          ? dedupeProducts(jobOutcome.result.products)
                          : [];
                        result = `Found ${items.length} global items. They have been displayed to the user.`;

                        if (items.length > 0) {
                          send({
                            type: "tool-output-partially-available",
                            toolCallId: tc.id,
                            output: items,
                          });
                        }

                        if (items.length > 0) {
                          await ctx.runMutation(
                            internal.messages.internalSaveProducts,
                            {
                              messageId,
                              products: items,
                            },
                          );
                        }
                      } else if (jobOutcome.status === "failed") {
                        emitToolBackpressure(
                          "search_global",
                          jobOutcome.backpressure,
                        );
                        result = `Global Search Error: ${jobOutcome.error}`;
                      } else {
                        emitToolBackpressure(
                          "search_global",
                          jobOutcome.backpressure,
                        );
                        result =
                          "Global search is under high load and still queued. Continue with known information for now.";
                      }
                    }
                  } catch (err: any) {
                    result = `Global Search Error: ${err.message}`;
                  }
                }
              }

              // Update the persistent database
              await ctx.runMutation(internal.messages.internalSend, {
                threadId,
                role: "tool",
                content: result,
                toolCallId: tc.id,
                name,
                modelId, // Pass modelId so frontend can query it correctly
              });
            }

            // [COST CONTROL] No system messages persisted; enforce limits via tool_choice below

            // [AGENTIC] Extract <think> tags from content to reasoning (for models that mix them)
            const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/);
            if (thinkMatch) {
              fullReasoning =
                (fullReasoning || "") + "\n" + thinkMatch[1].trim();
            }

            // [LATENCY FIX] Run independent mutations in parallel
            // Start creating the next message immediately while other mutations run
            const [, , , newMessageId] = await Promise.all([
              // Save empty content for tool-use message (discards filler)
              ctx.runMutation(internal.messages.internalAppendContent, {
                messageId,
                content: "", // Force empty content
              }),
              // Save reasoning if present
              fullReasoning
                ? ctx.runMutation(
                    internal.messages.internalSaveReasoningContent,
                    {
                      messageId,
                      reasoningContent: fullReasoning,
                    },
                  )
                : Promise.resolve(),
              // Mark current message as completed
              ctx.runMutation(internal.messages.internalUpdateStatus, {
                messageId,
                status: "completed",
              }),
              // Create NEXT assistant message for the response/answer (in parallel!)
              ctx.runMutation(
                internal.messages.internalInitializeAssistantMessage,
                {
                  threadId,
                  modelId,
                },
              ),
            ]);

            // Switch context to the new message
            messageId = newMessageId;
            fullContent = "";
            fullReasoning = "";
            contentBuffer = "";

            // Notify client to start listening to the new message
            send({ type: "start", messageId: newMessageId });

            shouldContinue = true;
            accumulatedToolCalls = [];
          } else {
            // If no tool calls were made in this turn, we are finished.
            shouldContinue = false;
          }
        }

        // Finalize
        if (!isAborted) {
          if (contentBuffer) {
            fullContent += contentBuffer;
            send({ type: "content", content: contentBuffer });
            contentBuffer = "";
          }
          // [LATENCY FIX] Run final save mutations in parallel
          await Promise.all([
            ctx.runMutation(internal.messages.internalAppendContent, {
              messageId,
              content: fullContent,
            }),
            fullReasoning
              ? ctx.runMutation(
                  internal.messages.internalSaveReasoningContent,
                  {
                    messageId,
                    reasoningContent: fullReasoning,
                  },
                )
              : Promise.resolve(),
            ctx.runMutation(internal.messages.internalUpdateStatus, {
              messageId,
              status: "completed",
            }),
          ]);
          send({ type: "done" });
        } else {
          await ctx.runMutation(internal.messages.internalUpdateStatus, {
            messageId,
            status: "aborted",
          });
        }
      } catch (err: any) {
        console.error("[SSE ERROR]", err);
        const errorCode =
          typeof err?.code === "string" ? err.code : "internal_error";
        const retryAfterMs =
          typeof err?.retryAfterMs === "number" ? err.retryAfterMs : undefined;
        if (requestStart) {
          send({
            type: "usage_error",
            error: err?.message || "Unknown error",
            code: errorCode,
            metrics: {
              latencyMs: Date.now() - requestStart,
              modelId: responseModel ?? modelId ?? null,
            },
          });
        }
        send({
          type: "error",
          error: err?.message || "Internal error",
          code: errorCode,
          retryAfterMs,
        });
      } finally {
        await releaseAdmission({
          ticket: admissionTicket,
          config: admissionConfig,
        });
        admissionTicket = null;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Sendcat-Chat-Gateway-Mode": runtime.gatewayMode ?? "legacy",
    },
  });
}

export const chat = httpAction(chatHandler);
