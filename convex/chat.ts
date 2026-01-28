import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  searchEbayItems,
  getEbayItemDetails as fetchEbayDetails,
} from "./ebay";

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
      name: "search_ebay",
      description: "Search for real items on eBay to buy",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The product search query" },
          limit: {
            type: "number",
            description: "Number of results (max 36)",
            default: 36,
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

export const streamAnswer = action({
  args: {
    threadId: v.id("threads"),
    messageId: v.optional(v.id("messages")),
    sessionId: v.optional(v.id("streamSessions")),
    modelId: v.optional(v.string()),
    reasoningEffort: v.optional(v.string()),
    reasoningType: v.optional(
      v.union(v.literal("effort"), v.literal("max_tokens")),
    ),
    webSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"messages"> | null> => {
    const ABORT_POLL_MS = 100; // Reduced from 250ms for snappier response
    const MAX_CYCLES = 5;
    const BUFFER_FLUSH_SIZE = 80; // Flush after ~80 characters
    const BUFFER_FLUSH_MS = 150; // Or flush every 150ms

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

    // Content buffering for reduced DB writes
    let contentBuffer = "";
    let lastFlushTime = Date.now();

    // Flush buffered content to database
    const flushContentBuffer = async (): Promise<boolean> => {
      if (!contentBuffer || !currentMessageId) return false;
      const contentToFlush = contentBuffer;

      try {
        const result = await ctx.runMutation(internal.messages.internalAppendContent, {
          messageId: currentMessageId,
          content: contentToFlush,
        });
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
        ? await ctx.runQuery(api.streamSessions.getStatus, {
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

    // Filter tools based on user preference
    const activeTools = TOOLS.filter((t) => {
      if (t.function.name === "search_web" && !args.webSearch) return false;
      return true;
    });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
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
          const status = await ctx.runQuery(api.streamSessions.getStatus, {
            sessionId: currentSessionId,
          });
          if (status === "aborted") return currentMessageId;
        } else {
          const status = await ctx.runQuery(internal.messages.internalGetStatus, {
            messageId: currentMessageId,
          });
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
        currentSessionId = await ctx.runMutation(internal.streamSessions.internalStart, {
          threadId: args.threadId,
          messageId: currentMessageId,
        });
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
              const content = [
                { type: "text", text: m.content || "" },
              ] as any[];
              m.attachments.forEach((att: any) => {
                if (att.url) {
                  if (
                    att.type.startsWith("image/") ||
                    att.type === "application/pdf"
                  ) {
                    content.push({
                      type: "image_url",
                      image_url: { url: att.url },
                    });
                  }
                }
              });
              msg.content = content;
            } else {
              msg.content = m.content;
            }

            // Tool related fields
            if (m.toolCalls) {
              msg.tool_calls = m.toolCalls;
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

        // Create AbortController to cancel the fetch if user aborts
        const controller = new AbortController();
        activeController = controller;

        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://Sendcat",
              "X-Title": "T3 Chat Replica",
            },
            body: JSON.stringify({
              model: args.modelId ?? "google/gemini-2.0-flash-exp:free",
              messages: openRouterMessages,
              tools: activeTools.length > 0 ? activeTools : undefined,
              // Note: tool_choice is not supported by all OpenRouter providers, so we omit it
              ...(args.reasoningEffort && args.reasoningType === "effort"
                ? { reasoning: { effort: args.reasoningEffort } }
                : args.reasoningEffort && args.reasoningType === "max_tokens"
                  ? {
                      reasoning: {
                        max_tokens: getMaxTokensForEffort(args.reasoningEffort),
                      },
                    }
                  : {}),
              stream: true,
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok)
          throw new Error(`OpenRouter API error: ${await response.text()}`);
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
            console.error("Final content flush failed, marking message as error");
            isAborted = true;
          }
        }

        // Post-Stream Processing
        if (isAborted) {
          // Ensure the message is marked as aborted
          if (currentSessionId) {
            await ctx.runMutation(api.streamSessions.abort, {
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
          await ctx.runMutation(internal.messages.internalSaveReasoningContent, {
            messageId: currentMessageId,
            reasoningContent: accumulatedReasoning,
          });
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
                  result = new Date().toLocaleString();
                } else if (name === "search_web") {
                  const serperKey = process.env.SERPER_API_KEY;
                  if (!serperKey) {
                    result =
                      "Error: SERPER_API_KEY not configured in environment variables.";
                  } else {
                    const res = await fetch(
                      "https://google.serper.dev/search",
                      {
                        method: "POST",
                        headers: {
                          "X-API-KEY": serperKey,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ q: argsObj.query }),
                      },
                    );

                    if (!res.ok) {
                      result = JSON.stringify({ error: res.statusText });
                    } else {
                      const data = await res.json();
                      result = JSON.stringify(data.organic?.slice(0, 5) || []);
                    }
                  }
                } else if (name === "search_ebay") {
                  if (usageCount > 1) {
                    result = "Skipped duplicate eBay search to control costs.";
                  } else {
                    const parsedLimit = Number.parseInt(
                      String(argsObj.limit),
                      10,
                    );
                    const safeLimit = Number.isFinite(parsedLimit)
                      ? Math.max(1, Math.min(36, parsedLimit))
                      : 36;
                    const items = await searchEbayItems(
                      argsObj.query,
                      safeLimit,
                    );

                    if (process.env.EBAY_ENV !== "production") {
                      console.log(
                        `eBay found ${items.length} items for "${argsObj.query}"`,
                      );
                    }

                    result = `I found ${items.length} items on eBay. They have been displayed to the user.`;

                    await ctx.runMutation(internal.messages.internalSaveProducts, {
                      messageId: currentMessageId!,
                      products: items,
                    });
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

          // Continue the loop to get the follow-up response
          // The next iteration will append to the SAME assistant message
          shouldContinue = true;
        } else if (!isAborted) {
          // No tool calls - mark the message as completed
          if (currentSessionId) {
            await ctx.runMutation(api.streamSessions.complete, {
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
        const status = await ctx.runQuery(api.streamSessions.getStatus, {
          sessionId: currentSessionId,
        });
        if (status === "streaming") {
          await ctx.runMutation(api.streamSessions.complete, {
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
        await ctx.runMutation(api.streamSessions.error, {
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
      // no-op cleanup
    }
  },
});

export const getItemDetails = action({
  args: { itemId: v.string() },
  handler: async (_ctx, args) => {
    return await fetchEbayDetails(args.itemId);
  },
});
