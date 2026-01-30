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

export async function chatHandler(ctx: any, request: Request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Auth check
  await getAuthUserId(ctx);

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
        const messageId = await ctx.runMutation(internal.messages.internalInitializeAssistantMessage, {
          threadId,
          modelId,
        });

        send({ type: "start", messageId });

        let cycle = 0;
        const MAX_CYCLES = 5;
        let shouldContinue = true;
        let fullContent = "";
        let fullReasoning = "";

        while (shouldContinue && cycle < MAX_CYCLES && !isAborted) {
          shouldContinue = false;
          cycle++;

          const messages = await ctx.runQuery(internal.messages.internalList, { threadId });
          const capabilities = getModelCapabilities(modelId);
          const openRouterMessages = messages.map((m: any) => {
            const msg: any = { role: m.role };
            msg.content = m.content;
            if (m.toolCalls) msg.tool_calls = m.toolCalls;
            if (m.role === "tool") msg.tool_call_id = m.toolCallId;
            return msg;
          });

          // [AGENTIC] Inject System Prompt for Fallback
          if (capabilities.toolFallback === "regex" && webSearch) {
             openRouterMessages.unshift({
               role: "system",
               content: `You currently lack native tool support. To search the web, you MUST output a search command in this EXACT format:
[[SEARCH: your search query here]]

Example:
User: What is the price of bitcoin?
Assistant: [[SEARCH: price of bitcoin]]

When you receive the search results, answer the user's question.`
             });
          } else if (modelId.toLowerCase().includes("grok") || modelId.toLowerCase().includes("x-ai")) {
             // [AGENTIC] Grok / xAI specific prompt to reduce verbosity
             openRouterMessages.unshift({
                role: "system",
                content: `You are a helpful assistant with access to tools.
When a user asks a question that requires a tool (like search_web), CALL THE TOOL DIRECTLY.
DO NOT explain what you are going to do. DO NOT output "Assistant: ...". DO NOT output "I need to call...".
Just output the tool call JSON.`
             });
          }

          const abortController = new AbortController();
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

          // Cancel OpenRouter fetch if client aborts
          request.signal.addEventListener("abort", () => abortController.abort());

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
                      id: `call_${Date.now()}`,
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
                      toolName: accumulatedToolCalls[index].function.name 
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
              const argsObj = JSON.parse(tc.function.arguments);
              
              // Notify client input is complete and tool is ready to run
              send({ 
                type: "tool-input-available", 
                toolCallId: tc.id, 
                toolName: tc.function.name,
                input: argsObj
              });

              // Also start the execution spinner (legacy event, kept for compatibility)
              send({ type: "tool-call", tool: tc.function.name, id: tc.id });

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
                 const items = await searchEbayItems(argsObj.query, argsObj.limit || 8);
                 result = `Found ${items.length} items on eBay.`;
                 await ctx.runMutation(internal.messages.internalSaveProducts, {
                    messageId,
                    products: items,
                 });
              }

              await ctx.runMutation(internal.messages.internalSend, {
                threadId,
                role: "tool",
                content: result,
                toolCallId: tc.id,
                name,
              });
            }
            shouldContinue = true;
          }
        }

        // Finalize
        if (!isAborted) {
          await ctx.runMutation(internal.messages.internalAppendContent, {
            messageId,
            content: fullContent,
          });

          // Save Reasoning (if any)
           if (fullReasoning) {
             await ctx.runMutation(internal.messages.internalSaveReasoningContent, {
               messageId,
               reasoningContent: fullReasoning,
             });
          }

          await ctx.runMutation(internal.messages.internalUpdateStatus, {
            messageId,
            status: "completed",
          });
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
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const chat = httpAction(chatHandler);
