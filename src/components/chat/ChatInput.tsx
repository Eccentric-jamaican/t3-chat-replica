import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { fetchOpenRouterModels, type AppModel } from "../../lib/openrouter";
import { ArrowUp, Paperclip, Globe, X, Brain, StopCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "../../lib/utils";
import { ModelPicker } from "./ModelPicker";
import { useIsMobile } from "../../hooks/useIsMobile";
import { toast } from "sonner";
import { trackEvent } from "../../lib/analytics";
import { useSelectedModelId } from "../../hooks/useSelectedModelId";
import type { ReasoningEffort } from "../../types/chat";
import {
  CHAT_STREAMING_CONTENT,
  CHAT_STREAMING_REASONING,
  CHAT_STREAMING_TOOL_CALL,
  CHAT_STREAMING_TOOL_INPUT_UPDATE,
  CHAT_STREAMING_TOOL_OUTPUT,
  CHAT_STREAMING_ABORT,
  type ChatStreamingAbortDetail,
  type ChatStreamingContentDetail,
  type ChatStreamingReasoningDetail,
  type ChatStreamingToolCallDetail,
  type ChatStreamingToolInputUpdateDetail,
  type ChatStreamingToolOutputDetail,
} from "../../lib/chatStreamingEvents";
import {
  appendStreamingMessageContent,
  appendStreamingMessageReasoning,
} from "../../lib/streamingMessageCache";
import {
  ACTIVE_CHAT_STREAM_EVENT,
  clearActiveChatStream,
  getActiveChatStream,
  startActiveChatStream,
  updateActiveChatStreamMessage,
} from "../../lib/activeChatStream";

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
    const [hasActiveStream, setHasActiveStream] = useState(false);
    const [showBanner, setShowBanner] = useState(true);

    const [selectedModelId, setSelectedModelId] = useSelectedModelId();

    const handleModelSelect = (modelId: string) => {
      if (modelId === selectedModelId) return;
      trackEvent("model_switch", {
        from: selectedModelId,
        to: modelId,
      });
      setSelectedModelId(modelId);
    };

    const [reasoningEffort, setReasoningEffort] =
      useState<ReasoningEffort | null>(null);
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
        const levels: Array<ReasoningEffort | null> = [
          null,
          "low",
          "medium",
          "high",
        ];
        const currentIndex = levels.indexOf(reasoningEffort);
        const nextIndex = (currentIndex + 1) % levels.length;
        setReasoningEffort(levels[nextIndex]);
      } else if (reasoningType === "max_tokens") {
        // For max_tokens models, just toggle on/off with a sensible default
        setReasoningEffort(reasoningEffort ? null : "medium");
      }
    };

    const [sessionId, setSessionId] = useState<string | undefined>(undefined);
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
      if (typeof window === "undefined") return;
      const saved = localStorage.getItem("sendcat_session_id");
      if (saved) {
        setSessionId(saved);
        setSessionReady(true);
        return;
      }
      const newId = uuidv4();
      localStorage.setItem("sendcat_session_id", newId);
      setSessionId(newId);
      setSessionReady(true);
    }, []);

    const getSessionId = () => {
      if (sessionId) return sessionId;
      if (typeof window === "undefined") return undefined;
      const saved = localStorage.getItem("sendcat_session_id");
      if (saved) {
        setSessionId(saved);
        return saved;
      }
      const newId = uuidv4();
      localStorage.setItem("sendcat_session_id", newId);
      setSessionId(newId);
      return newId;
    };
    const [threadId, setThreadId] = useState<string | null>(
      existingThreadId || null,
    );

    const createThread = useMutation(api.threads.create);
    const sendMessage = useMutation(api.messages.send);
    const abortLatestInThread = useMutation(api.messages.abortLatestInThread);
    const abortLatestStreamSession = useMutation(
      api.streamSessions.abortLatestByThread,
    );
    const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
    const { isLoading: isConvexAuthLoading } = useConvexAuth();
    const effectiveThreadId = threadId ?? existingThreadId ?? null;
    const isThreadStreaming = useQuery(
      api.messages.isThreadStreaming,
      effectiveThreadId && !isConvexAuthLoading && sessionReady
        ? { threadId: effectiveThreadId as Id<"threads">, sessionId }
        : "skip",
    );

    useEffect(() => {
      setThreadId(existingThreadId || null);
    }, [existingThreadId]);

    useEffect(() => {
      const syncActiveStream = () => {
        const activeStream = getActiveChatStream();
        setHasActiveStream(
          !!activeStream.requestId &&
            !!effectiveThreadId &&
            activeStream.threadId === effectiveThreadId,
        );
      };

      syncActiveStream();
      window.addEventListener(ACTIVE_CHAT_STREAM_EVENT, syncActiveStream);
      return () => {
        window.removeEventListener(ACTIVE_CHAT_STREAM_EVENT, syncActiveStream);
      };
    }, [effectiveThreadId]);

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
    const [isDragActive, setIsDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleFiles = async (files: File[]) => {
      const supportedFiles = files.filter(
        (file) =>
          file.type.startsWith("image/") || file.type === "application/pdf",
      );
      if (supportedFiles.length === 0) {
        toast.error("Unsupported file type. Please upload images or PDFs.");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (supportedFiles.length !== files.length) {
        toast.error("Some files were skipped (only images and PDFs allowed).");
      }

      setUploading(true);

      try {
        const newAttachments: typeof attachments = [];
        for (const file of supportedFiles) {
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

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      await handleFiles(files);
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current -= 1;
      if (dragDepthRef.current <= 0) {
        dragDepthRef.current = 0;
        setIsDragActive(false);
      }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragActive(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;
      await handleFiles(files);
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
      const activeStream = getActiveChatStream();
      const activeStreamMatchesThread =
        !!effectiveThreadId && activeStream.threadId === effectiveThreadId;
      const currentMessageId = activeStreamMatchesThread
        ? activeStream.messageId
        : null;
      const currentStreamId = activeStreamMatchesThread
        ? activeStream.streamId
        : null;
      if (currentMessageId) {
        window.dispatchEvent(
          new CustomEvent<ChatStreamingAbortDetail>(CHAT_STREAMING_ABORT, {
            detail: { messageId: currentMessageId },
          }),
        );
      }
      if (activeStreamMatchesThread) {
        activeStream.controller?.abort();
      }

      const fallbackAbort = async (currentSessionId: string) => {
        if (!effectiveThreadId) return;
        await Promise.all([
          abortLatestInThread({
            threadId: effectiveThreadId as Id<"threads">,
            sessionId: currentSessionId,
          }),
          abortLatestStreamSession({
            threadId: effectiveThreadId as Id<"threads">,
            sessionId: currentSessionId,
          }),
        ]);
      };

      try {
        if (!effectiveThreadId) {
          throw new Error("Missing thread id for stop");
        }
        const currentSessionId = getSessionId();
        if (!currentSessionId) {
          throw new Error("Missing session id for stop");
        }
        const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
        if (!convexSiteUrl) {
          throw new Error("Missing VITE_CONVEX_SITE_URL for stop");
        }

        if (currentMessageId) {
          const abortUrl = new URL(`${convexSiteUrl}/api/chat/abort`);
          const response = await fetch(abortUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(activeStream.authToken
                ? {
                    Authorization: `Bearer ${activeStream.authToken}`,
                  }
                : {}),
            },
            body: JSON.stringify({
              threadId: effectiveThreadId,
              messageId: currentMessageId,
              sessionId: currentSessionId,
              streamId: currentStreamId ?? undefined,
            }),
          });
          if (!response.ok) {
            throw new Error(
              `Abort endpoint failed: ${response.status} ${response.statusText}`,
            );
          }
        } else {
          await fallbackAbort(currentSessionId);
        }
      } catch (error) {
        console.warn("[ChatInput] Abort endpoint failed, falling back", error);
        const currentSessionId = getSessionId();
        if (currentSessionId) {
          await fallbackAbort(currentSessionId);
        }
      } finally {
        if (activeStreamMatchesThread) {
          clearActiveChatStream(activeStream.requestId ?? undefined);
        }
        setIsGenerating(false);
      }
      console.log("Aborted latest message in thread");
    };

    useImperativeHandle(ref, () => ({
      setContentAndSend: (text: string) => {
        handleSend(text);
      },
    }));

    const handleSend = async (forcedContent?: string) => {
      const textToSend = forcedContent !== undefined ? forcedContent : content;
      const trimmedText = textToSend.trim();
      const hasText = trimmedText.length > 0;
      const hasAttachments = attachments.length > 0;
      if ((!hasText && !hasAttachments) || isGenerating) return;
      setIsGenerating(true);
      let activeRequestId: string | null = null;

      // Store content before clearing input
      const messageContent = hasText ? trimmedText : "";
      const fallbackTitle = hasText
        ? messageContent
        : attachments.length > 0
          ? `Attachment: ${attachments[0].name || attachments[0].type || "Upload"}`
          : "Untitled thread";
      if (forcedContent === undefined) {
        setContent("");
      }

      try {
        const currentSessionId = getSessionId();
        if (!currentSessionId) {
          throw new Error("Missing session ID");
        }
        let effectiveToken: string | null = null;

        try {
          const tokenResponse = await fetch("/api/auth/convex/token", {
            credentials: "include",
          });
          if (tokenResponse.ok) {
            const data = await tokenResponse.json();
            if (typeof data?.token === "string") {
              effectiveToken = data.token;
            }
          }
        } catch (error) {
          console.warn("[ChatInput] Failed to fetch Convex token", error);
        }

        let currentThreadId = threadId;

        if (!currentThreadId) {
          const createdThreadId = await createThread({
            sessionId: currentSessionId,
            modelId: selectedModelId,
            title: fallbackTitle.slice(0, 40),
          });
          currentThreadId = createdThreadId;
          trackEvent("thread_created", {
            thread_id: createdThreadId,
            model_id: selectedModelId,
            has_text: hasText,
            attachment_count: attachments.length,
          });
          setThreadId(createdThreadId);
          // Navigate to the new thread page
          navigate({
            to: "/chat/$threadId",
            params: { threadId: createdThreadId },
          });
        }
        if (!currentThreadId) {
          throw new Error("Failed to create thread");
        }

        trackEvent("message_send", {
          thread_id: currentThreadId,
          model_id: selectedModelId,
          chars: messageContent.length,
          has_attachments: hasAttachments,
          attachment_count: attachments.length,
          search_enabled: searchEnabled,
          reasoning_effort: reasoningEffort ?? "none",
        });

        await sendMessage({
          threadId: currentThreadId as Id<"threads">,
          content: messageContent,
          role: "user",
          sessionId: currentSessionId,
          attachments: attachments.map(({ storageId, type, name, size }) => ({
            storageId: storageId as Id<"_storage">,
            type,
            name,
            size,
          })),
        });

        attachments.forEach((attachment) => {
          if (attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
          }
        });
        setAttachments([]);

        // ── Production-Style SSE Streaming ──────────────────────────────
        const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
        console.log(
          "[ChatInput] Starting SSE fetch to:",
          `${convexSiteUrl}/api/chat`,
        );
        const controller = new AbortController();
        const requestId = uuidv4();
        activeRequestId = requestId;
        startActiveChatStream({
          requestId,
          controller,
          threadId: currentThreadId,
          sessionId: currentSessionId,
          authToken: effectiveToken,
        });

        const response = await fetch(`${convexSiteUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(effectiveToken
              ? { Authorization: `Bearer ${effectiveToken}` }
              : {}),
          },
          body: JSON.stringify({
            threadId: currentThreadId,
            content: messageContent,
            modelId: selectedModelId,
            webSearch: searchEnabled,
            sessionId: currentSessionId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to start stream");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let currentMessageId: string | null = null;
        let buffer = "";

        const terminateStream = async () => {
          try {
            await reader?.cancel();
          } catch {
            // Ignore reader cancellation failures during local teardown.
          }
          controller.abort();
        };

        if (reader) {
          readLoop: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep the partial line in the buffer

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith("data: ")) {
                try {
                  const data = JSON.parse(trimmedLine.slice(6));
                  const dataType =
                    typeof data?.type === "string" ? data.type : null;
                  const localMessageId =
                    typeof data?.messageId === "string" ? data.messageId : null;
                  const localStreamId =
                    typeof data?.streamId === "string" ? data.streamId : null;
                  const localContent =
                    typeof data?.content === "string" ? data.content : null;
                  const localToolCallId =
                    typeof data?.toolCallId === "string" &&
                    data.toolCallId.length > 0
                      ? data.toolCallId
                      : null;
                  const localToolName =
                    typeof data?.toolName === "string" ? data.toolName : null;
                  const localArgsSnapshot =
                    typeof data?.argsSnapshot === "string"
                      ? data.argsSnapshot
                      : null;
                  const localInputTextDelta =
                    typeof data?.inputTextDelta === "string"
                      ? data.inputTextDelta
                      : null;

                  if (dataType === "start" && localMessageId) {
                    // setActiveMessageId(data.messageId);
                    currentMessageId = localMessageId;
                    updateActiveChatStreamMessage({
                      requestId,
                      messageId: localMessageId,
                      streamId: localStreamId,
                    });
                  } else if (
                    dataType === "content" &&
                    currentMessageId &&
                    localContent
                  ) {
                    appendStreamingMessageContent(
                      currentMessageId,
                      localContent,
                    );
                    window.dispatchEvent(
                      new CustomEvent<ChatStreamingContentDetail>(
                        CHAT_STREAMING_CONTENT,
                        {
                        detail: {
                          messageId: currentMessageId,
                          content: localContent,
                        },
                        },
                      ),
                    );
                  } else if (
                    dataType === "reasoning" &&
                    currentMessageId &&
                    localContent
                  ) {
                    appendStreamingMessageReasoning(
                      currentMessageId,
                      localContent,
                    );
                    window.dispatchEvent(
                      new CustomEvent<ChatStreamingReasoningDetail>(
                        CHAT_STREAMING_REASONING,
                        {
                        detail: {
                          messageId: currentMessageId,
                          content: localContent,
                        },
                        },
                      ),
                    );
                  } else if (
                    dataType === "tool-input-start" &&
                    currentMessageId &&
                    localToolCallId &&
                    localToolName
                  ) {
                    window.dispatchEvent(
                      new CustomEvent<ChatStreamingToolCallDetail>(
                        CHAT_STREAMING_TOOL_CALL,
                        {
                        detail: {
                          messageId: currentMessageId,
                          toolCallId: localToolCallId,
                          toolName: localToolName,
                          args: "",
                          state: "streaming",
                        },
                        },
                      ),
                    );
                  } else if (
                    dataType === "tool-input-delta" &&
                    currentMessageId &&
                    localToolCallId &&
                    (localArgsSnapshot !== null || localInputTextDelta !== null)
                  ) {
                    window.dispatchEvent(
                      new CustomEvent<ChatStreamingToolInputUpdateDetail>(
                        CHAT_STREAMING_TOOL_INPUT_UPDATE,
                        {
                        detail: {
                          messageId: currentMessageId,
                          toolCallId: localToolCallId,
                          argsSnapshot: localArgsSnapshot ?? undefined,
                          argsDelta: localInputTextDelta ?? undefined,
                        },
                        },
                      ),
                    );
                  } else if (
                    dataType === "tool-input-available" &&
                    currentMessageId &&
                    localToolCallId
                  ) {
                    // Can either finish tool call or keep it streaming until "tool-call" event comes
                    // for now we just make sure we save the final args
                    window.dispatchEvent(
                      new CustomEvent<ChatStreamingToolInputUpdateDetail>(
                        CHAT_STREAMING_TOOL_INPUT_UPDATE,
                        {
                        detail: {
                          messageId: currentMessageId,
                          toolCallId: localToolCallId,
                          argsSnapshot:
                            typeof data.input === "string"
                              ? data.input
                              : JSON.stringify(data.input),
                          argsDelta: "",
                        },
                        },
                      ),
                    );
                  } else if (
                    dataType === "tool-output-partially-available" &&
                    currentMessageId &&
                    localToolCallId
                  ) {
                    window.dispatchEvent(
                      new CustomEvent<ChatStreamingToolOutputDetail>(
                        CHAT_STREAMING_TOOL_OUTPUT,
                        {
                        detail: {
                          messageId: currentMessageId,
                          toolCallId: localToolCallId,
                          output: data.output,
                        },
                        },
                      ),
                    );
                  } else if (dataType === "usage" && currentMessageId) {
                    const usage = data.usage || {};
                    const metrics = data.metrics || {};
                    trackEvent("llm_usage", {
                      thread_id: currentThreadId,
                      message_id: currentMessageId,
                      model_id: metrics.modelId || selectedModelId,
                      latency_ms: metrics.latencyMs ?? null,
                      ttft_ms: metrics.ttftMs ?? null,
                      finish_reason: metrics.finishReason ?? null,
                      prompt_tokens: usage.prompt_tokens ?? null,
                      completion_tokens: usage.completion_tokens ?? null,
                      total_tokens: usage.total_tokens ?? null,
                      cached_tokens: usage.cached_tokens ?? null,
                      reasoning_tokens: usage.reasoning_tokens ?? null,
                      cost: usage.cost ?? null,
                    });
                  } else if (dataType === "usage_error") {
                    const metrics = data.metrics || {};
                    trackEvent("llm_error", {
                      thread_id: currentThreadId,
                      message_id: currentMessageId,
                      model_id: metrics.modelId || selectedModelId,
                      latency_ms: metrics.latencyMs ?? null,
                      error: data.error || "Unknown error",
                    });
                  } else if (dataType === "error") {
                    toast.error(
                      typeof data?.error === "string"
                        ? data.error
                        : "Stream error",
                    );
                    await terminateStream();
                    break readLoop;
                  } else if (dataType === "done") {
                    await terminateStream();
                    break readLoop;
                  }
                } catch (e) {
                  // Partial or corrupted data skip
                }
              }
            }
          }
        }

        setIsGenerating(false);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          console.log("[ChatInput] Stream aborted by user");
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Failed to send message";
        toast.error(errorMessage);
        console.error("[ChatInput] Failed to send message:", {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "UnknownError",
          stack: error instanceof Error ? error.stack : undefined,
          error,
        });
      } finally {
        if (activeRequestId) {
          clearActiveChatStream(activeRequestId);
        }
        setIsGenerating(false);
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
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {isDragActive && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/80 text-sm font-semibold text-t3-berry backdrop-blur-sm">
                Drop files to attach
              </div>
            )}
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
                id="chat-input"
                name="chat_message"
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
                    onSelect={handleModelSelect}
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
                    id="chat-attachments"
                    name="chat_attachments"
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleFileSelect}
                  />
                </div>

                <div>
                  {(() => {
                    const isAbortVisible =
                      isGenerating || isThreadStreaming || hasActiveStream;
                    return (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isAbortVisible) {
                        handleStop();
                      } else {
                        handleSend();
                      }
                    }}
                    disabled={
                      !content.trim() &&
                      attachments.length === 0 &&
                      !isAbortVisible
                    }
                    className={cn(
                      // Critical: Maintain min 44x44px touch target for mobile
                      "z-20 flex touch-manipulation items-center justify-center rounded-xl transition-all duration-300",
                      "min-h-[44px] min-w-[44px] p-2 md:p-2.5",
                      content.trim() ||
                        attachments.length > 0 ||
                        isAbortVisible
                        ? isAbortVisible
                          ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                          : "bg-t3-berry text-white shadow-lg shadow-t3-berry/20"
                        : "cursor-not-allowed bg-black/5 text-black/40",
                    )}
                  >
                    {isAbortVisible ? (
                      <StopCircle
                        size={isMobile ? 22 : 20}
                        className="fill-current text-white"
                      />
                    ) : (
                      <ArrowUp size={isMobile ? 22 : 20} strokeWidth={2.5} />
                    )}
                  </motion.button>
                    );
                  })()}
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
