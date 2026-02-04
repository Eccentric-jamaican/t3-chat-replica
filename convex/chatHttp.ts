import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { searchEbayItems } from "./ebay";
import { searchGlobalItems } from "./global";
import { getModelCapabilities } from "./lib/models";
import { normalizeEbaySearchArgs } from "./lib/ebaySearch";
import {
  getBasePrompt,
  getStrategyPrompt,
  getRegexFallbackPrompt,
} from "./lib/prompts";
import {
  dedupeProducts,
  parseFunctionCallsFromContent,
} from "./lib/toolHelpers";

 

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

export async function chatHandler(ctx: any, request: Request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Auth check
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json();
  const { threadId, modelId, webSearch } = body;

  if (!threadId) {
    return new Response("threadId is required", { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response("API Key not configured", { status: 500 });
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
        let requestStart: number | null = null;
        let firstTokenAt: number | null = null;
        let lastUsage: any = null;
        let responseModel: string | null = null;

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
          const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                models: [
                  modelId ?? "moonshotai/moonshot-v1-8k",
                  "openai/gpt-5",
                  "google/gemini-2.0-flash-exp:free",
                ],
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
                stream: true,
              }),
              signal: abortController.signal,
            },
          );

          // Controller is now handled by the outer listener

          if (!response.ok) throw new Error(`API error: ${response.status}`);
          if (!response.body) throw new Error("No response body");

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

              // [AGENTIC] Regex Fallback
              if (capabilities.toolFallback === "regex" && delta?.content) {
                const searchRegex = /\[\[SEARCH: (.*?)\]\]/;
                const match = fullContent.match(searchRegex);
                if (match) {
                  const query = match[1];
                  accumulatedToolCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                    type: "function",
                    function: {
                      name: "search_web",
                      arguments: JSON.stringify({ query }),
                    },
                  });
                  // Break reader loop to execute tool
                  break readLoop;
                }
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
                  result = new Date().toLocaleString();
                }
              } else if (name === "search_web") {
                if (webSearchCount >= MAX_WEB_SEARCH_PER_TURN) {
                  toolLimitsReached = true;
                  result =
                    "Maximum web searches reached for this turn. Use existing information to answer.";
                } else {
                  webSearchCount++;
                  const serperKey = process.env.SERPER_API_KEY;
                  if (!serperKey) {
                    result = "Serper API key missing";
                  } else {
                    const res = await fetch(
                      "https://google.serper.dev/search",
                      {
                        method: "POST",
                        headers: {
                          "X-API-KEY": serperKey,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ q: argsObj.query, num: 5 }),
                      },
                    );
                    const searchData = await res.json();

                    const searchResults = searchData.organic?.map(
                      (item: any) => ({
                        title: item.title,
                        link: item.link,
                        snippet: item.snippet,
                      }),
                    );

                    send({
                      type: "tool-output-partially-available",
                      toolCallId: tc.id,
                      output: searchResults,
                    });

                    // Save JSON for Rich UI and LLM structure
                    result = JSON.stringify(searchResults);
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

                      let ebayError: string | null = null;
                      let globalError: string | null = null;
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

                      const [ebayResult, globalResult] =
                        await Promise.allSettled([
                          searchEbayItems(normalized.query, {
                            limit: normalized.limit,
                            categoryId,
                            minPrice: normalized.minPrice,
                            maxPrice: normalized.maxPrice,
                            condition: normalized.condition,
                            shipping: normalized.shipping,
                            minSellerRating: normalized.sellerRating,
                            location: normalized.location,
                            marketplaceId,
                          }),
                          globalSkipped
                            ? Promise.resolve([])
                            : searchGlobalItems(normalized.query, {
                                limit: globalLimit,
                                location: normalized.location,
                              }),
                        ]);

                      const ebayItems =
                        ebayResult.status === "fulfilled"
                          ? ebayResult.value
                          : [];
                      if (ebayResult.status === "rejected") {
                        ebayError =
                          ebayResult.reason?.message || "Unknown eBay error";
                      }

                      const globalItems =
                        globalResult.status === "fulfilled"
                          ? globalResult.value
                          : [];
                      if (globalResult.status === "rejected") {
                        globalError =
                          globalResult.reason?.message ||
                          "Unknown global search error";
                      }

                      const combined = dedupeProducts([
                        ...ebayItems,
                        ...globalItems,
                      ]);

                      const summaryParts: string[] = [];
                      if (!ebayError) {
                        summaryParts.push(`${ebayItems.length} eBay items`);
                      }
                      if (!globalError && !globalSkipped) {
                        summaryParts.push(
                          `${globalItems.length} global items`,
                        );
                      }
                      if (summaryParts.length === 0) {
                        summaryParts.push("no items");
                      }

                      result = `Found ${summaryParts.join(
                        " and ",
                      )}. They have been displayed to the user.`;

                      if (globalSkipped) {
                        result += ` Global search limit reached (${MAX_GLOBAL_SEARCH_PER_TURN} per turn).`;
                      }
                      if (globalError) {
                        result += ` Global search failed: ${globalError}.`;
                      }
                      if (ebayError) {
                        result += ` eBay search failed: ${ebayError}.`;
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
                      const items = await searchGlobalItems(query, {
                        limit,
                        location,
                      });
                      result = `Found ${items.length} global items. They have been displayed to the user.`;
                      await ctx.runMutation(
                        internal.messages.internalSaveProducts,
                        {
                          messageId,
                          products: items,
                        },
                      );
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
        if (requestStart) {
          send({
            type: "usage_error",
            error: err?.message || "Unknown error",
            metrics: {
              latencyMs: Date.now() - requestStart,
              modelId: responseModel ?? modelId ?? null,
            },
          });
        }
        send({ type: "error", error: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const chat = httpAction(chatHandler);
