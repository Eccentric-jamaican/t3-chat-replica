import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
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
import { useState, useRef, useEffect } from "react";
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

type ChatSearchParams = {
  productId?: string;
};

export const Route = createFileRoute("/chat/$threadId")({
  validateSearch: (search: Record<string, unknown>): ChatSearchParams => ({
    productId:
      typeof search.productId === "string" ? search.productId : undefined,
  }),
  component: ChatPage,
});

function ChatPage() {
  const { threadId } = Route.useParams();
  const { productId } = Route.useSearch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Wait for Convex auth to be ready before querying messages
  const { isLoading: isConvexAuthLoading } = useConvexAuth();

  // Get sessionId for ownership verification
  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem("sendcat_session_id") || undefined
      : undefined;

  // Skip query while Convex auth is loading to prevent "Access denied" on reload
  const messages = useQuery(
    api.messages.list,
    isConvexAuthLoading ? "skip" : { threadId: threadId as any, sessionId },
  );
  const thread = useQuery(
    api.threads.get,
    isConvexAuthLoading ? "skip" : { id: threadId as any, sessionId },
  );
  const createThread = useMutation(api.threads.create);
  const sendMessage = useMutation(api.messages.send);
  const streamAnswer = useAction(api.chat.streamAnswer);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  // Products drawer state
  const [expandedProducts, setExpandedProducts] = useState<Product[] | null>(null);

  const handleOpenExpanded = (products: Product[]) => {
    setExpandedProducts(products);
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
  const prevMessageCount = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Only scroll when a new message is added, not during streaming content updates
  useEffect(() => {
    if (messages && messages.length > prevMessageCount.current) {
      scrollToBottom();
      prevMessageCount.current = messages.length;
    }
  }, [messages?.length]);

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
          ) : (
            <div className="scrollbar-hide message-scroll-area w-full max-w-5xl flex-1 overflow-x-hidden overflow-y-auto pt-16 pb-40 md:pt-20">
              {thread?.parentThreadId && (
                <div className="mb-8 flex justify-center">
                  <Link
                    to="/chat/$threadId"
                    params={{ threadId: thread.parentThreadId }}
                    className="group flex items-center gap-2 rounded-full border border-black/5 bg-background/50 px-4 py-1.5 text-[12px] font-bold text-foreground/50 transition-all hover:bg-black/5 hover:text-foreground shadow-sm backdrop-blur-sm"
                  >
                    <GitBranch size={14} className="text-primary/60" />
                    <span>Go to parent conversation</span>
                  </Link>
                </div>
              )}
              <TooltipProvider delayDuration={150}>
                {messages
                  ?.filter((msg: any) => {
                    // Hide ALL tool result messages from the main scroll (we display them inline in the assistant message)
                    if (msg.role === "tool") return false;
                    // Hide empty aborted assistant messages
                    if (
                      msg.role === "assistant" &&
                      msg.status === "aborted" &&
                      !msg.content?.trim() &&
                      !msg.toolCalls?.length &&
                      !msg.products?.length
                    )
                      return false;
                    return true;
                  })
                  .map((msg: any) => (
                    <motion.div
                      key={msg._id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "group mb-6 flex w-full flex-col",
                        msg.role === "user" ? "items-end" : "items-start",
                      )}
                      style={{ contain: "layout style" }}
                    >
                      <div
                        className={cn(
                          "relative flex w-full flex-col",
                          msg.role === "user" ? "items-end" : "items-start",
                        )}
                      >
                        <AnimatePresence mode="wait">
                          {editingId === msg._id && msg.role === "user" ? (
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
                              className={cn(
                                "leading-relaxed break-words transition-all",
                                msg.role === "user"
                                  ? "max-w-[95%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-center text-[15px] text-zinc-900 shadow-sm sm:max-w-[85%] md:px-5 md:py-3 md:text-[15.5px]"
                                  : "w-full max-w-none px-4 py-1 text-foreground/90 md:px-2",
                              )}
                            >
                              <div className="flex flex-col gap-1">
                                {/* Attachments Display */}
                                {msg.attachments &&
                                  msg.attachments.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-2">
                                      {msg.attachments.map(
                                        (att: any, i: number) => (
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
                                        ),
                                      )}
                                    </div>
                                  )}

                                {msg.role === "assistant" ? (
                                  <>
                                    <StreamingMessage
                                      messageId={msg._id}
                                      content={msg.content}
                                      reasoningContent={msg.reasoningContent}
                                      toolCalls={msg.toolCalls}
                                      toolResults={
                                         msg.toolCalls?.reduce((acc: any, tc: any) => {
                                            const toolMsg = messages?.find((m: any) => m.role === "tool" && m.toolCallId === tc.id);
                                            if (toolMsg) acc[tc.id] = toolMsg.content;
                                            return acc;
                                         }, {})
                                      }
                                      products={msg.products}
                                      isStreaming={msg.status === "streaming"}
                                      onOpenExpanded={handleOpenExpanded}
                                    />

                                    {msg.status === "streaming" &&
                                      (!msg.content || !msg.content.trim()) &&
                                      (!msg.toolCalls || msg.toolCalls.length === 0) &&
                                      (!msg.reasoningContent || !msg.reasoningContent.trim()) && (
                                        <div className="flex items-center gap-2.5 py-2 text-foreground/60">
                                          <motion.div
                                            className="flex gap-1.5"
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{
                                              type: "spring",
                                              stiffness: 400,
                                              damping: 20,
                                            }}
                                          >
                                            {[0, 1, 2].map((i) => (
                                              <motion.span
                                                key={i}
                                                className="h-2 w-2 rounded-full bg-gradient-to-br from-t3-berry to-t3-berry-deep shadow-sm"
                                                animate={{
                                                  y: [0, -6, 0],
                                                  scale: [1, 1.15, 1],
                                                  opacity: [0.7, 1, 0.7],
                                                }}
                                                transition={{
                                                  repeat: Infinity,
                                                  duration: 0.7,
                                                  delay: i * 0.12,
                                                  ease: [0.4, 0, 0.2, 1],
                                                }}
                                              />
                                            ))}
                                          </motion.div>
                                          <span className="text-sm font-semibold tracking-tight">
                                            Thinking...
                                          </span>
                                        </div>
                                      )}
                                  </>
                                ) : msg.role === "tool" ? (
                                  // Hide tool outputs (they're displayed in assistant message now)
                                  null
                                ) : (
                                  <>
                                    <Markdown content={msg.content} />
                                    {msg.status === "aborted" && (
                                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-500/10 bg-red-500/5 px-2 py-1">
                                        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500/50" />
                                        <span className="text-[10px] font-medium tracking-wide text-red-500/70 uppercase">
                                          Generation Stopped
                                        </span>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Message Actions - Hidden during streaming to prevent jitter */}
                      {msg.status !== "streaming" && (
                        <div
                          className={cn(
                            "mt-1.5 flex items-center gap-1 transition-opacity",
                            isMobile
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100",
                            msg.role === "user" ? "mr-1" : "ml-1",
                          )}
                        >
                          {msg.role === "user" ? (
                            <>
                              <MessageActionMenu
                                type="retry"
                                onAction={(modelId?: string) =>
                                  handleRetry(msg._id, modelId)
                                }
                              >
                                <button className="flex items-center justify-center rounded-md p-1.5 text-foreground/40 transition-all hover:bg-black/5 hover:text-foreground/70">
                                  <RotateCcw size={15} />
                                </button>
                              </MessageActionMenu>
                              <MessageActionMenu
                                type="branch"
                                onAction={(modelId?: string) =>
                                  handleBranch(msg._id, modelId)
                                }
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
                                icon={
                                  copiedId === msg._id ? (
                                    <Check size={15} />
                                  ) : (
                                    <Copy size={15} />
                                  )
                                }
                                label="Copy"
                                onClick={() => handleCopy(msg._id, msg.content)}
                              />
                            </>
                          ) : msg.role === "assistant" ? (
                            <>
                              <ActionButton
                                icon={
                                  copiedId === msg._id ? (
                                    <Check size={15} />
                                  ) : (
                                    <Copy size={15} />
                                  )
                                }
                                label="Copy"
                                onClick={() => handleCopy(msg._id, msg.content)}
                              />
                              <MessageActionMenu
                                type="branch"
                                onAction={(modelId?: string) => {
                                  // Find the previous user message to branch from
                                  const msgIndex =
                                    messages?.findIndex(
                                      (m: any) => m._id === msg._id,
                                    ) ?? -1;
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
                                  // Find the previous user message to regenerate from
                                  const msgIndex =
                                    messages?.findIndex(
                                      (m: any) => m._id === msg._id,
                                    ) ?? -1;
                                  if (msgIndex > 0) {
                                    // Find the most recent user message before this assistant message
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
                                  msg.modelId
                                    ? getModelDisplayName(msg.modelId)
                                    : "AI"
                                }
                                wordCount={
                                  msg.content
                                    ?.trim()
                                    .split(/\s+/)
                                    .filter(Boolean).length ?? 0
                                }
                                toolCalls={msg.toolCalls?.length}
                              />
                            </>
                          ) : null}
                        </div>
                      )}
                    </motion.div>
                  ))}
                {/* Scroll anchor to prevent jumps during streaming */}
                <div ref={messagesEndRef} className="message-anchor" />
                {messages === undefined && (
                  <div className="flex h-full items-center justify-center opacity-20">
                    <MessageSquare className="animate-pulse" size={48} />
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
            initialData={expandedProducts?.find((p) => p.id === productId)}
          />
        )}
      </AnimatePresence>

      {/* Expanded Product Picker View */}
      <AnimatePresence>
        {isExpandedOpen && (
          <ProductExpandedView
            isOpen={!!expandedProducts}
            products={expandedProducts || []}
            onClose={() => setExpandedProducts(null)}
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
