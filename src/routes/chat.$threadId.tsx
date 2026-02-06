import {
  createFileRoute,
  useNavigate,
  Link,
  ClientOnly,
} from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { NotFoundPage } from "../components/layout/NotFoundPage";
import { useIsMobile } from "../hooks/useIsMobile";
import { ChatInput, type ChatInputHandle } from "../components/chat/ChatInput";
import { useQuery, useMutation, useAction, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Edit3,
  Copy,
  GitBranch,
  RotateCcw,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { LandingHero } from "../components/chat/LandingHero";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Markdown } from "../components/chat/Markdown";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { StreamingMessage } from "../components/chat/StreamingMessage";
import { MessageActionMenu } from "../components/chat/MessageActionMenu";
import { MessageEditInput } from "../components/chat/MessageEditInput";
import { MessageMetadata } from "../components/chat/MessageMetadata";
import { ProductDrawer } from "../components/product/ProductDrawer";
import { ProductExpandedView } from "../components/product/ProductExpandedView";
import { SelectionActionBar } from "../components/product/SelectionActionBar";
import { v4 as uuidv4 } from "uuid";
import { type Product } from "../data/mockProducts";
import { trackEvent } from "../lib/analytics";
import { useVirtualizer } from "@tanstack/react-virtual";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to get a display name from model ID
function getModelDisplayName(modelId: string): string {
  // Extract the model name from the ID (e.g., "openai/gpt-5.2" -> "GPT-5.2")
  const modelMap: Record<string, string> = {
    "google/gemini-2.0-flash-exp:free": "Gemini 2.0 Flash",
    "google/gemini-flash-1.5": "Gemini 1.5 Flash",
    "google/gemini-pro-1.5": "Gemini 1.5 Pro",
    "anthropic/claude-3-opus": "Claude 3 Opus",
    "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet",
    "anthropic/claude-3-haiku": "Claude 3 Haiku",
    "openai/gpt-4o": "GPT-4o",
    "openai/gpt-4o-mini": "GPT-4o Mini",
    "openai/gpt-4-turbo": "GPT-4 Turbo",
    "openai/o1-mini": "o1-mini",
    "openai/o1-preview": "o1-preview",
    "deepseek/deepseek-chat": "DeepSeek V3",
    "deepseek/deepseek-r1": "DeepSeek R1",
    "meta-llama/llama-3.3-70b-instruct": "Llama 3.3 70B",
  };

  if (modelMap[modelId]) return modelMap[modelId];

  // Fallback: extract name from ID
  const parts = modelId.split("/");
  const name = parts[parts.length - 1]
    .replace(/:free$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
  return name;
}

// Helper to group consecutive assistant messages for unified display
type MessageGroup = {
  type: "user" | "assistant_group";
  messages: any[];
};

function groupConsecutiveAssistantMessages(messages: any[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentAssistantGroup: any[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      currentAssistantGroup.push(msg);
    } else {
      // Flush any pending assistant group
      if (currentAssistantGroup.length > 0) {
        groups.push({
          type: "assistant_group",
          messages: currentAssistantGroup,
        });
        currentAssistantGroup = [];
      }
      // Add user message as its own group
      groups.push({ type: "user", messages: [msg] });
    }
  }

  // Flush final assistant group if any
  if (currentAssistantGroup.length > 0) {
    groups.push({ type: "assistant_group", messages: currentAssistantGroup });
  }

  return groups;
}

type ChatSearchParams = {
  productId?: string;
};

export const Route = createFileRoute("/chat/$threadId")({
  validateSearch: (search: Record<string, unknown>): ChatSearchParams => ({
    productId:
      typeof search.productId === "string" ? search.productId : undefined,
  }),
  ssr: false,
  component: ChatRoute,
});

function ChatRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-background text-foreground" />}>
      <ChatPage />
    </ClientOnly>
  );
}

function ChatPage() {
  const { threadId } = Route.useParams();
  const { productId } = Route.useSearch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  useEffect(() => {
    if (!threadId) return;
    trackEvent("thread_opened", { thread_id: threadId });
  }, [threadId]);

  // Wait for Convex auth to be ready before querying messages
  const { isLoading: isConvexAuthLoading } = useConvexAuth();

  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessionId(localStorage.getItem("sendcat_session_id") || undefined);
    setSessionReady(true);
  }, []);

  // Skip query while Convex auth is loading to prevent "Access denied" on reload
  const messages = useQuery(
    api.messages.list,
    isConvexAuthLoading || !sessionReady
      ? "skip"
      : { threadId: threadId as any, sessionId },
  );
  const thread = useQuery(
    api.threads.get,
    isConvexAuthLoading || !sessionReady
      ? "skip"
      : { id: threadId as any, sessionId },
  );
  const createThread = useMutation(api.threads.create);
  const sendMessage = useMutation(api.messages.send);
  const streamAnswer = useAction(api.chat.streamAnswer);

  const toolOutputsByCallId = useMemo(() => {
    const map: Record<string, string> = {};
    if (!messages) return map;
    for (const msg of messages as any[]) {
      if (msg?.role !== "tool") continue;
      if (!msg.toolCallId) continue;
      if (typeof msg.content !== "string") continue;
      map[msg.toolCallId] = msg.content;
    }
    return map;
  }, [messages]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  // Products drawer state
  const [expandedProducts, setExpandedProducts] = useState<Product[] | null>(
    null,
  );
  const productLookup = useMemo(() => {
    const lookup = new Map<string, Product>();
    messages?.forEach((message: any) => {
      if (!Array.isArray(message.products)) return;
      message.products.forEach((product: Product) => {
        if (!product?.id || lookup.has(product.id)) return;
        lookup.set(product.id, product);
      });
    });
    return lookup;
  }, [messages]);

  const handleOpenExpanded = (products: Product[]) => {
    setExpandedProducts(products);
    setIsExpandedOpen(true);
  };

  const handleCloseExpanded = () => {
    setExpandedProducts(null);
    setIsExpandedOpen(false);
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [isExpandedOpen, setIsExpandedOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const chatInputRef = useRef<ChatInputHandle>(null);

  /* handleOpenExpandedView was unused and removed */

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast("Copied to clipboard!", {
      icon: (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black">
          <Check size={12} className="stroke-[3] text-white" />
        </div>
      ),
      duration: 2000,
      className: "font-medium",
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Common logic to create a branch from a specific message point
  const createBranch = async (userMessageId: string, modelId?: string) => {
    if (!messages) return;

    try {
      // Find the user message and all messages before it
      const messageIndex = messages.findIndex(
        (m: any) => m._id === userMessageId,
      );
      if (messageIndex === -1) return;

      const messagesToCopy = messages.slice(0, messageIndex + 1);
      const userMessage = messagesToCopy[messageIndex];

      // Create a new thread with parent relationship
      let branchSessionId = localStorage.getItem("sendcat_session_id");
      if (!branchSessionId) {
        branchSessionId = uuidv4();
        localStorage.setItem("sendcat_session_id", branchSessionId);
      }

      const selectedModel =
        modelId ||
        localStorage.getItem("t3_selected_model") ||
        "google/gemini-2.0-flash-exp:free";

      // Determine the correct parent thread ID (avoid unnecessary nesting)
      let finalParentThreadId = threadId;
      if (thread?.parentThreadId) {
        // Simple heuristic for sibling branching
        finalParentThreadId = thread.parentThreadId as any;
      }

      const newThreadId = await createThread({
        sessionId: branchSessionId,
        modelId: selectedModel,
        title: userMessage.content.slice(0, 40),
        parentThreadId: finalParentThreadId as any,
      });

      // Copy previous messages to the new thread
      for (const msg of messagesToCopy) {
        if (msg.role === "user" || msg.role === "assistant") {
          await sendMessage({
            threadId: newThreadId,
            content: msg.content,
            role: msg.role,
            sessionId: branchSessionId,
            attachments: msg.attachments?.map((a: any) => ({
              storageId: a.storageId,
              type: a.type,
              name: a.name,
              size: a.size,
            })),
          });
        }
      }

      // Generate new response in the branched thread
      const modelLower = selectedModel.toLowerCase();
      const supportsEffortReasoning =
        modelLower.includes("/o1") ||
        modelLower.includes("/o3") ||
        modelLower.includes("/gpt-5") ||
        modelLower.includes("grok");

      const supportsMaxTokensReasoning =
        (modelLower.includes("gemini") && modelLower.includes("thinking")) ||
        modelLower.includes("claude-3.7") ||
        modelLower.includes("claude-sonnet-4") ||
        modelLower.includes("claude-4") ||
        (modelLower.includes("qwen") && modelLower.includes("thinking")) ||
        modelLower.includes("deepseek-r1") ||
        modelLower.includes("kimi");

      const savedReasoning = localStorage.getItem("t3_reasoning_effort");
      const reasoningEffort =
        (supportsEffortReasoning || supportsMaxTokensReasoning) &&
        savedReasoning
          ? (savedReasoning as "low" | "medium" | "high")
          : undefined;
      const reasoningType = supportsEffortReasoning
        ? "effort"
        : supportsMaxTokensReasoning
          ? "max_tokens"
          : undefined;

      // CRITICAL: Navigate and notify IMMEDIATELY before starting the slow stream
      navigate({ to: "/chat/$threadId", params: { threadId: newThreadId } });
      toast.success("Branched to new conversation");

      // Regenerate response in the background (server handles the stream)
      await streamAnswer({
        threadId: newThreadId,
        modelId: selectedModel,
        webSearch: false,
        reasoningEffort,
        reasoningType,
      });
    } catch (error) {
      console.error("Failed to create branch:", error);
      toast.error("Failed to start new branch");
    }
  };

  const handleRetry = async (userMessageId: string, modelId?: string) => {
    if (retryingMessageId === userMessageId) return;
    setRetryingMessageId(userMessageId);
    await createBranch(userMessageId, modelId ?? undefined);
    setRetryingMessageId(null);
  };

  const handleBranch = async (userMessageId: string, modelId?: string) => {
    if (branchingMessageId === userMessageId) return;
    setBranchingMessageId(userMessageId);
    await createBranch(userMessageId, modelId ?? undefined);
    setBranchingMessageId(null);
  };

  const isEmpty = messages !== undefined && messages.length === 0;

  const filteredMessages = useMemo(() => {
    return (
      messages?.filter((msg: any) => {
        if (msg.role === "tool") return false;
        if (
          msg.role === "assistant" &&
          msg.status === "aborted" &&
          !msg.content?.trim() &&
          !msg.toolCalls?.length &&
          !msg.products?.length
        ) {
          return false;
        }
        return true;
      }) ?? []
    );
  }, [messages]);

  const groupedMessages = useMemo(() => {
    return groupConsecutiveAssistantMessages(filteredMessages);
  }, [filteredMessages]);

  const forceVirtualizeMessages =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("virt") === "1";

  const shouldVirtualizeMessages =
    forceVirtualizeMessages || groupedMessages.length > 80;

  type VirtualBlock =
    | { type: "parent-link"; parentThreadId: string }
    | { type: "group"; group: MessageGroup; groupIndex: number }
    | { type: "anchor" };

  const virtualBlocks: VirtualBlock[] = useMemo(() => {
    const blocks: VirtualBlock[] = [];
    if (thread?.parentThreadId) {
      blocks.push({ type: "parent-link", parentThreadId: thread.parentThreadId });
    }
    groupedMessages.forEach((group, groupIndex) => {
      blocks.push({ type: "group", group, groupIndex });
    });
    // Keep a stable "bottom" target for scroll-to-bottom behavior.
    blocks.push({ type: "anchor" });
    return blocks;
  }, [thread?.parentThreadId, groupedMessages]);

  const messageVirtualizer = useVirtualizer({
    count: shouldVirtualizeMessages ? virtualBlocks.length : 0,
    getScrollElement: () => messageScrollRef.current,
    estimateSize: (index) => {
      const block = virtualBlocks[index];
      if (!block) return 220;
      if (block.type === "anchor") return 1;
      if (block.type === "parent-link") return 56;
      return block.group?.type === "user" ? 120 : 260;
    },
    overscan: 8,
  });

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (shouldVirtualizeMessages) {
        const lastIndex = virtualBlocks.length - 1;
        messageVirtualizer.scrollToIndex(lastIndex, {
          align: "end",
          // TanStack Virtual warns that smooth scrolling is not fully supported with dynamic measurement.
          // "auto" is reliable and avoids noisy console warnings in long threads.
          behavior: "auto",
        });
        return;
      }

      messagesEndRef.current?.scrollIntoView({ behavior });
    },
    [messageVirtualizer, shouldVirtualizeMessages, virtualBlocks.length],
  );

  // Only scroll when a new message is added, not during streaming content updates.
  useEffect(() => {
    if (messages && messages.length > prevMessageCount.current) {
      scrollToBottom("smooth");
      prevMessageCount.current = messages.length;
    }
  }, [messages?.length, scrollToBottom]);

  const renderParentThreadLink = (parentThreadId: string) => (
    <div className="mb-8 flex justify-center">
      <Link
        to="/chat/$threadId"
        params={{ threadId: parentThreadId }}
        className="group flex items-center gap-2 rounded-full border border-black/5 bg-background/50 px-4 py-1.5 text-[12px] font-bold text-foreground/50 shadow-sm backdrop-blur-sm transition-all hover:bg-black/5 hover:text-foreground"
      >
        <GitBranch size={14} className="text-primary/60" />
        <span>Go to parent conversation</span>
      </Link>
    </div>
  );

  const renderMessageGroup = (
    group: any,
    groupIndex: number,
    disableInitialAnimation: boolean,
  ) => {
    if (group.type === "user") {
      // Render user message as before
      const msg = group.messages[0];
      return (
        <motion.div
          key={msg._id}
          initial={
            disableInitialAnimation ? false : { opacity: 0, y: 10 }
          }
          animate={{ opacity: 1, y: 0 }}
          className="group mb-6 flex w-full flex-col items-end"
          style={{ contain: "layout style" }}
        >
          <div className="relative flex w-full flex-col items-end">
            <AnimatePresence mode="wait">
              {editingId === msg._id ? (
                <motion.div
                  key="edit-input"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  layout="position"
                  className="flex w-full justify-end"
                >
                  <MessageEditInput
                    messageId={msg._id}
                    threadId={threadId}
                    initialContent={editingContent}
                    initialAttachments={msg.attachments}
                    onCancel={() => setEditingId(null)}
                    onSubmit={() => setEditingId(null)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="message-content"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  layout="position"
                  className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2 text-left text-[14px] leading-relaxed break-words whitespace-pre-wrap text-zinc-900 shadow-sm transition-all md:px-5 md:py-3 md:text-[15.5px]"
                >
                  <div className="flex flex-col gap-1">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {msg.attachments.map((att: any, i: number) => (
                          <div
                            key={i}
                            className="overflow-hidden rounded-lg border border-black/10"
                          >
                            {att.type.startsWith("image/") ? (
                              <img
                                src={att.url}
                                alt="attachment"
                                className="max-h-60 max-w-xs object-cover"
                              />
                            ) : (
                              <a
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 bg-black/5 p-3 transition-colors hover:bg-black/10"
                              >
                                <div className="rounded bg-white p-1">
                                  <svg
                                    className="h-6 w-6 text-gray-500"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                    />
                                  </svg>
                                </div>
                                <span className="text-sm font-medium underline">
                                  {att.name}
                                </span>
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <Markdown content={msg.content} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* User actions */}
          {msg.status !== "streaming" && (
            <div
              className={cn(
                "mt-1.5 mr-1 flex items-center gap-1 transition-opacity",
                isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <MessageActionMenu
                type="retry"
                onAction={(modelId?: string) => handleRetry(msg._id, modelId)}
              >
                <button className="flex items-center justify-center rounded-md p-1.5 text-foreground/40 transition-all hover:bg-black/5 hover:text-foreground/70">
                  <RotateCcw size={15} />
                </button>
              </MessageActionMenu>
              <MessageActionMenu
                type="branch"
                onAction={(modelId?: string) => handleBranch(msg._id, modelId)}
              >
                <button className="flex items-center justify-center rounded-md p-1.5 text-foreground/40 transition-all hover:bg-black/5 hover:text-foreground/70">
                  <GitBranch size={15} />
                </button>
              </MessageActionMenu>
              <ActionButton
                icon={<Edit3 size={15} />}
                label="Edit"
                onClick={() => {
                  setEditingId(msg._id);
                  setEditingContent(msg.content);
                }}
              />
              <ActionButton
                icon={copiedId === msg._id ? <Check size={15} /> : <Copy size={15} />}
                label="Copy"
                onClick={() => handleCopy(msg._id, msg.content)}
              />
            </div>
          )}
        </motion.div>
      );
    }

    // Render assistant group as ONE unified block
    const groupMessages = group.messages;
    const lastMsg = groupMessages[groupMessages.length - 1];
    const isAnyStreaming = groupMessages.some((m: any) => m.status === "streaming");
    const assistantGroupKey =
      groupMessages?.[0]?._id ?? `assistant-group-${String(groupIndex)}`;

    return (
      <motion.div
        key={assistantGroupKey}
        initial={disableInitialAnimation ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group mb-6 flex w-full flex-col items-start"
        style={{ contain: "layout style" }}
      >
        <div className="relative flex w-full max-w-none flex-col items-start px-4 py-1 text-foreground/90 md:px-2">
          {/* Render ALL assistant messages in this group sequentially */}
          {groupMessages.map((msg: any) => (
            <div key={msg._id} className="w-full">
              <StreamingMessage
                messageId={msg._id}
                content={msg.content}
                reasoningContent={msg.reasoningContent}
                toolCalls={msg.toolCalls}
                toolResults={msg.toolCalls?.reduce((acc: any, tc: any) => {
                  const id = tc?.id;
                  if (!id) return acc;
                  const content = toolOutputsByCallId[id];
                  if (typeof content === "string") acc[id] = content;
                  return acc;
                }, {})}
                products={msg.products}
                isStreaming={msg.status === "streaming"}
                onOpenExpanded={handleOpenExpanded}
              />
            </div>
          ))}
        </div>

        {/* Actions - only on the LAST message of the group, hidden during streaming */}
        {!isAnyStreaming && (
          <div
            className={cn(
              "mt-1.5 ml-1 flex items-center gap-1 transition-opacity",
              isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <ActionButton
              icon={
                copiedId === lastMsg._id ? <Check size={15} /> : <Copy size={15} />
              }
              label="Copy"
              onClick={() => handleCopy(lastMsg._id, lastMsg.content)}
            />
            <MessageActionMenu
              type="branch"
              onAction={(modelId?: string) => {
                const msgIndex =
                  messages?.findIndex((m: any) => m._id === lastMsg._id) ?? -1;
                if (msgIndex > 0) {
                  for (let i = msgIndex - 1; i >= 0; i--) {
                    if (messages?.[i]?.role === "user") {
                      handleBranch(messages[i]._id, modelId);
                      break;
                    }
                  }
                }
              }}
            >
              <button className="flex items-center justify-center rounded-md p-1.5 text-foreground/40 transition-all hover:bg-black/5 hover:text-foreground/70">
                <GitBranch size={15} />
              </button>
            </MessageActionMenu>
            <MessageActionMenu
              type="retry"
              onAction={(modelId?: string) => {
                const msgIndex =
                  messages?.findIndex((m: any) => m._id === lastMsg._id) ?? -1;
                if (msgIndex > 0) {
                  for (let i = msgIndex - 1; i >= 0; i--) {
                    if (messages?.[i]?.role === "user") {
                      handleRetry(messages[i]._id, modelId);
                      break;
                    }
                  }
                }
              }}
            >
              <button className="flex items-center justify-center rounded-md p-1.5 text-foreground/40 transition-all hover:bg-black/5 hover:text-foreground/70">
                <RotateCcw size={15} />
              </button>
            </MessageActionMenu>
            <MessageMetadata
              modelName={
                lastMsg.modelId ? getModelDisplayName(lastMsg.modelId) : "AI"
              }
              wordCount={
                lastMsg.content
                  ?.trim()
                  .split(/\s+/)
                  .filter(Boolean).length ?? 0
              }
              toolCalls={groupMessages.reduce(
                (sum: number, m: any) => sum + (m.toolCalls?.length || 0),
                0,
              )}
            />
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="relative flex h-dvh min-h-screen max-w-full overflow-hidden bg-background text-foreground">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="relative flex min-w-0 flex-1 flex-col transition-all duration-300">
        <main
          className={cn(
            "relative z-0 flex flex-1 flex-col items-center overflow-x-hidden overflow-y-hidden p-2 transition-all duration-300 md:p-4",
            isEmpty ? "justify-center" : "justify-start",
          )}
        >
          {isEmpty ? (
            <div className="flex h-full w-full flex-col items-center justify-center">
              <LandingHero
                onSelectPrompt={(text) =>
                  chatInputRef.current?.setContentAndSend(text)
                }
              />
            </div>
          ) : messages === null || thread === null ? (
            <div className="flex h-full w-full flex-col items-center justify-center p-4">
              <NotFoundPage />
            </div>
          ) : (
            <div
              ref={messageScrollRef}
              className="scrollbar-hide message-scroll-area w-full max-w-5xl flex-1 overflow-x-hidden overflow-y-auto pt-16 pb-40 md:pt-20"
            >
              <TooltipProvider delayDuration={150}>
                {shouldVirtualizeMessages ? (
                  <div
                    className="relative w-full"
                    style={{ height: messageVirtualizer.getTotalSize() }}
                  >
                    {messageVirtualizer.getVirtualItems().map((row) => {
                      const block = virtualBlocks[row.index];
                      if (!block) return null;

                      const key =
                        block.type === "anchor"
                          ? "messages-anchor"
                          : block.type === "parent-link"
                            ? "parent-link-" + block.parentThreadId
                            : block.group?.type === "user"
                              ?
                                block.group.messages?.[0]?._id ??
                                "user-" + String(block.groupIndex)
                              :
                                block.group.messages?.[0]?._id ??
                                "assistant-group-" + String(block.groupIndex);

                      return (
                        <div
                          key={key}
                          ref={messageVirtualizer.measureElement}
                          data-index={row.index}
                          className="absolute left-0 top-0 w-full"
                          style={{ transform: "translateY(" + row.start + "px)" }}
                        >
                          {block.type === "parent-link" ? (
                            renderParentThreadLink(block.parentThreadId)
                          ) : block.type === "anchor" ? (
                            <div ref={messagesEndRef} className="message-anchor" />
                          ) : (
                            renderMessageGroup(
                              block.group,
                              block.groupIndex,
                              true,
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    {thread?.parentThreadId &&
                      renderParentThreadLink(thread.parentThreadId)}
                    {groupedMessages.map((group, groupIndex) =>
                      renderMessageGroup(group, groupIndex, false),
                    )}
                    {/* Scroll anchor to prevent jumps during streaming */}
                    <div ref={messagesEndRef} className="message-anchor" />
                  </>
                )}

                {messages === undefined && (
                  <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-10">
                    <div className="h-3 w-40 animate-pulse rounded bg-black/10" />
                    <div className="w-full max-w-xl space-y-3">
                      <div className="ml-auto h-16 w-3/5 animate-pulse rounded-2xl bg-black/5" />
                      <div className="h-20 w-4/5 animate-pulse rounded-2xl bg-black/5" />
                      <div className="ml-auto h-10 w-2/5 animate-pulse rounded-2xl bg-black/5" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-foreground/40">
                      <MessageSquare className="animate-pulse" size={16} />
                      <span>Loading conversation...</span>
                    </div>
                  </div>
                )}
              </TooltipProvider>
            </div>
          )}
        </main>

        {/* ChatInput - Moved outside of main to control Z-Index layering over portals */}
        {/* We hide the input when product selection is active to show the Floating Action Bar */}
        <div
          className={cn(
            "transition-all duration-300 ease-in-out",
            isExpandedOpen
              ? "fixed bottom-0 left-0 z-[550] w-full px-2 pt-0 pb-1 md:px-4 md:pb-2"
              : "absolute bottom-0 left-0 z-[50] w-full px-2 pt-0 pb-1 md:px-4 md:pb-2",
            selectedProductIds.length > 0
              ? "pointer-events-none translate-y-24 opacity-0"
              : "translate-y-0 opacity-100",
          )}
          style={{
            paddingBottom:
              "calc(env(safe-area-inset-bottom, 0px) + var(--visual-viewport-bottom, 0px) + 4px)",
          }}
        >
          <ChatInput
            existingThreadId={threadId}
            ref={chatInputRef}
            placeholder={
              isExpandedOpen ? "Ask a follow up" : "Type your message here..."
            }
          />
        </div>
      </div>

      {/* Floating Selection Bar for Expanded View */}
      <SelectionActionBar
        selectedCount={selectedProductIds.length}
        onClear={() => setSelectedProductIds([])}
        onAskFollowUp={(id: string) => console.log("Follow up for:", id)}
      />

      {/* Product Details Drawer - renders based on productId search param */}
      <AnimatePresence>
        {productId && (
          <ProductDrawer
            productId={productId}
            initialData={
              expandedProducts?.find((p) => p.id === productId) ||
              productLookup.get(productId)
            }
          />
        )}
      </AnimatePresence>

      {/* Expanded Product Picker View */}
      <AnimatePresence>
        {isExpandedOpen && (
          <ProductExpandedView
            products={expandedProducts || []}
            onClose={handleCloseExpanded}
            onSelect={(id: string) => console.log("Selected:", id)}
            selectedIds={selectedProductIds}
            onToggleSelection={(id: string) => {
              setSelectedProductIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id],
              );
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const ActionButton = ({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        onClick={onClick}
        className="flex items-center justify-center rounded-md p-1.5 text-foreground/60 transition-all hover:bg-black/5 hover:text-foreground/80"
      >
        {icon}
      </button>
    </TooltipTrigger>
    <TooltipContent className="border-fuchsia-200/70 bg-[#FDF0FB] text-[11px] font-medium text-fuchsia-900">
      {label}
    </TooltipContent>
  </Tooltip>
);
