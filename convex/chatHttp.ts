import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import {
  searchEbayItems,
} from "./ebay";
import { getModelCapabilities } from "./lib/models";

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
        let messageId = await ctx.runMutation(internal.messages.internalInitializeAssistantMessage, {
          threadId,
          modelId,
        });

        send({ type: "start", messageId });

        let cycle = 0;
        const MAX_CYCLES = 2; // Cap tool-calling iterations to prevent excessive searches
        let shouldContinue = true;
        let fullContent = "";
        let fullReasoning = "";

        let currentAbortController: AbortController | null = null;
        request.signal.addEventListener("abort", () => {
           currentAbortController?.abort();
        });

        while (shouldContinue && cycle < MAX_CYCLES && !isAborted) {
          shouldContinue = false;
          cycle++;

          const messages = await ctx.runQuery(internal.messages.internalList, { threadId });
          const capabilities = getModelCapabilities(modelId);
          const openRouterMessages = messages.map((m: any) => {
            const msg: any = { role: m.role };
            msg.content = m.content;
            if (m.toolCalls && m.toolCalls.length > 0) {
              msg.tool_calls = m.toolCalls;
              // [AGENTIC] Sanitize History: If message has tools, strip conversational filler content
              // This prevents "I don't have info" text from confusing the model in the next turn
              msg.content = ""; 
            }
            if (m.role === "tool") msg.tool_call_id = m.toolCallId;
            return msg;
          });

          // [AGENTIC] Strategy-Based System Prompt Injection
          if (capabilities.promptStrategy === "standard") {
             openRouterMessages.unshift({
                role: "system",
                content: `When you decide to use a tool, DO NOT output any text content (like "I will search..." or "Let me check..."). Just output the tool call directly.`
             });
          } else if (capabilities.promptStrategy === "reasoning") {
             openRouterMessages.unshift({
                role: "system",
                content: `You are a reasoning model. Output your internal thought process within <think> tags. When you decide to use a tool, output the tool call JSON immediately after the thinking block. Do not output conversational filler outside the <think> tags.`
             });
          }

          if (capabilities.toolFallback === "regex" && webSearch) {
             openRouterMessages.unshift({
               role: "system",
               content: `You currently lack native tool support. To search the web, you MUST output a search command in this EXACT format and NOTHING ELSE:
[[SEARCH: your search query here]]

Example:
User: What is the price of bitcoin?
Assistant: [[SEARCH: price of bitcoin]]

When you receive the search results, answer the user's question. DO NOT repeat the [[SEARCH: ...]] command once you have results.`
             });
          }

          const abortController = new AbortController();
          currentAbortController = abortController;
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              models: [modelId ?? "moonshotai/moonshot-v1-8k", "openai/gpt-5", "google/gemini-2.0-flash-exp:free"],
              messages: openRouterMessages,
              // [AGENTIC] Filter by capability
              tools: getModelCapabilities(modelId).supportsTools 
                ? TOOLS.filter(t => t.function.name !== "search_web" || webSearch)
                : undefined,
              ...(getModelCapabilities(modelId).supportsTools ? { 
                tool_choice: "auto",
                parallel_tool_calls: false,
              } : {}),
              stream: true,
            }),
            signal: abortController.signal,
          });

          // Controller is now handled by the outer listener

          if (!response.ok) throw new Error(`API error: ${response.status}`);
          if (!response.body) throw new Error("No response body");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulatedToolCalls: any[] = [];

          readLoop: while (!isAborted) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter(l => l.trim().startsWith("data: "));

            for (const line of lines) {
              const dataStr = line.replace("data: ", "");
              if (dataStr === "[DONE]") break;

              let data;
              try { data = JSON.parse(dataStr); } catch { continue; }

              const delta = data.choices[0]?.delta;
              
              if (delta?.content) {
                fullContent += delta.content;
                send({ type: "content", content: delta.content });
              }

              // [AGENTIC] Stream Reasoning
              if (delta?.reasoning) {
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
                      function: { name: "search_web", arguments: JSON.stringify({ query }) }
                    });
                    // Break reader loop to execute tool
                    break readLoop; 
                 }
              }

              if (delta?.tool_calls) {
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
                    accumulatedToolCalls[index].function.name += toolDelta.function.name;
                    
                    // If we just got the name (and it was empty before), we can emit the start event now if we haven't?
                    // Or just emit it every time? The frontend dedupes by ID so it's fine.
                    // But good practice:
                    send({ 
                      type: "tool-input-start", 
                      toolCallId: accumulatedToolCalls[index].id, 
                      toolName: accumulatedToolCalls[index].function.name,
                      state: "streaming"
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
                      argsSnapshot: accumulatedToolCalls[index].function.arguments
                    });
                  }
                }
              }
            }
          }

          if (isAborted) {
            await reader.cancel();
            break;
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
                console.error("[TOOL ARG PARSE ERROR]", e, tc.function.arguments);
                // Fallback to empty object to prevent crash
              }
              
              // [AGENTIC] Notify client input is complete and tool is ready to run
              // We only emit tool-input-available to transition from streaming to a static "pending" state
              send({ 
                type: "tool-input-available", 
                toolCallId: tc.id, 
                toolName: tc.function.name,
                input: argsObj,
                state: "completed"
              });

              let result = "Error";
              const name = tc.function.name;

              if (name === "get_current_time") {
                result = new Date().toLocaleString();
              } else if (name === "search_web") {
                const serperKey = process.env.SERPER_API_KEY;
                if (!serperKey) {
                   result = "Serper API key missing";
                } else {
                  const res = await fetch("https://google.serper.dev/search", {
                    method: "POST",
                    headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
                    body: JSON.stringify({ q: argsObj.query, num: 5 }),
                  });
                  const searchData = await res.json();
                  
                  const searchResults = searchData.organic?.map((item: any) => ({
                      title: item.title,
                      link: item.link,
                      snippet: item.snippet
                  }));

                  send({ 
                    type: "tool-output-partially-available", 
                    toolCallId: tc.id,
                    output: searchResults
                  });

                  // Save JSON for Rich UI and LLM structure
                  result = JSON.stringify(searchResults);
                }
              } else if (name === "search_ebay") {
                 try {
                   const items = await searchEbayItems(argsObj.query, argsObj.limit || 8);
                   result = `Found ${items.length} items on eBay: ${JSON.stringify(items.map((i: any) => ({ title: i.title, price: i.price })))}`;
                   await ctx.runMutation(internal.messages.internalSaveProducts, {
                      messageId,
                      products: items,
                   });
                 } catch (err: any) {
                   result = `eBay Search Error: ${err.message}`;
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

            // [AGENTIC] Extract <think> tags from content to reasoning (for models that mix them)
            const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/);
            if (thinkMatch) {
               fullReasoning = (fullReasoning || "") + "\n" + thinkMatch[1].trim();
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
                ? ctx.runMutation(internal.messages.internalSaveReasoningContent, {
                    messageId,
                    reasoningContent: fullReasoning,
                  })
                : Promise.resolve(),
              // Mark current message as completed
              ctx.runMutation(internal.messages.internalUpdateStatus, {
                messageId,
                status: "completed",
              }),
              // Create NEXT assistant message for the response/answer (in parallel!)
              ctx.runMutation(internal.messages.internalInitializeAssistantMessage, {
                threadId,
                modelId,
              }),
            ]);
            
            // Switch context to the new message
            messageId = newMessageId;
            fullContent = "";
            fullReasoning = "";
            
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
          // [LATENCY FIX] Run final save mutations in parallel
          await Promise.all([
            ctx.runMutation(internal.messages.internalAppendContent, {
              messageId,
              content: fullContent,
            }),
            fullReasoning
              ? ctx.runMutation(internal.messages.internalSaveReasoningContent, {
                  messageId,
                  reasoningContent: fullReasoning,
                })
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
      "Connection": "keep-alive",
    },
  });
}

export const chat = httpAction(chatHandler);
