import { useState, useRef, useEffect } from "react";
import { ArrowUp, Paperclip, Globe, X, Brain } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ModelPicker } from "./ModelPicker";
import { fetchOpenRouterModels, type AppModel } from "../../lib/openrouter";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useNavigate } from "@tanstack/react-router";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MessageEditInputProps {
  messageId: string;
  threadId: string;
  initialContent: string;
  initialAttachments?: Array<{
    storageId: string;
    type: string;
    name: string;
    size: number;
    url?: string;
  }>;
  onCancel: () => void;
  onSubmit: () => void;
}

export function MessageEditInput({
  messageId,
  threadId,
  initialContent,
  initialAttachments = [],
  onCancel,
  onSubmit,
}: MessageEditInputProps) {
  const isMobile = useIsMobile();
  const [content, setContent] = useState(initialContent);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get sessionId for ownership verification
  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem("sendcat_session_id") || undefined
      : undefined;

  const [selectedModelId, setSelectedModelId] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("t3_selected_model");
      if (saved) return saved;
    }
    return "google/gemini-2.0-flash-exp:free";
  });

  const [searchEnabled, setSearchEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("t3_reasoning_effort");
    }
    return null;
  });
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
      const levels: (string | null)[] = [null, "low", "medium", "high"];
      const currentIndex = levels.indexOf(reasoningEffort);
      const nextIndex = (currentIndex + 1) % levels.length;
      const newEffort = levels[nextIndex];
      setReasoningEffort(newEffort);
      if (newEffort) {
        localStorage.setItem("t3_reasoning_effort", newEffort);
      } else {
        localStorage.removeItem("t3_reasoning_effort");
      }
    } else if (reasoningType === "max_tokens") {
      // For max_tokens models, just toggle on/off with a sensible default
      const newEffort = reasoningEffort ? null : "medium";
      setReasoningEffort(newEffort);
      if (newEffort) {
        localStorage.setItem("t3_reasoning_effort", newEffort);
      } else {
        localStorage.removeItem("t3_reasoning_effort");
      }
    }
  };

  const [attachments, setAttachments] = useState<
    {
      storageId: string;
      type: string;
      name: string;
      size: number;
      previewUrl: string;
    }[]
  >(initialAttachments.map((a) => ({ ...a, previewUrl: a.url || "" })));

  const [uploading, setUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const dragDepthRef = useRef(0);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, []);

  const messages = useQuery(api.messages.list, { threadId: threadId as any, sessionId });
  const currentThread = useQuery(api.threads.get, { id: threadId as any, sessionId: sessionId ?? "" });
  const navigate = useNavigate();
  const createThread = useMutation(api.threads.create);
  const sendMessage = useMutation(api.messages.send);
  const streamAnswer = useAction(api.chat.streamAnswer);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [content]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
    // Move cursor to end
    if (textareaRef.current) {
      textareaRef.current.selectionStart = textareaRef.current.value.length;
      textareaRef.current.selectionEnd = textareaRef.current.value.length;
    }
  }, []);

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
        const postUrl = await generateUploadUrl();
        const result = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const { storageId } = await result.json();

        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);

        newAttachments.push({
          storageId,
          type: file.type,
          name: file.name,
          size: file.size,
          previewUrl,
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
    const attachment = attachments[index];
    if (attachment?.previewUrl && previewUrlsRef.current.has(attachment.previewUrl)) {
      URL.revokeObjectURL(attachment.previewUrl);
      previewUrlsRef.current.delete(attachment.previewUrl);
    }
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting || !messages) return;
    setIsSubmitting(true);

    try {
      // Find the message index
      const messageIndex = messages.findIndex((m: any) => m._id === messageId);
      if (messageIndex === -1) return;

      const messagesToCopy = messages.slice(0, messageIndex); // Copy all messages BEFORE this one
      
      // Determine the correct parent thread ID (avoid unnecessary nesting)
      // If we are editing a message that exists in the parent thread, the new branch should be a sibling.
      let finalParentThreadId = threadId;
      if (currentThread?.parentThreadId) {
        // Simple heuristic: if we are editing an' earlier part of the conversation, 
        // we might want a sibling branch.
        // For now, if it's already a branch, we favor sibling branches for clarity unless specified otherwise.
        // t3.chat handles this by making forks flat under the original root usually.
        finalParentThreadId = currentThread.parentThreadId as any;
      }

      // [AGENTIC] Unified Session Ownership
      const storedSessionId = typeof window !== "undefined" ? localStorage.getItem("sendcat_session_id") : null;
      const effectiveSessionId = storedSessionId || uuidv4();
      
      if (!storedSessionId && typeof window !== "undefined") {
        localStorage.setItem("sendcat_session_id", effectiveSessionId);
      }

      // Create new branched thread
      const newThreadId = await createThread({
        sessionId: effectiveSessionId,
        modelId: selectedModelId,
        title: content.trim().slice(0, 40),
        parentThreadId: finalParentThreadId as any,
      });

      // Copy messages before
      for (const msg of messagesToCopy) {
        if (msg.role === "user" || msg.role === "assistant") {
          await sendMessage({
            threadId: newThreadId,
            content: msg.content,
            role: msg.role,
            sessionId: effectiveSessionId,
            attachments: msg.attachments?.map((a: any) => ({
              storageId: a.storageId,
              type: a.type,
              name: a.name,
              size: a.size,
            })),
          });
        }
      }

      // Send the EDITED message as the last user message
      await sendMessage({
        threadId: newThreadId,
        content: content.trim(),
        role: "user",
        sessionId: effectiveSessionId,
        attachments: attachments.map((a) => ({
          storageId: a.storageId as any,
          type: a.type,
          name: a.name,
          size: a.size,
        })),
      });

      // Save model selection
      localStorage.setItem("t3_selected_model", selectedModelId);

      // CRITICAL: Close UI and Navigate IMMEDIATELY before starting the slow stream
      onSubmit();
      navigate({ to: "/chat/$threadId", params: { threadId: newThreadId } });

      // Regenerate response in the new thread (fire and forget on the server)
      await streamAnswer({
        threadId: newThreadId,
        modelId: selectedModelId,
        reasoningEffort:
          supportsReasoning && reasoningEffort ? reasoningEffort : undefined,
        reasoningType:
          supportsReasoning && reasoningEffort ? (reasoningType as any) : undefined,
        webSearch: searchEnabled,
      });
    } catch (error) {
      console.error("Failed to edit and branch:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className={cn("w-full", isMobile ? "max-w-full" : "max-w-[768px]")}>
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-fuchsia-200/50 bg-white/80 shadow-lg backdrop-blur-sm transition-all duration-300",
          "focus-within:ring-[4px] focus-within:ring-primary/10",
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/80 text-sm font-semibold text-fuchsia-700 backdrop-blur-sm">
            Drop files to attach
          </div>
        )}
        {/* Attachment Previews */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-black/5"
            >
              <div className="flex flex-wrap gap-2 p-3">
                {attachments.map((att, i) => (
                  <div key={i} className="group relative">
                    {att.type.startsWith("image/") ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="h-16 w-16 rounded-lg border border-black/10 object-cover"
                      />
                    ) : (
                      <div className="flex h-16 items-center gap-2 rounded-lg border border-black/10 bg-black/5 px-3">
                        <svg
                          className="h-5 w-5 text-gray-500"
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
                        <span className="max-w-[100px] truncate text-xs font-medium">
                          {att.name}
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text Input */}
        <div className={cn(isMobile ? "px-3 pt-2 pb-1" : "px-5 pt-4 pb-2")}>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Edit your message..."
            className={cn(
              "max-h-[200px] min-h-[24px] w-full resize-none border-none bg-transparent text-[15px] placeholder-foreground/30 outline-none",
              isMobile ? "leading-normal" : "leading-relaxed",
            )}
            style={{ height: "auto" }}
          />
        </div>

        {/* Bottom Action Row - Responsive layout */}
        <div
          className={cn(
            "border-t border-black/5 bg-black/[0.02]",
            isMobile ? "px-2 pt-1 pb-2" : "px-4 pt-1 pb-3",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between gap-1.5",
              isMobile && "flex-wrap",
            )}
          >
            {/* Left side: Model picker and toggles */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Model Picker */}
              <ModelPicker
                selectedModelId={selectedModelId}
                onSelect={setSelectedModelId}
              />

              {/* Reasoning Toggle */}
              {supportsReasoning && (
                <button
                  onClick={toggleReasoning}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all",
                    !reasoningEffort &&
                      "bg-black/5 text-foreground/40 hover:bg-black/10",
                    reasoningEffort === "low" &&
                      "bg-fuchsia-100/30 text-fuchsia-600/80",
                    reasoningEffort === "medium" &&
                      "bg-fuchsia-100/60 text-fuchsia-800/80",
                    reasoningEffort === "high" &&
                      "bg-fuchsia-600/80 text-white",
                  )}
                >
                  <Brain
                    size={isMobile ? 12 : 14}
                    className={reasoningEffort ? "fill-current" : ""}
                  />
                  <span className="capitalize">{reasoningEffort || "Off"}</span>
                </button>
              )}

              {/* Search Toggle - Always visible */}
              <button
                onClick={() => setSearchEnabled(!searchEnabled)}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all",
                  searchEnabled
                    ? "border border-blue-500/20 bg-blue-500/10 text-blue-600"
                    : "bg-black/5 text-foreground/40 hover:bg-black/10",
                )}
              >
                <Globe size={isMobile ? 12 : 14} />
                {!isMobile && <span>Search</span>}
              </button>

              {/* Attachment Button */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-lg p-1.5 text-foreground/40 transition-colors hover:bg-black/5 hover:text-foreground/60 disabled:opacity-50"
              >
                {uploading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
                ) : (
                  <Paperclip size={isMobile ? 14 : 16} />
                )}
              </button>
            </div>

            {/* Right side: Cancel and Submit */}
            <div
              className={cn("flex items-center gap-1.5", isMobile && "ml-auto")}
            >
              {/* Cancel Button */}
              <button
                onClick={onCancel}
                className="px-2 py-1.5 text-[11px] font-medium text-foreground/50 transition-colors hover:text-foreground/70"
              >
                Cancel
              </button>

              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={!content.trim() || isSubmitting}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                  content.trim() && !isSubmitting
                    ? "bg-t3-berry text-white shadow-sm hover:bg-t3-berry-deep"
                    : "cursor-not-allowed bg-black/10 text-foreground/30",
                )}
              >
                {isSubmitting ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <ArrowUp size={14} strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard hint - hide on mobile */}
      {!isMobile && (
        <div className="mt-2 text-center text-[11px] text-foreground/40">
          Press{" "}
          <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to submit,{" "}
          <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px]">
            Esc
          </kbd>{" "}
          to cancel
        </div>
      )}
    </div>
  );
}
