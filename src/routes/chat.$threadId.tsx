import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { useIsMobile } from '../hooks/useIsMobile'
import { ChatInput, type ChatInputHandle } from '../components/ChatInput'
import { useQuery, useMutation, useAction } from "convex/react"
import { api } from "../../convex/_generated/api"
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Edit3, Copy, GitBranch, RotateCcw, Check } from 'lucide-react'
import { toast } from 'sonner'
import { LandingHero } from '../components/LandingHero'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useState, useRef, useEffect } from 'react'
import { Markdown } from '../components/Markdown'
import { SearchToolResult } from '../components/SearchToolResult'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { StreamingMessage } from '../components/StreamingMessage'
import { ReasoningBlock } from '../components/ReasoningBlock'
import { MessageActionMenu } from '../components/MessageActionMenu'
import { MessageEditInput } from '../components/MessageEditInput'
import { MessageMetadata } from '../components/MessageMetadata'
import { ProductGrid } from '../components/ProductGrid'
import { ProductDrawer } from '../components/ProductDrawer'
import { ProductExpandedView } from '../components/ProductExpandedView'
import { SelectionActionBar } from '../components/SelectionActionBar'
import { v4 as uuidv4 } from 'uuid'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper to get a display name from model ID
function getModelDisplayName(modelId: string): string {
  // Extract the model name from the ID (e.g., "openai/gpt-5.2" -> "GPT-5.2")
  const modelMap: Record<string, string> = {
    'google/gemini-2.0-flash-exp:free': 'Gemini 2.0 Flash',
    'google/gemini-flash-1.5': 'Gemini 1.5 Flash',
    'google/gemini-pro-1.5': 'Gemini 1.5 Pro',
    'anthropic/claude-3-opus': 'Claude 3 Opus',
    'anthropic/claude-3.5-sonnet': 'Claude 3.5 Sonnet',
    'anthropic/claude-3-haiku': 'Claude 3 Haiku',
    'openai/gpt-4o': 'GPT-4o',
    'openai/gpt-4o-mini': 'GPT-4o Mini',
    'openai/gpt-4-turbo': 'GPT-4 Turbo',
    'openai/o1-mini': 'o1-mini',
    'openai/o1-preview': 'o1-preview',
    'deepseek/deepseek-chat': 'DeepSeek V3',
    'deepseek/deepseek-r1': 'DeepSeek R1',
    'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
  }
  
  if (modelMap[modelId]) return modelMap[modelId]

  
  // Fallback: extract name from ID
  const parts = modelId.split('/')
  const name = parts[parts.length - 1]
    .replace(/:free$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
  return name
}

type ChatSearchParams = {
  productId?: string
}

export const Route = createFileRoute('/chat/$threadId')({
  validateSearch: (search: Record<string, unknown>): ChatSearchParams => ({
    productId: typeof search.productId === 'string' ? search.productId : undefined,
  }),
  component: ChatPage,
})

function ChatPage() {
  const { threadId } = Route.useParams()
  const { productId } = Route.useSearch()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const messages = useQuery(api.messages.list, { threadId: threadId as any })
  const deleteAfter = useMutation(api.messages.deleteAfter)
  const streamAnswer = useAction(api.chat.streamAnswer)
  const createThread = useMutation(api.threads.create)
  const sendMessage = useMutation(api.messages.send)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null)
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const [isExpandedOpen, setIsExpandedOpen] = useState(false)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const chatInputRef = useRef<ChatInputHandle>(null)

  const handleOpenExpanded = () => {
    if (sidebarOpen && !isMobile) {
      setSidebarOpen(false)
      setTimeout(() => {
        setIsExpandedOpen(true)
      }, 300)
    } else {
      setIsExpandedOpen(true)
    }
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevMessageCount = useRef(0)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  // Only scroll when a new message is added, not during streaming content updates
  useEffect(() => {
    if (messages && messages.length > prevMessageCount.current) {
      scrollToBottom()
      prevMessageCount.current = messages.length
    }
  }, [messages?.length])

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast("Copied to clipboard!", {
      icon: (
        <div className="w-5 h-5 bg-black rounded-full flex items-center justify-center">
          <Check size={12} className="text-white stroke-[3]" />
        </div>
      ),
      duration: 2000,
      className: "font-medium"
    })
    setTimeout(() => setCopiedId(null), 2000)
  }


  // Retry: delete messages after the user message and regenerate response
  const handleRetry = async (userMessageId: string, modelId?: string) => {
    // Prevent duplicate retries on the same message
    if (retryingMessageId === userMessageId) return
    setRetryingMessageId(userMessageId)

    try {
      // Delete all messages after this user message
      await deleteAfter({
        threadId: threadId as any,
        afterMessageId: userMessageId as any
      })

      // Get the model to use (either specified or from localStorage)
      const selectedModel = modelId || localStorage.getItem('t3_selected_model') || 'google/gemini-2.0-flash-exp:free'

      // Detect reasoning type based on model ID patterns (per OpenRouter docs)
      const modelLower = selectedModel.toLowerCase()
      const supportsEffortReasoning =
        modelLower.includes('/o1') ||
        modelLower.includes('/o3') ||
        modelLower.includes('/gpt-5') ||
        modelLower.includes('grok')

      const supportsMaxTokensReasoning =
        (modelLower.includes('gemini') && modelLower.includes('thinking')) ||
        modelLower.includes('claude-3.7') ||
        modelLower.includes('claude-sonnet-4') ||
        modelLower.includes('claude-4') ||
        (modelLower.includes('qwen') && modelLower.includes('thinking')) ||
        modelLower.includes('deepseek-r1')

      const savedReasoning = localStorage.getItem('t3_reasoning_effort')
      const reasoningEffort = (supportsEffortReasoning || supportsMaxTokensReasoning) && savedReasoning
        ? savedReasoning as 'low' | 'medium' | 'high'
        : undefined
      const reasoningType = supportsEffortReasoning ? 'effort' : supportsMaxTokensReasoning ? 'max_tokens' : undefined

      // Regenerate the response
      await streamAnswer({
        threadId: threadId as any,
        modelId: selectedModel,
        webSearch: false,
        reasoningEffort,
        reasoningType
      })
    } catch (error) {
      console.error("Failed to retry:", error)
      toast.error("Failed to retry message")
    } finally {
      setRetryingMessageId(null)
    }
  }

  // Branch: create a new thread with messages up to and including the user message
  const handleBranch = async (userMessageId: string, modelId?: string) => {
    if (!messages) return
    // Prevent duplicate branch operations on the same message
    if (branchingMessageId === userMessageId) return
    setBranchingMessageId(userMessageId)

    try {
      // Find the user message and all messages before it
      const messageIndex = messages.findIndex((m: any) => m._id === userMessageId)
      if (messageIndex === -1) return

      const messagesToCopy = messages.slice(0, messageIndex + 1)
      const userMessage = messagesToCopy[messageIndex]

      // Create a new thread
      const sessionId = localStorage.getItem('t3_session_id') || uuidv4()
      const newThreadId = await createThread({
        sessionId,
        modelId: modelId || localStorage.getItem('t3_selected_model') || 'google/gemini-2.0-flash-exp:free',
        title: userMessage.content.slice(0, 40)
      })

      // Copy all messages to the new thread
      for (const msg of messagesToCopy) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          await sendMessage({
            threadId: newThreadId,
            content: msg.content,
            role: msg.role,
            attachments: msg.attachments?.map((a: any) => ({
              storageId: a.storageId,
              type: a.type,
              name: a.name,
              size: a.size
            }))
          })
        }
      }

      // Generate new response in the branched thread
      const selectedModel = modelId || localStorage.getItem('t3_selected_model') || 'google/gemini-2.0-flash-exp:free'

      // Detect reasoning type based on model ID patterns (per OpenRouter docs)
      const modelLower = selectedModel.toLowerCase()
      const supportsEffortReasoning =
        modelLower.includes('/o1') ||
        modelLower.includes('/o3') ||
        modelLower.includes('/gpt-5') ||
        modelLower.includes('grok')

      const supportsMaxTokensReasoning =
        (modelLower.includes('gemini') && modelLower.includes('thinking')) ||
        modelLower.includes('claude-3.7') ||
        modelLower.includes('claude-sonnet-4') ||
        modelLower.includes('claude-4') ||
        (modelLower.includes('qwen') && modelLower.includes('thinking')) ||
        modelLower.includes('deepseek-r1')

      const savedReasoning = localStorage.getItem('t3_reasoning_effort')
      const reasoningEffort = (supportsEffortReasoning || supportsMaxTokensReasoning) && savedReasoning
        ? savedReasoning as 'low' | 'medium' | 'high'
        : undefined
      const reasoningType = supportsEffortReasoning ? 'effort' : supportsMaxTokensReasoning ? 'max_tokens' : undefined

      await streamAnswer({
        threadId: newThreadId,
        modelId: selectedModel,
        webSearch: false,
        reasoningEffort,
        reasoningType
      })

      // Navigate to the new thread
      navigate({ to: '/chat/$threadId', params: { threadId: newThreadId } })

      toast.success("Branched to new conversation")
    } catch (error) {
      console.error("Failed to branch:", error)
      toast.error("Failed to branch conversation")
    } finally {
      setBranchingMessageId(null)
    }
  }

  const isEmpty = messages !== undefined && messages.length === 0

  return (
    <div className="flex h-dvh min-h-screen overflow-hidden bg-background relative text-foreground max-w-full">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="flex-1 flex flex-col relative min-w-0 transition-all duration-300">
        <main className={cn(
          "flex-1 relative flex flex-col items-center p-2 md:p-4 z-0 overflow-x-hidden overflow-y-hidden transition-all duration-300",
          isEmpty ? "justify-center" : "justify-start"
        )}>
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center w-full h-full">
              <LandingHero onSelectPrompt={(text) => chatInputRef.current?.setContentAndSend(text)} />
            </div>
          ) : (
            <div className="max-w-5xl w-full flex-1 overflow-y-auto overflow-x-hidden pt-20 md:pt-20 pb-40 scrollbar-hide message-scroll-area">
              <TooltipProvider delayDuration={150}>
                {messages?.filter((msg: any) => !(msg.role === 'tool' && msg.name === 'search_web')).map((msg: any) => (
                <motion.div
                  key={msg._id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "mb-6 flex flex-col w-full group",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}
                  style={{ contain: 'layout style' }}
                >
                  <div className={cn("relative w-full flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
                    <AnimatePresence mode="wait">
                      {editingId === msg._id && msg.role === "user" ? (
                        <motion.div
                          key="edit-input"
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.2 }}
                          layout="position"
                          className="w-full flex justify-end"
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
                            "leading-relaxed transition-all break-words",
                            msg.role === "user"
                              ? "max-w-[95%] sm:max-w-[85%] bg-zinc-100 text-zinc-900 px-4 md:px-5 py-2.5 md:py-3 rounded-2xl shadow-sm text-center text-[15px] md:text-[15.5px]"
                              : "w-full max-w-none text-foreground/90 px-4 md:px-2 py-1"
                          )}
                        >
                          <div className="flex flex-col gap-1">
                            {/* Attachments Display */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-2">
                                {msg.attachments.map((att: any, i: number) => (
                                  <div key={i} className="rounded-lg overflow-hidden border border-black/10">
                                    {att.type.startsWith('image/') ? (
                                      <img src={att.url} alt="attachment" className="max-w-xs max-h-60 object-cover" />
                                    ) : (
                                      <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 bg-black/5 hover:bg-black/10 transition-colors">
                                        <div className="bg-white p-1 rounded">
                                          <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                        </div>
                                        <span className="text-sm font-medium underline">{att.name}</span>
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            
                            {msg.role === "assistant" ? (
                              <>
                                {/* Display reasoning tokens if present */}
                                {msg.reasoningContent && (
                                  <ReasoningBlock
                                    content={msg.reasoningContent}
                                    isStreaming={msg.status === "streaming"}
                                  />
                                )}

                                {msg.toolCalls && msg.toolCalls.length > 0 && (
                                  <div className="flex flex-col gap-2 mb-2">
                                    {msg.toolCalls.map((tc: any, i: number) => {
                                      if (tc.function.name === 'search_web') {
                                         const toolMsg = messages.find((m: any) => m.role === 'tool' && m.toolCallId === tc.id);
                                         return <SearchToolResult key={i} isLoading={!toolMsg} result={toolMsg?.content} />
                                      }
                                      return (
                                      <div key={i} className="text-xs bg-black/5 p-2 rounded border border-black/5 flex items-center gap-2 font-mono text-foreground/70">
                                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                                        Used tool: {tc.function.name}
                                      </div>
                                    )})}
                                  </div>
                                )}

                                  {msg.content && (
                                    <StreamingMessage 
                                      content={msg.content} 
                                      isStreaming={msg.status === "streaming"} 
                                    />
                                  )}

                                  {/* eBay Product Grid Demo Integration */}
                                  {msg.role === "assistant" && msg.content?.toLowerCase().includes("crocs") && (
                                    <ProductGrid onViewMore={handleOpenExpanded} />
                                  )}

                                  {msg.status === "streaming" && !msg.content.trim() && !msg.toolCalls && (
                                  <div className="flex items-center gap-2.5 text-foreground/60 py-2">
                                    <motion.div
                                      className="flex gap-1.5"
                                      initial={{ opacity: 0, scale: 0.8 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                                    >
                                      {[0, 1, 2].map((i) => (
                                        <motion.span
                                          key={i}
                                          className="w-2 h-2 bg-gradient-to-br from-t3-berry to-t3-berry-deep rounded-full shadow-sm"
                                          animate={{ 
                                            y: [0, -6, 0],
                                            scale: [1, 1.15, 1],
                                            opacity: [0.7, 1, 0.7]
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
                                    <span className="text-sm font-semibold tracking-tight">Thinking...</span>
                                  </div>
                                )}
                              </>
                            ) : msg.role === "tool" ? (
                              msg.name === 'search_web' ? null : (
                              <div className="text-xs bg-black/5 p-2 rounded border border-black/5 font-mono text-foreground/60 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                 Tool Output ({msg.name}): {msg.content}
                              </div>
                              )
                            ) : (
                              <>
                                <Markdown content={msg.content} />
                                {msg.status === 'aborted' && (
                                  <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/5 border border-red-500/10">
                                     <div className="w-1.5 h-1.5 rounded-full bg-red-500/50 animate-pulse" />
                                     <span className="text-[10px] font-medium text-red-500/70 uppercase tracking-wide">Generation Stopped</span>
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
                  <div className={cn(
                    "flex items-center gap-1 mt-1.5 transition-opacity",
                    isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    msg.role === "user" ? "mr-1" : "ml-1"
                  )}>
                    {msg.role === "user" ? (
                      <>
                        <MessageActionMenu
                          type="retry"
                          onAction={(modelId) => handleRetry(msg._id, modelId)}
                        >
                          <button className="p-1.5 rounded-md hover:bg-black/5 text-foreground/40 hover:text-foreground/70 transition-all flex items-center justify-center">
                            <RotateCcw size={15} />
                          </button>
                        </MessageActionMenu>
                        <MessageActionMenu
                          type="branch"
                          onAction={(modelId) => handleBranch(msg._id, modelId)}
                        >
                          <button className="p-1.5 rounded-md hover:bg-black/5 text-foreground/40 hover:text-foreground/70 transition-all flex items-center justify-center">
                            <GitBranch size={15} />
                          </button>
                        </MessageActionMenu>
                        <ActionButton
                          icon={<Edit3 size={15} />}
                          label="Edit"
                          onClick={() => { setEditingId(msg._id); setEditingContent(msg.content); }}
                        />
                        <ActionButton
                          icon={copiedId === msg._id ? <Check size={15} /> : <Copy size={15} />}
                          label="Copy"
                          onClick={() => handleCopy(msg._id, msg.content)}
                        />
                      </>
                    ) : msg.role === "assistant" ? (
                      <>
                        <ActionButton
                          icon={copiedId === msg._id ? <Check size={15} /> : <Copy size={15} />}
                          label="Copy"
                          onClick={() => handleCopy(msg._id, msg.content)}
                        />
                        <MessageActionMenu
                          type="branch"
                          onAction={(modelId) => {
                            // Find the previous user message to branch from
                            const msgIndex = messages?.findIndex((m: any) => m._id === msg._id) ?? -1
                            if (msgIndex > 0) {
                              for (let i = msgIndex - 1; i >= 0; i--) {
                                if (messages?.[i]?.role === 'user') {
                                  handleBranch(messages[i]._id, modelId)
                                  break
                                }
                              }
                            }
                          }}
                        >
                          <button className="p-1.5 rounded-md hover:bg-black/5 text-foreground/40 hover:text-foreground/70 transition-all flex items-center justify-center">
                            <GitBranch size={15} />
                          </button>
                        </MessageActionMenu>
                        <MessageActionMenu
                          type="retry"
                          onAction={(modelId) => {
                            // Find the previous user message to regenerate from
                            const msgIndex = messages?.findIndex((m: any) => m._id === msg._id) ?? -1
                            if (msgIndex > 0) {
                              // Find the most recent user message before this assistant message
                              for (let i = msgIndex - 1; i >= 0; i--) {
                                if (messages?.[i]?.role === 'user') {
                                  handleRetry(messages[i]._id, modelId)
                                  break
                                }
                              }
                            }
                          }}
                        >
                          <button className="p-1.5 rounded-md hover:bg-black/5 text-foreground/40 hover:text-foreground/70 transition-all flex items-center justify-center">
                            <RotateCcw size={15} />
                          </button>
                        </MessageActionMenu>
                        
                        <MessageMetadata
                          modelName={msg.modelId ? getModelDisplayName(msg.modelId) : 'AI'}
                          wordCount={msg.content?.trim().split(/\s+/).filter(Boolean).length ?? 0}
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
                <div className="flex items-center justify-center h-full opacity-20">
                  <MessageSquare className="animate-pulse" size={48} />
                </div>
              )}
              </TooltipProvider>
            </div>
          )}
        </main>

        {/* ChatInput - Moved outside of main to control Z-Index layering over portals */}
        {/* We hide the input when product selection is active to show the Floating Action Bar */}
        <div className={cn(
           "transition-all duration-300 ease-in-out",
           isExpandedOpen
             ? "fixed bottom-0 left-0 w-full z-[550] px-2 md:px-4 pb-1 md:pb-2 pt-0"
             : "absolute bottom-0 left-0 z-[50] w-full px-2 md:px-4 pb-1 md:pb-2 pt-0",
           (selectedProductIds.length > 0) ? "translate-y-24 opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
        )}>
          <ChatInput 
            existingThreadId={threadId} 
            ref={chatInputRef} 
            placeholder={isExpandedOpen ? "Ask a follow up" : "Type your message here..."}
          />
        </div>
      </div>

      {/* Floating Selection Bar for Expanded View */}
      <SelectionActionBar 
        selectedCount={selectedProductIds.length} 
        onClear={() => setSelectedProductIds([])}
      />

      {/* Product Details Drawer - renders based on productId search param */}
      <AnimatePresence>
        {productId && <ProductDrawer productId={productId} />}
      </AnimatePresence>

      {/* Expanded Product Picker View */}
      <AnimatePresence>
        {isExpandedOpen && (
          <ProductExpandedView 
            onClose={() => setIsExpandedOpen(false)}
            onProductClick={(id) => navigate({ to: ".", search: { productId: id } })}
            selectedIds={selectedProductIds}
            onToggleSelection={(id) => {
              setSelectedProductIds(prev => 
                prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
              )
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

const ActionButton = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick?: () => void }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button 
        onClick={onClick}
        className="p-1.5 rounded-md hover:bg-black/5 text-foreground/60 hover:text-foreground/80 transition-all flex items-center justify-center"
      >
        {icon}
      </button>
    </TooltipTrigger>
    <TooltipContent className="border-fuchsia-200/70 bg-[#FDF0FB] text-fuchsia-900 text-[11px] font-medium">
      {label}
    </TooltipContent>
  </Tooltip>
)
