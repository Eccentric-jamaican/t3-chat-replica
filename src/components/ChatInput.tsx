import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { fetchOpenRouterModels, type AppModel } from '../lib/openrouter'
import { ArrowUp, Paperclip, Globe, StopCircle, X, Brain } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useMutation, useAction, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import { v4 as uuidv4 } from 'uuid'
import { useNavigate } from "@tanstack/react-router"
import { ModelPicker } from './ModelPicker'
import { useIsMobile } from '../hooks/useIsMobile'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface ChatInputProps {
  existingThreadId?: string
}

export interface ChatInputHandle {
  setContentAndSend: (text: string) => void
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({ existingThreadId }, ref) => {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [content, setContent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showBanner, setShowBanner] = useState(true)

  const [selectedModelId, setSelectedModelId] = useState(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('t3_selected_model')
        if (saved) return saved
    }
    return "openai/gpt-oss-120b:free"
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('t3_selected_model', selectedModelId)
    }
  }, [selectedModelId])

  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null)
  const [searchEnabled, setSearchEnabled] = useState(false)
  const [models, setModels] = useState<AppModel[]>([])

  useEffect(() => {
    fetchOpenRouterModels().then(setModels)
  }, [])

  const currentModel = models.find(m => m.id === selectedModelId)
  const reasoningType = currentModel?.reasoningType // 'effort' | 'max_tokens' | null
  const supportsReasoning = reasoningType != null
  const supportsTools = currentModel?.supportsTools

  const toggleReasoning = () => {
    // Cycle through effort levels appropriate for the reasoning type
    if (reasoningType === 'effort') {
      const levels = [null, 'low', 'medium', 'high']
      const currentIndex = levels.indexOf(reasoningEffort)
      const nextIndex = (currentIndex + 1) % levels.length
      setReasoningEffort(levels[nextIndex])
    } else if (reasoningType === 'max_tokens') {
      // For max_tokens models, just toggle on/off with a sensible default
      setReasoningEffort(reasoningEffort ? null : 'medium')
    }
  }
  
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return ""
    const saved = localStorage.getItem('t3_session_id')
    if (saved) return saved
    const newId = uuidv4()
    localStorage.setItem('t3_session_id', newId)
    return newId
  })
  const [threadId, setThreadId] = useState<string | null>(existingThreadId || null)
  
  const createThread = useMutation(api.threads.create)
  const sendMessage = useMutation(api.messages.send)
  const streamAnswer = useAction(api.chat.streamAnswer)
  const abortLatestInThread = useMutation(api.messages.abortLatestInThread)
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl)
  const isThreadStreaming = useQuery(api.messages.isThreadStreaming, threadId ? { threadId: threadId as any } : "skip")
  
  const getAbortKey = (tid: string) => `abort_${tid}`
  
  const [attachments, setAttachments] = useState<{
    storageId: string;
    type: string;
    name: string;
    size: number;
    previewUrl: string;
  }[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)

    try {
      const newAttachments: typeof attachments = []
      for (const file of files) {
        // Upload to Convex Storage
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

  useEffect(() => {
    setThreadId(existingThreadId || null)
  }, [existingThreadId])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`
    }
  }, [content])

  const handleStop = async () => {
    console.log("Stopping generation, threadId:", threadId);
    if (threadId) {
      localStorage.setItem(getAbortKey(threadId), Date.now().toString());
      await abortLatestInThread({ threadId: threadId as any })
      console.log("Aborted latest message in thread");
    }
    setIsGenerating(false)
  }
 
  useImperativeHandle(ref, () => ({
    setContentAndSend: (text: string) => {
      handleSend(text)
    }
  }))

  const handleSend = async (forcedContent?: string) => {
    const textToSend = forcedContent !== undefined ? forcedContent : content
    if (!textToSend.trim() || isGenerating) return
    setIsGenerating(true)
    
    // Store content before clearing input
    const messageContent = textToSend.trim()
    if (forcedContent === undefined) {
      setContent('')
    }
 
    try {
      let currentThreadId = threadId
      
      if (!currentThreadId) {
        currentThreadId = await createThread({
          sessionId,
          modelId: selectedModelId,
          title: messageContent.slice(0, 40),
        })
        setThreadId(currentThreadId)
        // Navigate to the new thread page
        navigate({ to: '/chat/$threadId', params: { threadId: currentThreadId } })
      }
      
      // Clear any previous abort flag for this thread
      localStorage.removeItem(getAbortKey(currentThreadId))
      
      await sendMessage({
        threadId: currentThreadId as any,
        content: messageContent,
        role: "user",
        attachments: attachments.map(({ storageId, type, name, size }) => ({
          storageId, type, name, size
        })) as any
      })
      
      setAttachments([])
       
      // Trigger LLM streaming with abort key
      // Only pass reasoningEffort when the current model supports reasoning AND it's set
      await streamAnswer({
        threadId: currentThreadId as any,
        modelId: selectedModelId,
        reasoningEffort: supportsReasoning && reasoningEffort ? reasoningEffort : undefined,
        webSearch: searchEnabled,
        abortKey: getAbortKey(currentThreadId)
      })
       
      setIsGenerating(false)
      
    } catch (error) {
      console.error("Failed to send message:", error)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className={cn(
      "fixed bottom-0 right-0 px-2 pb-2 md:px-4 md:pb-6 pointer-events-none z-50 text-center transition-all duration-300",
      isMobile ? "left-0" : "left-[240px]"
    )}>
      <div className="max-w-[768px] mx-auto pointer-events-auto w-full">
        
        {/* T3 Credits Banner */}
        <AnimatePresence>
          {showBanner && !isGenerating && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mb-2 md:mb-5 flex items-center justify-between gap-2 md:gap-4 px-4 md:px-5 py-1.5 md:py-3 bg-[rgb(254,235,231)] border border-[rgb(238,225,237)] rounded-2xl text-[12px] md:text-[13.5px] text-[rgb(80,24,84)] font-medium shadow-sm"
            >
              <div className="flex-1 text-center">
                You only have 9 message credits left. <button className="underline font-bold">Sign in to get a higher limit (it's free!)</button>
              </div>
              <button 
                onClick={() => setShowBanner(false)}
                className="p-1 hover:bg-black/5 rounded-full transition-colors"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Input Container - Flex Column Layout like Original */}
        <div className={cn(
          "relative rounded-2xl transition-all duration-300 border-reflect input-glow overflow-hidden",
          "focus-within:ring-[6px] focus-within:ring-primary/10 transition-shadow duration-500"
        )}>
          {/* Top-Right Toggle Pill (Reasoning/Expert) - Hidden on mobile to save space, or moved */}
          {!isMobile && (
            <div className="absolute top-4 right-4 z-10">
              <div className="flex items-center gap-0.5 p-1 rounded-full border border-t3-berry/10 bg-white/40 backdrop-blur-sm">
                <button className="p-1.5 rounded-full bg-white shadow-sm flex items-center justify-center">
                  <Globe size={16} className="text-[#00a67e]" />
                </button>
                <button className="p-1.5 rounded-full flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full border-2 border-t3-berry/20 flex items-center justify-center">
                    <span className="text-[10px] font-black text-t3-berry">G</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Flex Column: Textarea + Bottom Row */}
          <div className="flex flex-col">
            {/* Attachments Preview */}
            <div className="px-3 md:px-5 pt-2 md:pt-4 flex gap-2 md:gap-3 flex-wrap">
              {attachments.map((att, i) => (
                <div key={i} className="relative group w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden border border-white/10 shadow-sm bg-black/5">
                  {att.type.startsWith('image/') ? (
                    <img src={att.previewUrl} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-foreground/50 p-2 text-center break-words leading-tight">
                      <Paperclip size={16} className="mb-1 opacity-50" />
                      {att.name}
                    </div>
                  )}
                  <button 
                    onClick={() => removeAttachment(i)}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {uploading && (
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl flex items-center justify-center bg-black/5 animate-pulse">
                  <div className="w-4 h-4 border-2 border-t3-berry border-t-transparent rounded-full animate-spin" />
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
                if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Type your message here..."
              className="w-full bg-transparent px-3 md:px-5 pt-2 md:pt-4 pb-1 md:pb-2 text-foreground placeholder-foreground/35 outline-none resize-none min-h-[44px] md:min-h-[48px] max-h-[160px] md:max-h-[400px] overflow-y-auto text-[14px] md:text-[15.5px] leading-relaxed"
            />

            {/* Bottom Action Row - Separate from textarea */}
            <div className="flex items-center justify-between px-2 md:px-4 pb-2 md:pb-3 pt-1 gap-1 md:gap-2">
              <div className="flex items-center gap-1 md:gap-2">
                <ModelPicker 
                  selectedModelId={selectedModelId} 
                  onSelect={setSelectedModelId} 
                />
                
                {supportsReasoning && (
                  <button 
                    onClick={toggleReasoning}
                    className={cn(
                      "glass-pill transition-all duration-300 group/thinking relative !px-2 md:!px-3",
                      !reasoningEffort && "opacity-40 hover:opacity-100",
                      reasoningEffort === 'low' && "bg-fuchsia-100/30 text-fuchsia-600/80 border-fuchsia-200/20",
                      reasoningEffort === 'medium' && "bg-fuchsia-100/60 text-fuchsia-800/80 border-fuchsia-200/50 shadow-sm",
                      reasoningEffort === 'high' && "bg-fuchsia-600/80 text-white border-fuchsia-500/50 shadow-[0_0_15px_-5px_theme(colors.fuchsia.600)] animate-pulse-slow"
                    )}
                  >
                    <div className="flex items-center gap-1.5 relative">
                      <Brain 
                        size={isMobile ? 14 : 15} 
                        className={cn(
                          "transition-transform duration-500 group-hover/thinking:scale-110",
                          reasoningEffort ? "fill-current" : "fill-none"
                        )} 
                      />
                      <span className="font-semibold text-[11px] md:text-[12px] uppercase tracking-wide hidden sm:inline">
                        {reasoningEffort ? reasoningEffort : 'Off'}
                      </span>
                      
                      {/* Effort Indicator dots */}
                      {reasoningEffort && (
                        <div className="flex gap-0.5 ml-0.5">
                          <div className={cn("w-1 h-1 rounded-full", reasoningEffort ? "bg-current" : "bg-current/20")} />
                          <div className={cn("w-1 h-1 rounded-full", (reasoningEffort === 'medium' || reasoningEffort === 'high') ? "bg-current" : "bg-current/20")} />
                          <div className={cn("w-1 h-1 rounded-full", reasoningEffort === 'high' ? "bg-current" : "bg-current/20")} />
                        </div>
                      )}
                    </div>
                  </button>
                )}

                {supportsTools && (
                  <button 
                    onClick={() => setSearchEnabled(!searchEnabled)}
                    className={cn(
                      "glass-pill transition-all cursor-pointer !px-2 md:!px-3",
                      searchEnabled ? "bg-blue-500/10 text-blue-600 border-blue-500/20 opacity-100" : "opacity-60 hover:opacity-100"
                    )}
                  >
                    <Globe size={isMobile ? 14 : 15} className={cn(searchEnabled && "text-blue-600")} />
                    <span className="hidden sm:inline">Search</span>
                  </button>
                )}

                <button 
                  className="glass-pill opacity-30 hover:opacity-60 !px-2"
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
                  onClick={() => (isGenerating || isThreadStreaming) ? handleStop() : handleSend()}
                  disabled={!content.trim() && !isGenerating && !isThreadStreaming}
                  className={cn(
                    "p-2 md:p-2.5 rounded-xl transition-all duration-300",
                    content.trim() || isGenerating || isThreadStreaming
                      ? (isGenerating || isThreadStreaming)
                        ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                        : "bg-t3-berry text-white shadow-lg shadow-t3-berry/20" 
                      : "bg-black/5 text-black/40 cursor-not-allowed"
                  )}
                >
                  {(isGenerating || isThreadStreaming) ? (
                    <StopCircle size={isMobile ? 18 : 20} className="fill-current text-white" />
                  ) : (
                    <ArrowUp size={isMobile ? 18 : 20} strokeWidth={2.5} />
                  )}
                </motion.button>
              </div>
            </div>
          </div>
        </div>
        
        <p className="text-[11px] text-center mt-2 md:mt-3.5 text-foreground/35 font-semibold tracking-tight">
          T3.chat can make mistakes. Check important info.
        </p>
      </div>
    </div>
  )
})

ChatInput.displayName = 'ChatInput'
