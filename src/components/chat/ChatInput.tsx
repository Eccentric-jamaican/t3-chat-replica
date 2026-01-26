import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { fetchOpenRouterModels, type AppModel } from "../../lib/openrouter";
import { ArrowUp, Paperclip, Globe, StopCircle, X, Brain } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "@tanstack/react-router";
import { ModelPicker } from "./ModelPicker";
import { useIsMobile } from "../../hooks/useIsMobile";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ChatInputProps {
  existingThreadId?: string;
  placeholder?: string;
  className?: string;
}

export interface ChatInputHandle {
  setContentAndSend: (text: string) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  ({ existingThreadId, placeholder, className }, ref) => {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [content, setContent] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [showBanner, setShowBanner] = useState(true);

    const [selectedModelId, setSelectedModelId] = useState(() => {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("t3_selected_model");
        if (saved) return saved;
      }
      return "openai/gpt-oss-120b:free";
    });

    useEffect(() => {
      if (typeof window !== "undefined") {
        localStorage.setItem("t3_selected_model", selectedModelId);
      }
    }, [selectedModelId]);

    const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
    const [searchEnabled, setSearchEnabled] = useState(false);
    const [models, setModels] = useState<AppModel[]>([]);

    useEffect(() => {
      fetchOpenRouterModels().then(setModels);
    }, []);

    const currentModel = models.find((m) => m.id === selectedModelId);
    const reasoningType = currentModel?.reasoningType; // 'effort' | 'max_tokens' | null
    const supportsReasoning = reasoningType != null;

    const toggleReasoning = () => {
      // Cycle through effort levels appropriate for the reasoning type
      if (reasoningType === "effort") {
        const levels = [null, "low", "medium", "high"];
        const currentIndex = levels.indexOf(reasoningEffort);
        const nextIndex = (currentIndex + 1) % levels.length;
        setReasoningEffort(levels[nextIndex]);
      } else if (reasoningType === "max_tokens") {
        // For max_tokens models, just toggle on/off with a sensible default
        setReasoningEffort(reasoningEffort ? null : "medium");
      }
    };

    const [sessionId] = useState(() => {
      if (typeof window === "undefined") return "";
      const saved = localStorage.getItem("t3_session_id");
      if (saved) return saved;
      const newId = uuidv4();
      localStorage.setItem("t3_session_id", newId);
      return newId;
    });
    const [threadId, setThreadId] = useState<string | null>(
      existingThreadId || null,
    );
    const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    const createThread = useMutation(api.threads.create);
    const sendMessage = useMutation(api.messages.send);
    const initializeAssistantMessage = useMutation(
      api.messages.initializeAssistantMessage,
    );
    const abortMessage = useMutation(api.messages.abort);
    const startStreamSession = useMutation(api.streamSessions.start);
    const abortStreamSession = useMutation(api.streamSessions.abort);
    const abortLatestStreamSession = useMutation(
      api.streamSessions.abortLatestByThread,
    );
    const streamAnswer = useAction(api.chat.streamAnswer);
    const abortLatestInThread = useMutation(api.messages.abortLatestInThread);
    const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
    const effectiveThreadId = threadId ?? existingThreadId ?? null;
    const isThreadStreaming = useQuery(
      api.messages.isThreadStreaming,
      effectiveThreadId ? { threadId: effectiveThreadId as any } : "skip",
    );

    useEffect(() => {
      setThreadId(existingThreadId || null);
      setActiveMessageId(null);
      setActiveSessionId(null);
    }, [existingThreadId]);

    const [attachments, setAttachments] = useState<
      {
        storageId: string;
        type: string;
        name: string;
        size: number;
        previewUrl: string;
      }[]
    >([]);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      setUploading(true);

      try {
        const newAttachments: typeof attachments = [];
        for (const file of files) {
          // Upload to Convex Storage
          const postUrl = await generateUploadUrl();
          const result = await fetch(postUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          const { storageId } = await result.json();

          newAttachments.push({
            storageId,
            type: file.type,
            name: file.name,
            size: file.size,
            previewUrl: URL.createObjectURL(file),
          });
        }
        setAttachments((prev) => [...prev, ...newAttachments]);
      } catch (error) {
        console.error("Upload failed", error);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    const removeAttachment = (index: number) => {
      setAttachments((prev) => {
        const removed = prev[index];
        if (removed?.previewUrl) {
          URL.revokeObjectURL(removed.previewUrl);
        }
        return prev.filter((_, i) => i !== index);
      });
    };

    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`;
      }
    }, [content]);

    const handleStop = async () => {
      console.log("Stopping generation, threadId:", effectiveThreadId);
      let aborted = false;

      if (activeSessionId) {
        try {
          await abortStreamSession({ sessionId: activeSessionId as any });
          console.log("Aborted active session:", activeSessionId);
          aborted = true;
        } catch (error) {
          console.warn("Failed to abort active session, falling back", error);
        }
      }

      if (!aborted && effectiveThreadId) {
        try {
          await abortLatestStreamSession({
            threadId: effectiveThreadId as any,
          });
          console.log("Aborted latest stream session in thread");
          aborted = true;
        } catch (error) {
          console.warn(
            "Failed to abort latest stream session, falling back",
            error,
          );
        }
      }

      if (!aborted && activeMessageId) {
        try {
          await abortMessage({ messageId: activeMessageId as any });
          console.log("Aborted active message:", activeMessageId);
          aborted = true;
        } catch (error) {
          console.warn("Failed to abort active message, falling back", error);
        }
      }

      if (!aborted && effectiveThreadId) {
        await abortLatestInThread({ threadId: effectiveThreadId as any });
        console.log("Aborted latest message in thread");
      }
      setIsGenerating(false);
      setActiveSessionId(null);
    };

    useImperativeHandle(ref, () => ({
      setContentAndSend: (text: string) => {
        handleSend(text);
      },
    }));

    const handleSend = async (forcedContent?: string) => {
      const textToSend = forcedContent !== undefined ? forcedContent : content;
      if (!textToSend.trim() || isGenerating) return;
      setIsGenerating(true);

      // Store content before clearing input
      const messageContent = textToSend.trim();
      if (forcedContent === undefined) {
        setContent("");
      }

      try {
        let currentThreadId = threadId;

        if (!currentThreadId) {
          currentThreadId = await createThread({
            sessionId,
            modelId: selectedModelId,
            title: messageContent.slice(0, 40),
          });
          setThreadId(currentThreadId);
          // Navigate to the new thread page
          navigate({
            to: "/chat/$threadId",
            params: { threadId: currentThreadId },
          });
        }

        await sendMessage({
          threadId: currentThreadId as any,
          content: messageContent,
          role: "user",
          attachments: attachments.map(({ storageId, type, name, size }) => ({
            storageId,
            type,
            name,
            size,
          })) as any,
        });

        attachments.forEach((attachment) => {
          if (attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
          }
        });
        setAttachments([]);

        const newMessageId = await initializeAssistantMessage({
          threadId: currentThreadId as any,
          modelId: selectedModelId,
        });
        setActiveMessageId(newMessageId);

        const newSessionId = await startStreamSession({
          threadId: currentThreadId as any,
          messageId: newMessageId as any,
        });
        setActiveSessionId(newSessionId);

        // Trigger LLM streaming
        // Only pass reasoningEffort when the current model supports reasoning AND it's set
        await streamAnswer({
          threadId: currentThreadId as any,
          messageId: newMessageId as any,
          sessionId: newSessionId as any,
          modelId: selectedModelId,
          reasoningEffort:
            supportsReasoning && reasoningEffort ? reasoningEffort : undefined,
          reasoningType:
            supportsReasoning && reasoningEffort ? reasoningType : undefined,
          webSearch: searchEnabled,
        });

        setIsGenerating(false);
      } catch (error) {
        console.error("Failed to send message:", error);
      } finally {
        setIsGenerating(false);
        setActiveMessageId(null);
        setActiveSessionId(null);
      }
    };

    return (
      <div
        className={cn(
          "pointer-events-none z-50 w-full text-center transition-all duration-300",
          className,
        )}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-[768px]">
          {/* T3 Credits Banner */}
          <AnimatePresence>
            {showBanner && !isGenerating && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="mb-2 flex items-center justify-between gap-2 rounded-2xl border border-[rgb(238,225,237)] bg-[rgb(254,235,231)] px-4 py-1.5 text-[12px] font-medium text-[rgb(80,24,84)] shadow-sm md:mb-5 md:gap-4 md:px-5 md:py-3 md:text-[13.5px]"
              >
                <div className="flex-1 text-center">
                  You only have 9 message credits left.{" "}
                  <button className="font-bold underline">
                    Sign in to get a higher limit (it's free!)
                  </button>
                </div>
                <button
                  onClick={() => setShowBanner(false)}
                  className="rounded-full p-1 transition-colors hover:bg-black/5"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The Input Container - Flex Column Layout like Original */}
          <div
            className={cn(
              "border-reflect input-glow relative overflow-hidden rounded-2xl transition-all duration-300",
              "transition-shadow duration-500 focus-within:ring-[6px] focus-within:ring-primary/10",
              isMobile &&
                "border border-black/5 bg-background/70 backdrop-blur-sm",
            )}
          >
            {/* Top-Right Toggle Pill (Reasoning/Expert) - Hidden on mobile to save space, or moved */}
            {!isMobile && (
              <div className="absolute top-4 right-4 z-10">
                <div className="flex items-center gap-0.5 rounded-full border border-t3-berry/10 bg-white/40 p-1 backdrop-blur-sm">
                  <button className="flex items-center justify-center rounded-full bg-white p-1.5 shadow-sm">
                    <Globe size={16} className="text-[#00a67e]" />
                  </button>
                  <button className="flex items-center justify-center rounded-full p-1.5">
                    <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-t3-berry/20">
                      <span className="text-[10px] font-black text-t3-berry">
                        G
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Flex Column: Textarea + Bottom Row */}
            <div className="flex flex-col">
              {/* Attachments Preview */}
              <div className="flex flex-wrap gap-2 px-3 pt-2 md:gap-3 md:px-5 md:pt-4">
                {attachments.map((att, i) => (
                  <div
                    key={i}
                    className="group relative h-16 w-16 overflow-hidden rounded-xl border border-white/10 bg-black/5 shadow-sm md:h-20 md:w-20"
                  >
                    {att.type.startsWith("image/") ? (
                      <img
                        src={att.previewUrl}
                        alt="preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center text-[10px] leading-tight break-words text-foreground/50">
                        <Paperclip size={16} className="mb-1 opacity-50" />
                        {att.name}
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {uploading && (
                  <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-xl bg-black/5 md:h-20 md:w-20">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-t3-berry border-t-transparent" />
                  </div>
                )}
              </div>

              {/* Textarea - No bottom padding, natural height */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={placeholder || "Type your message here..."}
                className="max-h-[160px] min-h-[44px] w-full resize-none overflow-y-auto bg-transparent px-3 pt-2 pb-1 text-[14px] leading-relaxed text-foreground placeholder-foreground/35 outline-none md:max-h-[400px] md:min-h-[48px] md:px-5 md:pt-4 md:pb-2 md:text-[15.5px]"
              />

              {/* Bottom Action Row - Separate from textarea */}
              <div className="flex items-center justify-between gap-1 px-2 pt-1 pb-2 md:gap-2 md:px-4 md:pb-3">
                <div className="flex items-center gap-1 md:gap-2">
                  <ModelPicker
                    selectedModelId={selectedModelId}
                    onSelect={setSelectedModelId}
                  />

                  {supportsReasoning && (
                    <button
                      onClick={toggleReasoning}
                      className={cn(
                        "glass-pill group/thinking relative !px-2 transition-all duration-300 md:!px-3",
                        !reasoningEffort && "opacity-40 hover:opacity-100",
                        reasoningEffort === "low" &&
                          "border-fuchsia-200/20 bg-fuchsia-100/30 text-fuchsia-600/80",
                        reasoningEffort === "medium" &&
                          "border-fuchsia-200/50 bg-fuchsia-100/60 text-fuchsia-800/80 shadow-sm",
                        reasoningEffort === "high" &&
                          "animate-pulse-slow border-fuchsia-500/50 bg-fuchsia-600/80 text-white shadow-[0_0_15px_-5px_theme(colors.fuchsia.600)]",
                      )}
                    >
                      <div className="relative flex items-center gap-1.5">
                        <Brain
                          size={isMobile ? 14 : 15}
                          className={cn(
                            "transition-transform duration-500 group-hover/thinking:scale-110",
                            reasoningEffort ? "fill-current" : "fill-none",
                          )}
                        />
                        <span className="hidden text-[11px] font-semibold tracking-wide uppercase sm:inline md:text-[12px]">
                          {reasoningEffort ? reasoningEffort : "Off"}
                        </span>

                        {/* Effort Indicator dots */}
                        {reasoningEffort && (
                          <div className="ml-0.5 flex gap-0.5">
                            <div
                              className={cn(
                                "h-1 w-1 rounded-full",
                                reasoningEffort
                                  ? "bg-current"
                                  : "bg-current/20",
                              )}
                            />
                            <div
                              className={cn(
                                "h-1 w-1 rounded-full",
                                reasoningEffort === "medium" ||
                                  reasoningEffort === "high"
                                  ? "bg-current"
                                  : "bg-current/20",
                              )}
                            />
                            <div
                              className={cn(
                                "h-1 w-1 rounded-full",
                                reasoningEffort === "high"
                                  ? "bg-current"
                                  : "bg-current/20",
                              )}
                            />
                          </div>
                        )}
                      </div>
                    </button>
                  )}

                  {/* Always show search button - backend handles tool availability */}
                  <button
                    onClick={() => setSearchEnabled(!searchEnabled)}
                    className={cn(
                      "glass-pill cursor-pointer !px-2 transition-all md:!px-3",
                      searchEnabled
                        ? "border-blue-500/20 bg-blue-500/10 text-blue-600 opacity-100"
                        : "opacity-60 hover:opacity-100",
                    )}
                  >
                    <Globe
                      size={isMobile ? 14 : 15}
                      className={cn(searchEnabled && "text-blue-600")}
                    />
                    <span className="hidden sm:inline">Search</span>
                  </button>

                  <button
                    className="glass-pill !px-2 opacity-30 hover:opacity-60"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <Paperclip size={isMobile ? 16 : 18} />
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleFileSelect}
                  />
                </div>

                <div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isGenerating || isThreadStreaming) {
                        handleStop();
                      } else {
                        handleSend();
                      }
                    }}
                    disabled={
                      !content.trim() && !isGenerating && !isThreadStreaming
                    }
                    className={cn(
                      // Critical: Maintain min 44x44px touch target for mobile
                      "z-20 flex touch-manipulation items-center justify-center rounded-xl transition-all duration-300",
                      "min-h-[44px] min-w-[44px] p-2 md:p-2.5",
                      content.trim() || isGenerating || isThreadStreaming
                        ? isGenerating || isThreadStreaming
                          ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                          : "bg-t3-berry text-white shadow-lg shadow-t3-berry/20"
                        : "cursor-not-allowed bg-black/5 text-black/40",
                    )}
                  >
                    {isGenerating || isThreadStreaming ? (
                      <StopCircle
                        size={isMobile ? 22 : 20}
                        className="fill-current text-white"
                      />
                    ) : (
                      <ArrowUp size={isMobile ? 22 : 20} strokeWidth={2.5} />
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-1 text-center text-[11px] font-semibold tracking-tight text-foreground/35 md:mt-1.5">
            Sendcat can make mistakes. Check important info.
          </p>
        </div>
      </div>
    );
  },
);

ChatInput.displayName = "ChatInput";
