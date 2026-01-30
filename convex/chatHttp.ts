import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "./auth";
import {
  searchEbayItems,
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

export const chat = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Auth check
  const userId = await getAuthUserId(ctx);

  const body = await request.json();
  const { threadId, modelId, webSearch, sessionId: clientSessionId } = body;

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

        while (shouldContinue && cycle < MAX_CYCLES && !isAborted) {
          shouldContinue = false;
          cycle++;

          const messages = await ctx.runQuery(internal.messages.internalList, { threadId });
          const openRouterMessages = messages.map((m: any) => {
            const msg: any = { role: m.role };
            msg.content = m.content;
            if (m.toolCalls) msg.tool_calls = m.toolCalls;
            if (m.role === "tool") msg.tool_call_id = m.toolCallId;
            return msg;
          });

          const abortController = new AbortController();
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              models: [modelId ?? "google/gemini-2.0-flash-exp:free"],
              messages: openRouterMessages,
              tools: TOOLS.filter(t => t.function.name !== "search_web" || webSearch),
              tool_choice: "auto",
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

          while (!isAborted) {
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

              if (delta?.tool_calls) {
                accumulatedToolCalls = mergeToolCalls(accumulatedToolCalls, delta.tool_calls);
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
              send({ type: "tool-call", tool: tc.function.name, id: tc.id });

              let result = "Error";
              const name = tc.function.name;
              const argsObj = JSON.parse(tc.function.arguments);

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
                  
                  send({ 
                    type: "tool-output-partially-available", 
                    toolCallId: tc.id,
                    output: searchData.organic?.map((item: any) => ({
                      id: item.link,
                      title: item.title,
                      url: item.link,
                      snippet: item.snippet
                    }))
                  });

                  result = searchData.organic?.map((item: any) => `${item.title}: ${item.link}`).join("\n");
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
});
