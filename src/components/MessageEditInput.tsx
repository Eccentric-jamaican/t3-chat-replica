import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Paperclip, Globe, X, Brain } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useMutation, useAction } from "convex/react"
import { api } from "../../convex/_generated/api"
import { ModelPicker } from './ModelPicker'
import { fetchOpenRouterModels, type AppModel } from '../lib/openrouter'
import { useIsMobile } from '../hooks/useIsMobile'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface MessageEditInputProps {
  messageId: string
  threadId: string
  initialContent: string
  initialAttachments?: Array<{
    storageId: string
    type: string
    name: string
    size: number
    url?: string
  }>
  onCancel: () => void
  onSubmit: () => void
}

export function MessageEditInput({
  messageId,
  threadId,
  initialContent,
  initialAttachments = [],
  onCancel,
  onSubmit
}: MessageEditInputProps) {
  const isMobile = useIsMobile()
  const [content, setContent] = useState(initialContent)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedModelId, setSelectedModelId] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('t3_selected_model')
      if (saved) return saved
    }
    return "google/gemini-2.0-flash-exp:free"
  })

  const [searchEnabled, setSearchEnabled] = useState(false)
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('t3_reasoning_effort')
    }
    return null
  })
  const [models, setModels] = useState<AppModel[]>([])

  useEffect(() => {
    fetchOpenRouterModels().then(setModels)
  }, [])

  const currentModel = models.find(m => m.id === selectedModelId)
  const reasoningType = currentModel?.reasoningType // 'effort' | 'max_tokens' | null
  const supportsReasoning = reasoningType != null

  const toggleReasoning = () => {
    // Cycle through effort levels appropriate for the reasoning type
    if (reasoningType === 'effort') {
      const levels: (string | null)[] = [null, 'low', 'medium', 'high']
      const currentIndex = levels.indexOf(reasoningEffort)
      const nextIndex = (currentIndex + 1) % levels.length
      const newEffort = levels[nextIndex]
      setReasoningEffort(newEffort)
      if (newEffort) {
        localStorage.setItem('t3_reasoning_effort', newEffort)
      } else {
        localStorage.removeItem('t3_reasoning_effort')
      }
    } else if (reasoningType === 'max_tokens') {
      // For max_tokens models, just toggle on/off with a sensible default
      const newEffort = reasoningEffort ? null : 'medium'
      setReasoningEffort(newEffort)
      if (newEffort) {
        localStorage.setItem('t3_reasoning_effort', newEffort)
      } else {
        localStorage.removeItem('t3_reasoning_effort')
      }
    }
  }

  const [attachments, setAttachments] = useState<{
    storageId: string
    type: string
    name: string
    size: number
    previewUrl: string
  }[]>(initialAttachments.map(a => ({ ...a, previewUrl: a.url || '' })))

  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const updateMessage = useMutation(api.messages.update)
  const deleteAfter = useMutation(api.messages.deleteAfter)
  const streamAnswer = useAction(api.chat.streamAnswer)
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl)

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [content])

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
    // Move cursor to end
    if (textareaRef.current) {
      textareaRef.current.selectionStart = textareaRef.current.value.length
      textareaRef.current.selectionEnd = textareaRef.current.value.length
    }
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)

    try {
      const newAttachments: typeof attachments = []
      for (const file of files) {
        const postUrl = await generateUploadUrl()
        const result = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        })
        const { storageId } = await result.json()

        newAttachments.push({
          storageId,
          type: file.type,
          name: file.name,
          size: file.size,
          previewUrl: URL.createObjectURL(file)
        })
      }
      setAttachments(prev => [...prev, ...newAttachments])
    } catch (error) {
      console.error("Upload failed", error)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      // Update the message content
      await updateMessage({ id: messageId as any, content: content.trim() })

      // Delete all messages after this one
      await deleteAfter({
        threadId: threadId as any,
        afterMessageId: messageId as any
      })

      // Save model selection
      localStorage.setItem('t3_selected_model', selectedModelId)

      // Regenerate response with the selected model
      // Only pass reasoningEffort when the current model supports reasoning
      await streamAnswer({
        threadId: threadId as any,
        modelId: selectedModelId,
        reasoningEffort: supportsReasoning && reasoningEffort ? reasoningEffort : undefined,
        reasoningType: supportsReasoning && reasoningEffort ? reasoningType : undefined,
        webSearch: searchEnabled
      })

      onSubmit()
    } catch (error) {
      console.error("Failed to update and regenerate:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className={cn("w-full", isMobile ? "max-w-full" : "max-w-[768px]")}>
      <div className={cn(
        "relative rounded-2xl transition-all duration-300 border border-fuchsia-200/50 bg-white/80 backdrop-blur-sm overflow-hidden shadow-lg",
        "focus-within:ring-[4px] focus-within:ring-primary/10"
      )}>
        {/* Attachment Previews */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-b border-black/5 overflow-hidden"
            >
              <div className="p-3 flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    {att.type.startsWith('image/') ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="h-16 w-16 object-cover rounded-lg border border-black/10"
                      />
                    ) : (
                      <div className="h-16 px-3 flex items-center gap-2 bg-black/5 rounded-lg border border-black/10">
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-xs font-medium truncate max-w-[100px]">{att.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
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
        <div className="px-4 py-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Edit your message..."
            className="w-full bg-transparent border-none outline-none resize-none text-[15px] leading-relaxed placeholder-foreground/30 min-h-[24px] max-h-[200px]"
            style={{ height: 'auto' }}
          />
        </div>

        {/* Bottom Action Row - Responsive layout */}
        <div className={cn(
          "border-t border-black/5 bg-black/[0.02]",
          isMobile ? "px-2 py-2" : "px-3 py-2"
        )}>
          <div className={cn(
            "flex items-center gap-1.5",
            isMobile ? "flex-wrap" : "justify-between"
          )}>
            {/* Left side: Model picker and toggles */}
            <div className="flex items-center gap-1.5 flex-wrap">
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
                    "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                    !reasoningEffort && "bg-black/5 text-foreground/40 hover:bg-black/10",
                    reasoningEffort === 'low' && "bg-fuchsia-100/30 text-fuchsia-600/80",
                    reasoningEffort === 'medium' && "bg-fuchsia-100/60 text-fuchsia-800/80",
                    reasoningEffort === 'high' && "bg-fuchsia-600/80 text-white"
                  )}
                >
                  <Brain size={isMobile ? 12 : 14} className={reasoningEffort ? "fill-current" : ""} />
                  <span className="capitalize">{reasoningEffort || 'Off'}</span>
                </button>
              )}

              {/* Search Toggle - Always visible */}
              <button
                onClick={() => setSearchEnabled(!searchEnabled)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  searchEnabled
                    ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                    : "bg-black/5 text-foreground/40 hover:bg-black/10"
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
                className="p-1.5 rounded-lg hover:bg-black/5 text-foreground/40 hover:text-foreground/60 transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
                ) : (
                  <Paperclip size={isMobile ? 14 : 16} />
                )}
              </button>
            </div>

            {/* Right side: Cancel and Submit */}
            <div className={cn(
              "flex items-center gap-1.5",
              isMobile && "ml-auto"
            )}>
              {/* Cancel Button */}
              <button
                onClick={onCancel}
                className="px-2 py-1.5 text-[11px] font-medium text-foreground/50 hover:text-foreground/70 transition-colors"
              >
                Cancel
              </button>

              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={!content.trim() || isSubmitting}
                className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                  content.trim() && !isSubmitting
                    ? "bg-t3-berry text-white shadow-sm hover:bg-t3-berry-deep"
                    : "bg-black/10 text-foreground/30 cursor-not-allowed"
                )}
              >
                {isSubmitting ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
        <div className="text-[11px] text-foreground/40 mt-2 text-center">
          Press <kbd className="px-1.5 py-0.5 bg-black/5 rounded text-[10px] font-mono">Enter</kbd> to submit, <kbd className="px-1.5 py-0.5 bg-black/5 rounded text-[10px] font-mono">Esc</kbd> to cancel
        </div>
      )}
    </div>
  )
}
