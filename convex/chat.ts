import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "./auth";
import { getEbayItemDetails as fetchEbayDetails } from "./ebay";
import { getModelCapabilities } from "./lib/models";
import { normalizeEbaySearchArgs } from "./lib/ebaySearch";
import { getBasePrompt, getRegexFallbackPrompt } from "./lib/prompts";
import {
  executeChatProviderRequest,
  toClientSafeUpstreamError,
} from "./lib/chatProviderRouter";
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
  isRateLimitContentionError,
} from "./lib/rateLimit";
import {
  getAdmissionControlConfig,
  getChatGatewayFlags,
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

// Helper to accumulate tool calls from stream
function mergeToolCalls(acc: any[], defaults: any[]) {
  defaults.forEach((delta) => {
    const index = delta.index;
    if (!acc[index])
      acc[index] = {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };

    if (delta.id) acc[index].id = delta.id;
    if (delta.function?.name) acc[index].function.name += delta.function.name;
    if (delta.function?.arguments)
      acc[index].function.arguments += delta.function.arguments;
  });
  return acc;
}

// Helper to convert effort level to max_tokens for models that use that format
function getMaxTokensForEffort(effort: string): number {
  switch (effort) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 16384;
    default:
      return 4096;
  }
}

function buildProductToolSummary(products: Array<{ source?: string }>) {
  const ebayCount = products.filter((item) => item.source === "ebay").length;
  const globalCount = products.filter((item) => item.source === "global").length;
  const summaryParts: string[] = [];
  if (ebayCount > 0) summaryParts.push(`${ebayCount} items on eBay`);
  if (globalCount > 0) summaryParts.push(`${globalCount} global items`);
  if (summaryParts.length === 0) summaryParts.push("no items");
  return `I found ${summaryParts.join(" and ")}. They have been displayed to the user.`;
}


export const streamAnswer = action({
  args: {
    threadId: v.id("threads"),
    messageId: v.optional(v.id("messages")),
    sessionId: v.optional(v.id("streamSessions")),
    clientSessionId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    reasoningEffort: v.optional(v.string()),
    reasoningType: v.optional(
      v.union(v.literal("effort"), v.literal("max_tokens")),
    ),
    webSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"messages"> | null> => {
    const ABORT_POLL_MS = 50; // More frequent abort checks for faster stop response
    const MAX_CYCLES = 5;
    const BUFFER_FLUSH_SIZE = 50; // Flush every 50 chars for balance of speed and responsiveness
    const BUFFER_FLUSH_MS = 30; // Also flush every 30ms for smoother updates

    let cycle = 0;
    let currentMessageId: Id<"messages"> | null = null;
    let currentSessionId: Id<"streamSessions"> | null = args.sessionId ?? null;
    let shouldContinue = true;
    let isAborted = false;
    let activeController: AbortController | null = null;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let lastAbortCheck = Date.now();
    const toolResultsCache = new Map<string, string>();
    const toolUsageCounts = new Map<string, number>();
    let toolLimitsReached = false;

    // [COST CONTROL] Per-turn tool usage counters (reset each assistant turn)
    let webSearchCount = 0;
    let timeCheckCount = 0;
    let globalSearchCount = 0;
    let productSearchCount = 0;
    const MAX_WEB_SEARCH_PER_TURN = 2;
    const MAX_TIME_CHECK_PER_TURN = 1;
    const MAX_GLOBAL_SEARCH_PER_TURN = 2;
    const MAX_PRODUCT_SEARCH_PER_TURN = 2;

    // Verify thread ownership once before any internal reads
    await ctx.runQuery(internal.threads.internalVerifyThreadAccess, {
      threadId: args.threadId,
      sessionId: args.clientSessionId,
    });

    // Global generation rate limit for both authenticated and anonymous thread owners.
    const userId = await getAuthUserId(ctx);
    const principal = userId
      ? `user:${userId}`
      : args.clientSessionId
        ? `session:${args.clientSessionId}`
        : null;
    if (!principal) {
      throw new Error("Missing identity for rate limiting");
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
          source: "chat_action",
          bucket: input.bucket,
          key: input.key,
          outcome: input.outcome,
          reason: input.reason,
          retryAfterMs: input.retryAfterMs,
        });
      } catch {
        // Observability should not interrupt the request flow.
      }
    };
    const admissionConfig = getAdmissionControlConfig();
    const shouldSampleAllowedEvent = () =>
      admissionConfig.allowedEventSamplePct > 0 &&
      Math.random() * 100 < admissionConfig.allowedEventSamplePct;
    const chatGatewayFlags = getChatGatewayFlags();
    const admissionEventKey = `chat_admission:${principal}`;
    let admissionTicket: AdmissionTicket | null = null;
    let shouldFallbackToLegacyRateLimit = false;
    const effectiveAdmissionMode =
      chatGatewayFlags.admissionEnforce
        ? "enforce"
        : admissionConfig.shadowMode
          ? "shadow"
          : "enforce";
    if (admissionConfig.enabled) {
      const estimatedToolCalls = args.webSearch
        ? admissionConfig.estimatedToolCallsPerMessage
        : Math.max(admissionConfig.estimatedToolCallsPerMessage - 1, 0);
      const admissionResult = await checkAndAcquireAdmission({
        principalKey: principal,
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
        const shouldFailOpenOnRedisError =
          admissionResult.reason === "redis_unavailable" &&
          !chatGatewayFlags.failClosedOnRedisError;
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
          throw new Error(
            buildRateLimitErrorMessage(admissionResult.retryAfterMs),
          );
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
      const limitKey = `chat_stream:${principal}`;
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
          throw new Error("Too many requests. Please retry in a moment.");
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
        throw new Error(buildRateLimitErrorMessage(limit.retryAfterMs));
      }
    }

    // Content buffering for reduced DB writes
    let contentBuffer = "";
    let lastFlushTime = Date.now();

    // Flush buffered content to database
    const flushContentBuffer = async (): Promise<boolean> => {
      if (!contentBuffer || !currentMessageId) return false;
      const contentToFlush = contentBuffer;

      try {
        const result = await ctx.runMutation(
          internal.messages.internalAppendContent,
          {
            messageId: currentMessageId,
            content: contentToFlush,
          },
        );
        // Only clear buffer after successful write
        contentBuffer = "";
        lastFlushTime = Date.now();
        return result.aborted;
      } catch (error) {
        // Leave contentBuffer and currentMessageId intact so content isn't lost
        console.error("Failed to flush content buffer:", error);
        return false;
      }
    };

    const checkAbortStatus = async () => {
      if (!currentMessageId || isAborted) return;
      const status = currentSessionId
        ? await ctx.runQuery(internal.streamSessions.internalGetStatus, {
            sessionId: currentSessionId,
          })
        : await ctx.runQuery(internal.messages.internalGetStatus, {
            messageId: currentMessageId,
          });
      if (status === "aborted") {
        console.log("Abort detected for message/session", {
          messageId: currentMessageId,
          sessionId: currentSessionId,
        });
        isAborted = true;
        activeController?.abort();
        try {
          await activeReader?.cancel();
        } catch {}
      }
    };

    // Detect Model Capabilities
    const capabilities = getModelCapabilities(args.modelId);

    // Filter tools based on user preference AND model capability
    const activeTools = TOOLS.filter((t) => {
      // If model DOES NOT support native tools, we filter them all out
      // We will handle them via Regex Fallback if configured
      if (!capabilities.supportsTools) {
        return false;
      }

      if (t.function.name === "search_web" && !args.webSearch) {
        return false;
      }
      return true;
    });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      await releaseAdmission({
        ticket: admissionTicket,
        config: admissionConfig,
      });
      admissionTicket = null;
      const msgId = await ctx.runMutation(
        internal.messages.internalInitializeAssistantMessage,
        {
          threadId: args.threadId,
          modelId: args.modelId,
        },
      );
      await ctx.runMutation(internal.messages.internalAppendContent, {
        messageId: msgId,
        content: "Error: No API Key configured.",
      });
      await ctx.runMutation(internal.messages.internalUpdateStatus, {
        messageId: msgId,
        status: "error",
      });
      return msgId;
    }

    try {
      if (args.messageId) {
        currentMessageId = args.messageId;
        if (currentSessionId) {
          const status = await ctx.runQuery(
            internal.streamSessions.internalGetStatus,
            {
              sessionId: currentSessionId,
            },
          );
          if (status === "aborted") return currentMessageId;
        } else {
          const status = await ctx.runQuery(
            internal.messages.internalGetStatus,
            {
              messageId: currentMessageId,
            },
          );
          if (status === "aborted") return currentMessageId;
        }
      } else {
        // Create the assistant message once, before the loop
        currentMessageId = await ctx.runMutation(
          internal.messages.internalInitializeAssistantMessage,
          {
            threadId: args.threadId,
            modelId: args.modelId,
          },
        );
      }

      if (!currentSessionId && currentMessageId) {
        currentSessionId = await ctx.runMutation(
          internal.streamSessions.internalStart,
          {
            threadId: args.threadId,
            messageId: currentMessageId,
          },
        );
      }

      while (shouldContinue && cycle < MAX_CYCLES && !isAborted) {
        shouldContinue = false; // Default to stop unless tool calls happen
        cycle++;

        // Fetch Context
        const messages = await ctx.runQuery(internal.messages.internalList, {
          threadId: args.threadId,
        });

        // Prepare OpenRouter Payload - include the current message if it has partial content/tool calls
        const openRouterMessages = messages
          .filter((m: any) => {
            if (m._id === currentMessageId) {
              // Only include current message if it has actual content to show
              return !!(m.content || m.toolCalls?.length || m.reasoningContent);
            }
            return true;
          })
          .map((m: any) => {
            const msg: any = { role: m.role };

            // Content & Attachments
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
            } else {
              msg.content = m.content;
            }

            // Tool related fields
            if (m.toolCalls && m.toolCalls.length > 0) {
              msg.tool_calls = m.toolCalls;
              // Tool call messages should have null content per OpenRouter spec
              msg.content = null;
            }
            if (m.role === "tool") {
              msg.tool_call_id = m.toolCallId;
              msg.content = m.content;
            }

            // [NEW] Inject Product Context (Hidden from user, visible to AI)
            if (m.products && m.products.length > 0) {
              const productSummary = m.products
                .map(
                  (p: any, i: number) =>
                    `[${i + 1}] ${p.title} (${p.price}) - ${p.condition || "N/A"}`,
                )
                .join("\n");

              // Append to existing content (if any)
              const contextBlock = `\n\n<product_context>\nThe user sees the following items in a grid:\n${productSummary}\n</product_context>`;

              if (Array.isArray(msg.content)) {
                // If content is array (multimodal), append text block
                msg.content.push({ type: "text", text: contextBlock });
              } else {
                // If content is string, just append
                msg.content = (msg.content || "") + contextBlock;
              }
            }

            return msg;
          });

        // [AGENTIC] Inject Base System Prompt (Sendcat Assistant identity & guidelines)
        openRouterMessages.unshift({
          role: "system",
          content: getBasePrompt(),
        });

        // [AGENTIC LOGIC] Inject Regex Fallback Prompt for models without native tool support
        if (capabilities.toolFallback === "regex" && args.webSearch) {
          const fallbackPrompt = getRegexFallbackPrompt(capabilities);
          if (fallbackPrompt) {
            openRouterMessages.unshift({
              role: "system",
              content: fallbackPrompt,
            });
          }
        }

        // Create AbortController to cancel the fetch if user aborts
        const controller = new AbortController();
        activeController = controller;

        let response: Response;
        try {
          const upstream = await executeChatProviderRequest({
            ctx,
            apiKey,
            requestedModelId: args.modelId,
            abortSignal: controller.signal,
            headers: {
              "HTTP-Referer": "https://sendcat.app",
              "X-Title": "Sendcat",
            },
            payload: {
              messages: openRouterMessages,
              tools: activeTools.length > 0 ? activeTools : undefined,
              // Tool choice & parallel calls - only if tools exist
              ...(activeTools.length > 0
                ? {
                    tool_choice: toolLimitsReached ? "none" : "auto",
                    parallel_tool_calls: false,
                  }
                : {}),
              ...(args.reasoningEffort && args.reasoningType === "effort"
                ? { reasoning: { effort: args.reasoningEffort } }
                : args.reasoningEffort && args.reasoningType === "max_tokens"
                  ? {
                      reasoning: {
                        max_tokens: getMaxTokensForEffort(args.reasoningEffort),
                      },
                    }
                  : {}),
            },
          });
          response = upstream.response;
        } catch (error) {
          const upstreamError = toClientSafeUpstreamError(error);
          throw new Error(upstreamError.message);
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();

        let accumulatedToolCalls: any[] = [];
        let accumulatedReasoning = "";
        let finishReason: string | null = null;
        // Main streaming loop
        streamLoop: while (true) {
          let readResult: ReadableStreamReadResult<Uint8Array> | null;
          try {
            readResult = await Promise.race([
              reader.read(),
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), ABORT_POLL_MS),
              ),
            ]);
          } catch (err) {
            if (isAborted) break;
            throw err;
          }

          if (readResult === null) {
            await checkAbortStatus();
            if (isAborted) break;
            continue;
          }

          const { done, value } = readResult;
          if (done) break;

          if (Date.now() - lastAbortCheck >= ABORT_POLL_MS) {
            await checkAbortStatus();
            lastAbortCheck = Date.now();
            if (isAborted) break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((line) => line.trim() !== "");

          for (const line of lines) {
            if (isAborted) break streamLoop;

            if (Date.now() - lastAbortCheck >= ABORT_POLL_MS) {
              await checkAbortStatus();
              lastAbortCheck = Date.now();
              if (isAborted) break streamLoop;
            }

            if (line.startsWith("data: ")) {
              const dataStr = line.replace("data: ", "");
              if (dataStr === "[DONE]") break streamLoop;

              let data;
              try {
                data = JSON.parse(dataStr);
              } catch (e) {
                // Malformed SSE chunks are expected, skip them
                continue;
              }

              // Handle mid-stream errors (OpenRouter sends errors as SSE data after some tokens were sent)
              if (data.error) {
                console.error(`OpenRouter stream error: ${data.error.message}`);
                isAborted = true;
                controller.abort();
                try {
                  await reader.cancel();
                } catch {}
                break streamLoop;
              }

              const delta = data.choices[0]?.delta;
              const chunkFinishReason = data.choices[0]?.finish_reason;

              if (chunkFinishReason) {
                finishReason = chunkFinishReason;
              }

              // Handle Reasoning tokens
              if (delta?.reasoning) {
                accumulatedReasoning += delta.reasoning;
              }

              // Handle Content - buffer tokens and flush periodically
              if (delta?.content) {
                contentBuffer += delta.content;

                const functionCallParse =
                  parseFunctionCallsFromContent(contentBuffer);
                if (functionCallParse.toolCalls.length > 0) {
                  accumulatedToolCalls.push(...functionCallParse.toolCalls);
                  contentBuffer = "";
                  break streamLoop;
                }
                if (functionCallParse.cleaned !== contentBuffer) {
                  contentBuffer = functionCallParse.cleaned;
                }
                if (functionCallParse.hasOpenTag) {
                  // Wait for the closing tag before emitting anything
                  continue;
                }

                // [AGENTIC LOGIC] Regex Tool Parsing Fallback
                // Only check if enabled for this model to avoid perf hit on all models
                if (capabilities.toolFallback === "regex") {
                  const parsed = parseFallbackToolCallsFromContent(
                    contentBuffer,
                    { allowWebSearch: !!args.webSearch },
                  );
                  // Always strip fallback tool markup from assistant text (even if we
                  // fail to parse it into executable tool calls).
                  if (parsed.cleaned !== contentBuffer) {
                    contentBuffer = parsed.cleaned;
                  }
                  if (parsed.toolCalls.length > 0) {
                    accumulatedToolCalls.push(...parsed.toolCalls);
                    // Stop streaming and execute the tool(s) immediately.
                    break streamLoop;
                  }
                  // If a tool call looks like it's being streamed but isn't complete yet,
                  // don't flush partial markup to the DB. Wait for the closing bracket/tag.
                  if (hasOpenFallbackToolCall(contentBuffer)) {
                    continue;
                  }
                }

                // Check abort frequently during content accumulation
                await checkAbortStatus();
                if (isAborted) {
                  console.log(
                    "Aborting stream - user requested stop during content accumulation",
                  );
                  controller.abort();
                  try {
                    await reader.cancel();
                  } catch {}
                  break streamLoop;
                }

                // Flush if buffer is large enough or enough time has passed
                const shouldFlush =
                  contentBuffer.length >= BUFFER_FLUSH_SIZE ||
                  Date.now() - lastFlushTime >= BUFFER_FLUSH_MS;

                if (shouldFlush) {
                  const wasAborted = await flushContentBuffer();
                  if (wasAborted) {
                    console.log("Aborting stream - message was aborted");
                    isAborted = true;
                    controller.abort();
                    try {
                      await reader.cancel();
                    } catch {}
                    break streamLoop;
                  }
                }
              }

              // Handle Tool Calls
              if (delta?.tool_calls) {
                accumulatedToolCalls = mergeToolCalls(
                  accumulatedToolCalls,
                  delta.tool_calls,
                );
              }
            }
          }
        }

        // Flush any remaining buffered content before post-processing
        if (contentBuffer && !isAborted) {
          const wasAborted = await flushContentBuffer();
          if (wasAborted) {
            isAborted = true;
          } else if (contentBuffer) {
            // Flush failed (buffer wasn't cleared) — content is incomplete,
            // don't mark the message as completed
            console.error(
              "Final content flush failed, marking message as error",
            );
            isAborted = true;
          }
        }

        // Post-Stream Processing
        if (isAborted) {
          // Ensure the message is marked as aborted
          if (currentSessionId) {
            await ctx.runMutation(internal.streamSessions.internalAbort, {
              sessionId: currentSessionId,
            });
            await ctx.runMutation(internal.messages.internalUpdateStatus, {
              messageId: currentMessageId,
              status: "aborted",
            });
          } else {
            await ctx.runMutation(internal.messages.internalUpdateStatus, {
              messageId: currentMessageId,
              status: "aborted",
            });
          }
        }
        // Note: We don't mark as "completed" here anymore - we'll do it after checking for tool calls

        // Save reasoning content if any was accumulated
        if (accumulatedReasoning.trim()) {
          await ctx.runMutation(
            internal.messages.internalSaveReasoningContent,
            {
              messageId: currentMessageId,
              reasoningContent: accumulatedReasoning,
            },
          );
        }

        // Log non-standard finish reasons for debugging
        if (
          finishReason &&
          finishReason !== "stop" &&
          finishReason !== "tool_calls"
        ) {
          console.log(`Stream finished with reason: ${finishReason}`);
        }

        // Handle tool calls
        if (accumulatedToolCalls.length > 0 && !isAborted) {
          await ctx.runMutation(internal.messages.internalSaveToolCalls, {
            messageId: currentMessageId,
            toolCalls: accumulatedToolCalls,
          });

          // Execute Tools with Deduplication and Caching

          for (const tc of accumulatedToolCalls) {
            const name = tc.function.name;
            const argsStr = tc.function.arguments;
            let result = "Error executing tool";

            // Create a cache key based on tool name and arguments
            const cacheKey = `${name}:${argsStr}`;

            if (toolResultsCache.has(cacheKey)) {
              console.log(
                `[Cache Hit] Reusing result for tool: ${name} with query: ${argsStr}`,
              );
              result = toolResultsCache.get(cacheKey)!;
            } else {
              try {
                const usageCount = (toolUsageCounts.get(name) ?? 0) + 1;
                toolUsageCounts.set(name, usageCount);
                const argsObj = JSON.parse(argsStr);

                if (name === "get_current_time") {
                  // [COST CONTROL] Check per-turn limit for time checks
                  if (timeCheckCount >= MAX_TIME_CHECK_PER_TURN) {
                    toolLimitsReached = true;
                    result = `Time check limit reached (${MAX_TIME_CHECK_PER_TURN} per turn). Use existing information to answer.`;
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
                  // [COST CONTROL] Check per-turn limit for web searches
                  if (webSearchCount >= MAX_WEB_SEARCH_PER_TURN) {
                    toolLimitsReached = true;
                    result = `Web search limit reached (${MAX_WEB_SEARCH_PER_TURN} per turn). Use existing information to answer.`;
                  } else {
                    webSearchCount++;
                    const rawQuery =
                      typeof argsObj.query === "string" ? argsObj.query : "";
                    const searchQuery = rawQuery.trim();
                    if (!searchQuery) {
                      result = "Error: Missing search query.";
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
                      } else {
                        const jobOutcome = await enqueueToolJobAndWait<{
                          kind: "search_web";
                          textResult: string;
                        }>(ctx, {
                          source: "chat_action",
                          toolName: "search_web",
                          args: { query: searchQuery },
                        });

                        if (jobOutcome.status === "completed") {
                          result =
                            jobOutcome.result?.textResult ||
                            `Search completed for "${searchQuery}".`;
                          try {
                            await ctx.runMutation(internal.toolCache.set, {
                              namespace: toolCacheNamespaces.webSearch,
                              key: cacheKey,
                              value: result,
                              ttlMs: toolCacheConfig.webSearchTtlMs,
                            });
                          } catch (cacheError) {
                            console.warn(
                              "[SEARCH_WEB] Failed to write tool cache",
                              cacheError,
                            );
                          }
                        } else if (jobOutcome.status === "failed") {
                          if (jobOutcome.backpressure) {
                            result = `Search temporarily unavailable (${jobOutcome.backpressure.reason}). Please retry shortly.`;
                          } else {
                            result = `Search failed: ${jobOutcome.error}`;
                          }
                        } else {
                          result =
                            "Live web search is under high load and still queued. Continue with known information for now.";
                        }
                      }
                    }
                  }
                } else if (name === "search_products") {
                  // [COST CONTROL] Check per-turn limit for product searches
                  if (productSearchCount >= MAX_PRODUCT_SEARCH_PER_TURN) {
                    toolLimitsReached = true;
                    result = `Product search limit reached (${MAX_PRODUCT_SEARCH_PER_TURN} per turn). Use existing information to answer.`;
                  } else if (usageCount > 1) {
                    result =
                      "Skipped duplicate product search to control costs.";
                  } else {
                    productSearchCount++;
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
                          // Ignore malformed cache payload and fall through to live fetch.
                        }
                      }

                      if (cachedProducts && cachedProducts.length > 0) {
                        const combined = dedupeProducts(cachedProducts);
                        await ctx.runMutation(
                          internal.messages.internalSaveProducts,
                          {
                            messageId: currentMessageId!,
                            products: combined,
                          },
                        );
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
                          source: "chat_action",
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
                            await ctx.runMutation(
                              internal.messages.internalSaveProducts,
                              {
                                messageId: currentMessageId!,
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
                                "[SEARCH_PRODUCTS] Failed to write tool cache",
                                cacheError,
                              );
                            }
                          }
                        } else if (jobOutcome.status === "failed") {
                          if (jobOutcome.backpressure) {
                            result = `Product search temporarily unavailable (${jobOutcome.backpressure.reason}). Please retry shortly.`;
                          } else {
                            result = `Product search failed: ${jobOutcome.error}`;
                          }
                        } else {
                          result =
                            "Product search is under high load and still queued. Continue with known information for now.";
                        }
                      }
                    }
                  }
                } else if (name === "search_global") {
                  // Legacy tool support for older messages
                  if (globalSearchCount >= MAX_GLOBAL_SEARCH_PER_TURN) {
                    toolLimitsReached = true;
                    result = `Global search limit reached (${MAX_GLOBAL_SEARCH_PER_TURN} per turn). Use existing information to answer.`;
                  } else if (usageCount > 1) {
                    result = "Skipped duplicate global search to control costs.";
                  } else {
                    globalSearchCount++;
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
                        source: "chat_action",
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
                        result = `I found ${items.length} global items. They have been displayed to the user.`;

                        if (items.length > 0) {
                          await ctx.runMutation(
                            internal.messages.internalSaveProducts,
                            {
                              messageId: currentMessageId!,
                              products: items,
                            },
                          );
                        }
                      } else if (jobOutcome.status === "failed") {
                        if (jobOutcome.backpressure) {
                          result = `Global search temporarily unavailable (${jobOutcome.backpressure.reason}). Please retry shortly.`;
                        } else {
                          result = `Global search failed: ${jobOutcome.error}`;
                        }
                      } else {
                        result =
                          "Global search is under high load and still queued. Continue with known information for now.";
                      }
                    }
                  }
                }

                // Cache the result for this specific turn
                toolResultsCache.set(cacheKey, result);
              } catch (err: any) {
                result = `Error: ${err.message}`;
              }
            }

            // Create Tool Result Message
            await ctx.runMutation(internal.messages.internalSend, {
              threadId: args.threadId,
              role: "tool",
              content: result,
              toolCallId: tc.id,
              name: name,
            });
          }

          // [COST CONTROL] Inject system messages if tool limits reached
          if (webSearchCount >= MAX_WEB_SEARCH_PER_TURN) {
            await ctx.runMutation(internal.messages.internalSend, {
              threadId: args.threadId,
              role: "system",
              content: `You have reached the maximum web search limit (${MAX_WEB_SEARCH_PER_TURN}) for this turn. Stop searching and provide a comprehensive answer based on the information you already have. Do not attempt additional web searches.`,
              toolCallId: "limit-warning-web",
              name: "system",
            });
          }

          if (timeCheckCount >= MAX_TIME_CHECK_PER_TURN) {
            await ctx.runMutation(internal.messages.internalSend, {
              threadId: args.threadId,
              role: "system",
              content: `You have already checked the time. Provide your answer without additional time checks.`,
              toolCallId: "limit-warning-time",
              name: "system",
            });
          }

          if (productSearchCount >= MAX_PRODUCT_SEARCH_PER_TURN) {
            await ctx.runMutation(internal.messages.internalSend, {
              threadId: args.threadId,
              role: "system",
              content: `You have reached the maximum product search limit (${MAX_PRODUCT_SEARCH_PER_TURN}) for this turn. Stop searching and provide a comprehensive answer based on the information you already have.`,
              toolCallId: "limit-warning-products",
              name: "system",
            });
          }

          if (globalSearchCount >= MAX_GLOBAL_SEARCH_PER_TURN) {
            await ctx.runMutation(internal.messages.internalSend, {
              threadId: args.threadId,
              role: "system",
              content: `You have reached the maximum global search limit (${MAX_GLOBAL_SEARCH_PER_TURN}) for this turn. Stop searching and provide a comprehensive answer based on the information you already have.`,
              toolCallId: "limit-warning-global",
              name: "system",
            });
          }

          // Continue the loop to get the follow-up response
          // The next iteration will append to the SAME assistant message
          shouldContinue = true;
        } else if (!isAborted) {
          // No tool calls - mark the message as completed
          if (currentSessionId) {
            await ctx.runMutation(internal.streamSessions.internalComplete, {
              sessionId: currentSessionId,
            });
          } else {
            await ctx.runMutation(internal.messages.internalUpdateStatus, {
              messageId: currentMessageId,
              status: "completed",
            });
          }
          shouldContinue = false;
        }
      }

      // Final safety check: ensure message isn't left in streaming state
      if (currentSessionId) {
        const status = await ctx.runQuery(
          internal.streamSessions.internalGetStatus,
          {
            sessionId: currentSessionId,
          },
        );
        if (status === "streaming") {
          await ctx.runMutation(internal.streamSessions.internalComplete, {
            sessionId: currentSessionId,
          });
        }
      } else if (currentMessageId) {
        const msg = await ctx.runQuery(internal.messages.internalGetStatus, {
          messageId: currentMessageId,
        });
        if (msg === "streaming") {
          await ctx.runMutation(internal.messages.internalUpdateStatus, {
            messageId: currentMessageId,
            status: "completed",
          });
        }
      }

      return currentMessageId;
    } catch (err) {
      if (currentSessionId) {
        await ctx.runMutation(internal.streamSessions.internalError, {
          sessionId: currentSessionId,
        });
      } else if (currentMessageId) {
        await ctx.runMutation(internal.messages.internalUpdateStatus, {
          messageId: currentMessageId,
          status: "error",
        });
      }
      throw err;
    } finally {
      await releaseAdmission({
        ticket: admissionTicket,
        config: admissionConfig,
      });
    }
  },
});

export const getItemDetails = action({
  args: { itemId: v.string() },
  handler: async (_ctx, args) => {
    return await fetchEbayDetails(args.itemId);
  },
});
