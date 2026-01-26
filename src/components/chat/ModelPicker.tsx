import { useState, useEffect, useRef } from 'react'
import { fetchOpenRouterModels, type AppModel } from '../../lib/openrouter'
import { motion } from 'framer-motion'
import { ChevronDown, Search, Star, Sparkles, Brain, Eye, CircleCheck, Plus, FileText } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { useIsMobile } from '../../hooks/useIsMobile'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface Model extends AppModel {}

const FALLBACK_MODELS: Model[] = [
  // ===== GOOGLE =====
  { 
    id: "google/gemini-2.0-flash-exp:free", 
    name: "Gemini 2.0 Flash", 
    provider: "google", 
    description: "Lightning-fast with surprising capability", 
    hasVision: true, 
    isNew: true,
    isFast: true,
    supportsTools: true,
    contextWindow: "1M",
    maxOutput: "8,192",
    pricing: { input: "Free", output: "Free" }
  },
  { 
    id: "google/gemini-flash-1.5", 
    name: "Gemini 1.5 Flash", 
    provider: "google", 
    description: "Optimized for high-frequency, low-latency tasks", 
    hasVision: true, 
    isFast: true,
    supportsTools: true,
    contextWindow: "1M",
    maxOutput: "8,192",
    pricing: { input: "$0.075", output: "$0.30" }
  },
  { 
    id: "google/gemini-pro-1.5", 
    name: "Gemini 1.5 Pro", 
    provider: "google", 
    description: "Mid-size multimodal model for a wide range of tasks", 
    hasVision: true, 
    isThinking: true,
    supportsTools: true,
    contextWindow: "2M",
    maxOutput: "8,192",
    pricing: { input: "$1.25", output: "$3.75" }
  },

  // ===== ANTHROPIC =====
  { 
    id: "anthropic/claude-3-opus", 
    name: "Claude 3 Opus", 
    provider: "anthropic", 
    description: "Most capable model for complex tasks", 
    hasVision: true, 
    isThinking: true,
    supportsTools: true,
    supportsPDF: true,
    contextWindow: "200K",
    maxOutput: "4,096",
    pricing: { input: "$15.00", output: "$75.00" }
  },
  { 
    id: "anthropic/claude-3.5-sonnet", 
    name: "Claude 3.5 Sonnet", 
    provider: "anthropic", 
    description: "Balance of intelligence and speed", 
    hasVision: true,
    supportsTools: true,
    supportsPDF: true,
    contextWindow: "200K",
    maxOutput: "8,192",
    pricing: { input: "$3.00", output: "$15.00" }
  },
  { 
    id: "anthropic/claude-3-haiku", 
    name: "Claude 3 Haiku", 
    provider: "anthropic", 
    description: "Fastest and most compact model", 
    isFast: true,
    hasVision: true,
    supportsTools: true,
    supportsPDF: true,
    contextWindow: "200K",
    maxOutput: "4,096",
    pricing: { input: "$0.25", output: "$1.25" }
  },

  // ===== OPENAI =====
  { 
    id: "openai/gpt-4o", 
    name: "GPT-4o", 
    provider: "openai", 
    description: "OpenAI's high-intelligence flagship model", 
    hasVision: true, 
    supportsTools: true,
    contextWindow: "128K",
    maxOutput: "4,096",
    pricing: { input: "$2.50", output: "$10.00" }
  },
  { 
    id: "openai/gpt-4o-mini", 
    name: "GPT-4o Mini", 
    provider: "openai", 
    description: "Fast and affordable for everyday tasks", 
    hasVision: true,
    isFast: true,
    supportsTools: true,
    contextWindow: "128K",
    maxOutput: "16,384",
    pricing: { input: "$0.15", output: "$0.60" }
  },
  { 
    id: "openai/gpt-4-turbo", 
    name: "GPT-4 Turbo", 
    provider: "openai", 
    description: "Enhanced capabilities with updated knowledge", 
    hasVision: true,
    supportsTools: true,
    contextWindow: "128K",
    maxOutput: "4,096",
    pricing: { input: "$10.00", output: "$30.00" }
  },
  { 
    id: "openai/o1-mini", 
    name: "o1-mini", 
    provider: "openai", 
    description: "Reasoning model for complex challenges", 
    isThinking: true,
    contextWindow: "128K",
    maxOutput: "65,536",
    pricing: { input: "$1.10", output: "$4.40" }
  },
  {
      id: "openai/o1-preview",
      name: "o1-preview",
      provider: "openai",
      description: "Preview of the new reasoning model",
      isThinking: true,
      contextWindow: "128K",
      maxOutput: "32,768",
      pricing: { input: "$15.00", output: "$60.00" }
  },

  // ===== DEEPSEEK =====
  { 
    id: "deepseek/deepseek-chat", 
    name: "DeepSeek V3", 
    provider: "deepseek", 
    description: "High-performance open-weights model",
    isFast: true,
    supportsTools: true,
    contextWindow: "64K",
    maxOutput: "8,192",
    pricing: { input: "$0.14", output: "$0.28" }
  },
  { 
    id: "deepseek/deepseek-r1", 
    name: "DeepSeek R1", 
    provider: "deepseek", 
    description: "Reasoning model with transparent thinking",
    isNew: true,
    isThinking: true,
    supportsTools: true,
    contextWindow: "64K",
    maxOutput: "8,192",
    pricing: { input: "$0.55", output: "$2.19" }
  },

  // ===== META =====
  { 
    id: "meta-llama/llama-3.3-70b-instruct", 
    name: "Llama 3.3 70B", 
    provider: "meta", 
    description: "Meta's flagship open-weights model",
    supportsTools: true,
    contextWindow: "128K",
    maxOutput: "4,096",
    pricing: { input: "$0.40", output: "$0.40" }
  },
]


const ProviderIcon = ({ provider }: { provider: string }) => {
  switch (provider) {
    case 'favorites':
      return <Star size={18} className="fill-current" />
    case 'free':
      return <Sparkles size={18} />
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4043-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
        </svg>
      )
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">
          <path d="M17.304 3.541h-3.613l6.696 16.918h3.613l-6.696-16.918zm-10.608 0-6.696 16.918h3.714l1.412-3.693h6.942l1.412 3.693h3.714l-6.696-16.918h-3.802zm-.093 10.244 2.212-5.782 2.211 5.782h-4.423z" />
        </svg>
      )
    case 'google':
      return <Sparkles size={18} />
    case 'meta':
      return (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">
          <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a5.034 5.034 0 0 0 1.81 2.889c.893.725 2.093 1.042 3.469.622 1.156-.35 2.236-1.143 3.205-2.119.968-.975 1.868-2.161 2.674-3.414.806-1.254 1.512-2.582 2.098-3.837.586-1.255 1.052-2.435 1.38-3.4.325-.965.513-1.715.513-2.105 0-.39-.088-.693-.244-.893-.157-.2-.378-.297-.637-.297-.26 0-.556.098-.871.287-.316.188-.649.47-.983.835-.334.364-.668.81-.985 1.33a11.54 11.54 0 0 0-.869 1.74c-.257.643-.475 1.283-.656 1.877-.18.594-.321 1.118-.415 1.524-.2.858-.327 1.485-.374 1.862-.047.377-.022.555.063.555.085 0 .242-.178.455-.555.213-.377.498-.977.827-1.862.33-.885.716-1.985 1.131-3.151.415-1.165.86-2.396 1.305-3.471.166-.399.339-.77.518-1.094.18-.324.365-.6.556-.82.19-.22.382-.39.574-.505a.98.98 0 0 1 .555-.172c.298 0 .531.106.696.32.164.213.247.49.247.83 0 .34-.083.75-.247 1.217-.165.468-.4.985-.699 1.535-.3.55-.648 1.12-1.032 1.672-.384.553-.793 1.066-1.214 1.515-.42.448-.839.816-1.24 1.083-.4.268-.769.402-1.083.402-.314 0-.556-.134-.724-.402-.167-.267-.25-.613-.25-1.036 0-.423.083-.88.25-1.37.167-.492.4-.998.699-1.516.299-.518.648-.998 1.032-1.433.384-.435.793-.785 1.214-1.033.42-.247.839-.371 1.24-.371.4 0 .736.124 1.01.371.274.247.41.562.41.937 0 .374-.136.794-.41 1.252-.273.458-.65.931-1.13 1.395-.48.464-1.045.88-1.685 1.223-.64.344-1.356.516-2.132.516-.775 0-1.49-.172-2.13-.516-.64-.344-1.206-.759-1.686-1.223-.48-.464-.857-.937-1.13-1.395-.274-.458-.411-.878-.411-1.252 0-.374.137-.69.41-.937.274-.247.61-.37 1.011-.37.401 0 .82.123 1.24.37.42.248.83.598 1.214 1.033.384.435.733.915 1.032 1.433.299.518.532 1.024.699 1.516.167.49.25.947.25 1.37 0 .423-.083.77-.25 1.036-.167.267-.41.402-.724.402-.313 0-.682-.134-1.083-.402-.4-.267-.82-.635-1.24-1.083-.42-.449-.83-.962-1.214-1.515-.384-.553-.732-1.122-1.032-1.672-.3-.55-.534-1.067-.699-1.535-.165-.467-.247-.876-.247-1.217 0-.34.083-.617.247-.83.165-.214.398-.32.696-.32a.98.98 0 0 1 .555.172c.192.114.384.284.574.505.191.22.377.496.556.82.179.324.352.695.518 1.094.445 1.075.89 2.306 1.305 3.471.415 1.166.801 2.266 1.131 3.151.329.885.614 1.485.827 1.862.213.377.37.555.455.555.085 0 .11-.178.063-.555-.047-.377-.173-1.004-.374-1.862-.094-.406-.235-.93-.415-1.524-.18-.594-.399-1.234-.656-1.877a11.54 11.54 0 0 0-.869-1.74 9.282 9.282 0 0 0-.985-1.33c-.334-.364-.667-.646-.983-.835-.315-.188-.611-.287-.87-.287-.26 0-.48.098-.638.297-.156.2-.244.502-.244.893 0 .39.188 1.14.513 2.105.328.965.794 2.145 1.38 3.4.586 1.255 1.292 2.583 2.098 3.837.806 1.253 1.706 2.44 2.674 3.414.969.976 2.049 1.768 3.205 2.119 1.376.42 2.576.103 3.469-.622a5.034 5.034 0 0 0 1.81-2.889c.14-.604.21-1.267.21-1.973 0-2.566-.704-5.241-2.046-7.307-1.188-1.833-2.903-3.113-4.871-3.113H6.915z" />
        </svg>
      )
    case 'deepseek':
      return (
        <div className="w-[18px] h-[18px] flex items-center justify-center text-[11px] font-black">
          DS
        </div>
      )
    case 'xai':
      return (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">
          <path d="M.026 6.489h5.048L11.996 16l-3.467 5.511-8.503-15.022zM23.974 6.489h-5.048L5.015 24h5.047l13.912-17.511zM18.928 0h-5.048l-1.884 2.989 2.524 4.489L18.928 0zM5.072 0h5.049l8.903 14.133L16.5 18.622 5.072 0z" />
        </svg>
      )
    default:
      // Fallback to first letter for unknown providers
      return (
        <div className="w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold uppercase opacity-50">
          {provider.charAt(0)}
        </div>
      )
  }
}


interface ModelPickerProps {
  selectedModelId: string
  onSelect: (modelId: string) => void
}

export const ModelPicker = ({ selectedModelId, onSelect }: ModelPickerProps) => {
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeProvider, setActiveProvider] = useState('favorites')
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('t3-model-favorites')
      return saved ? JSON.parse(saved) : ["google/gemini-2.0-flash-exp:free"]
    }
    return ["google/gemini-2.0-flash-exp:free"]
  })

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
      localStorage.setItem('t3-model-favorites', JSON.stringify(next))
      return next
    })
  }

  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      // Try local cache first
      const cached = localStorage.getItem('t3-models-cache')
      const cacheTime = localStorage.getItem('t3-models-cache-time')
      // Cache valid for 24 hours
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 86400000) {
        setModels(JSON.parse(cached))
        return
      }

      const fetched = await fetchOpenRouterModels()
      if (mounted && fetched.length > 0) {
        setModels(fetched)
        localStorage.setItem('t3-models-cache', JSON.stringify(fetched))
        localStorage.setItem('t3-models-cache-time', Date.now().toString())
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const selectedModel = models.find(m => m.id === selectedModelId) || models[0] || FALLBACK_MODELS[0]

  // Compute dynamic providers with grouping
  const uniqueProviders = Array.from(new Set(models.map(m => m.provider))).sort()
  
  const PROVIDER_CONFIG: Record<string, { name: string, group: string, order: number }> = {
    'openai': { name: 'OpenAI', group: 'us-closed', order: 1 },
    'anthropic': { name: 'Anthropic', group: 'us-closed', order: 2 },
    'google': { name: 'Google', group: 'us-closed', order: 3 },
    'perplexity': { name: 'Perplexity', group: 'us-closed', order: 4 },
    'cohere': { name: 'Cohere', group: 'us-closed', order: 5 },
    'xai': { name: 'xAI', group: 'us-closed', order: 6 },
    'meta': { name: 'Meta', group: 'us-open', order: 1 },
    'deepseek': { name: 'DeepSeek', group: 'chinese', order: 1 },
    'qwen': { name: 'Qwen', group: 'chinese', order: 2 },
    'mistral': { name: 'Mistral', group: 'eu', order: 1 },
  }

  const getProviderInfo = (id: string) => {
    return PROVIDER_CONFIG[id] || { 
      name: id.charAt(0).toUpperCase() + id.slice(1), 
      group: 'other',
      order: 99
    }
  }

  const dynamicProviders = [
    { id: 'favorites', name: 'Favorites', group: 'special', order: 1 },
    { id: 'free', name: 'Free Models', group: 'special', order: 2 },
    ...uniqueProviders.map(p => {
      const info = getProviderInfo(p)
      return { id: p, ...info }
    }).sort((a, b) => {
      const groups = ['special', 'us-closed', 'us-open', 'chinese', 'eu', 'other']
      const gA = groups.indexOf(a.group)
      const gB = groups.indexOf(b.group)
      if (gA !== gB) return gA - gB
      return a.order - b.order
    })
  ]

  const [activeFilters, setActiveFilters] = useState<string[]>([])
  const [focusedIndex, setFocusedIndex] = useState(0)

  const filteredModels = models.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase()) || 
      m.provider.toLowerCase().includes(search.toLowerCase())
    
    // When searching, ignore the provider tab to allow global search
    let matchesProvider = true
    if (!search) {
      if (activeProvider === 'favorites') {
        matchesProvider = favorites.includes(m.id)
      } else if (activeProvider === 'free') {
        matchesProvider = m.pricing?.input === 'Free' || m.id.endsWith(':free')
      } else {
        matchesProvider = m.provider === activeProvider
      }
    }
    
    const matchesFilters = activeFilters.length === 0 || activeFilters.every(filter => {
      if (filter === 'fast') return m.isFast
      if (filter === 'vision') return m.hasVision
      if (filter === 'reasoning') return m.isThinking
      if (filter === 'tools') return m.supportsTools
      if (filter === 'images') return m.supportsImages
      if (filter === 'pdf') return m.supportsPDF
      if (filter === '128k') return (m.contextLength || 0) >= 128000
      return true
    })

    return matchesSearch && matchesProvider && matchesFilters
  })

  const toggleFilter = (filterId: string) => {
    setActiveFilters(prev => 
      prev.includes(filterId) ? prev.filter(f => f !== filterId) : [...prev, filterId]
    )
  }

  // Reset focus when list changes
  useEffect(() => {
    setFocusedIndex(0)
  }, [search, activeProvider, activeFilters])

  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const element = listRef.current?.children[focusedIndex] as HTMLElement
    if (element) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [focusedIndex, isOpen])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex(prev => (prev + 1) % filteredModels.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex(prev => (prev - 1 + filteredModels.length) % filteredModels.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredModels[focusedIndex]) {
        onSelect(filteredModels[focusedIndex].id)
        setIsOpen(false)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 outline-none",
            "bg-white/60 hover:bg-white/90 border border-t3-berry/10 text-t3-berry font-semibold text-[13px] shadow-sm",
            isOpen && "bg-white/90 shadow-md"
          )}
        >
          <span>{selectedModel.name}</span>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={14} className="opacity-50" />
          </motion.div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={isMobile ? "center" : "start"}
        side="top"
        sideOffset={isMobile ? 8 : 12}
        className={cn(
          "p-0 bg-transparent border-none shadow-none z-[250]",
          isMobile ? "w-[calc(100vw-16px)]" : "w-[480px]"
        )}
      >
        <div className="w-full bg-white/[0.98] backdrop-blur-2xl border border-black/[0.08] rounded-2xl shadow-2xl shadow-black/10 overflow-hidden">
          {/* Upgrade Banner */}
          <div className="px-4 py-3 bg-gradient-to-r from-[#fef0ed] to-white flex items-center justify-between border-b border-t3-berry/[0.06]">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-bold text-t3-berry">Unlock all models</span>
              <span className="text-[11px] text-t3-berry/50 font-medium">$8/month</span>
            </div>
            <button className="px-4 py-1.5 bg-[#a23b67] hover:bg-[#8e325a] text-white text-[11px] font-bold rounded-full transition-colors shadow-sm">
              Upgrade
            </button>
          </div>

          {/* Search Bar */}
          <div className="px-4 py-2.5 border-b border-black/[0.04] flex items-center gap-2.5" onKeyDown={handleKeyDown}>
            <Search size={15} className="text-t3-berry/30 shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-[13px] placeholder-t3-berry/30 text-t3-berry font-medium"
            />
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn(
                  "p-1.5 hover:bg-black/5 rounded-lg transition-colors relative",
                  activeFilters.length > 0 && "text-t3-berry bg-t3-berry/5"
                )}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                  </svg>
                  {activeFilters.length > 0 && (
                    <span className="absolute top-0 right-0 w-2 h-2 bg-t3-berry rounded-full border border-white" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" sideOffset={8} className="w-[200px] p-1.5 bg-white shadow-xl border border-black/[0.08] rounded-xl z-[250]">
                <div className="space-y-0.5">
                  {[
                    { id: 'fast', label: 'Fast', icon: <Sparkles size={14} /> },
                    { id: 'vision', label: 'Vision', icon: <Eye size={14} /> },
                    { id: 'reasoning', label: 'Reasoning', icon: <Brain size={14} /> },
                    { id: 'tools', label: 'Tool Calling', icon: <Search size={14} /> },
                    { id: '128k', label: '128k+ Context', icon: <FileText size={14} /> },
                    { id: 'images', label: 'Image Generation', icon: <Sparkles size={14} /> },
                    { id: 'pdf', label: 'PDF Comprehension', icon: <Search size={14} /> },
                  ].map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => toggleFilter(filter.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors",
                        activeFilters.includes(filter.id) ? "bg-t3-berry/5 text-t3-berry" : "hover:bg-black/5 text-t3-berry/60"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="opacity-70">{filter.icon}</span>
                        {filter.label}
                      </div>
                      {activeFilters.includes(filter.id) && <CircleCheck size={14} />}
                    </button>
                  ))}
                  <div className="h-px bg-black/[0.04] my-1" />
                  <button 
                    onClick={() => setActiveFilters([])}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-t3-berry/40 hover:text-t3-berry/60 transition-colors"
                  >
                    Clear all filters
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Content Area */}
          <div className="flex flex-row" style={{ height: isMobile ? '50vh' : '360px', maxHeight: isMobile ? '400px' : '360px' }}>
            {/* Provider Sidebar - Always vertical, narrower on mobile */}
            <div className={cn(
              "bg-black/[0.02] flex flex-col items-center gap-1 border-r border-black/[0.04] overflow-y-auto scrollbar-hide",
              isMobile ? "w-[44px] py-2" : "w-[52px] py-3"
            )}>
              {dynamicProviders.map((provider, index) => {
                const showDivider = index > 0 && provider.group !== dynamicProviders[index - 1].group
                return (
                  <div key={provider.id}>
                    {showDivider && <div className={cn("h-px bg-black/5 my-1 mx-auto", isMobile ? "w-4" : "w-5")} />}
                    <button
                      onClick={() => setActiveProvider(provider.id)}
                      title={provider.name}
                      className={cn(
                        "flex items-center justify-center rounded-xl transition-all duration-150 shrink-0",
                        isMobile ? "w-8 h-8" : "w-9 h-9",
                        activeProvider === provider.id
                          ? "bg-white shadow-sm text-t3-berry"
                          : "text-t3-berry/30 hover:text-t3-berry/60 hover:bg-black/[0.03]"
                      )}
                    >
                      <ProviderIcon provider={provider.id} />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Model List Area */}
            <div
              ref={listRef}
              className="flex-1 flex flex-col overflow-y-auto space-y-0.5 outline-none p-2"
              onKeyDown={handleKeyDown}
              tabIndex={0}
            >
              {filteredModels.map((model, index) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onSelect(model.id)
                    setIsOpen(false)
                  }}
                  className={cn(
                    "w-full text-left rounded-xl transition-all duration-100 group flex items-start px-3 py-2.5 gap-2.5",
                    selectedModelId === model.id || focusedIndex === index
                      ? "bg-t3-berry/[0.06]"
                      : "hover:bg-black/[0.03]"
                  )}
                >
                  {/* Plus/Check Icon */}
                  <div className="mt-0.5 shrink-0">
                    {selectedModelId === model.id ? (
                      <CircleCheck size={16} className="text-t3-berry fill-t3-berry/20" />
                    ) : (
                      <Plus size={16} className="text-t3-berry/30 group-hover:text-t3-berry/50" />
                    )}
                  </div>

                  {/* Model Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className={cn(
                        "font-semibold text-[13px]",
                        selectedModelId === model.id ? "text-t3-berry" : "text-t3-berry/80"
                      )}>
                        {model.name}
                      </span>
                      {model.isNew && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded-md uppercase shrink-0">
                          New
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      "text-[11px] text-t3-berry/40 font-medium leading-snug",
                      isMobile ? "line-clamp-2" : "truncate"
                    )}>
                      {model.description}
                    </p>
                  </div>

                  {/* Feature Icons & Star */}
                  <div className="flex items-center gap-1.5 mt-0.5 shrink-0">
                    {model.hasVision && (
                      <Eye size={13} className="text-t3-berry/25" />
                    )}
                    {model.isThinking && (
                      <Brain size={13} className="text-t3-berry/25" />
                    )}

                    {/* Info Icon & Popover - Hidden on mobile */}
                    {!isMobile && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 hover:bg-black/5 rounded-md transition-colors text-t3-berry/20 hover:text-t3-berry/40"
                          >
                            <svg className="w-[14px] h-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 16v-4" />
                              <path d="M12 8h.01" />
                            </svg>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="right"
                          align="center"
                          sideOffset={15}
                          className="w-[260px] p-4 bg-white shadow-2xl border border-black/[0.08] rounded-2xl z-[250]"
                        >
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-[12px] font-bold text-t3-berry mb-1">{model.name}</h4>
                              <p className="text-[11px] text-t3-berry/60 leading-relaxed font-medium">{model.description}</p>
                            </div>

                            <div className="space-y-2.5">
                              <div className="flex justify-between text-[11px]">
                                <span className="text-t3-berry/40 font-bold uppercase tracking-wider">Developer</span>
                                <span className="text-t3-berry font-bold capitalize">{model.provider}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span className="text-t3-berry/40 font-bold uppercase tracking-wider">Context Window</span>
                                <span className="text-t3-berry font-bold">{model.contextWindow} tokens</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span className="text-t3-berry/40 font-bold uppercase tracking-wider">Max Output</span>
                                <span className="text-t3-berry font-bold">{model.maxOutput} tokens</span>
                              </div>
                            </div>

                            <div className="pt-3 border-t border-black/[0.04] space-y-2.5">
                              <div className="text-[10px] text-t3-berry/40 font-bold uppercase tracking-wider">Pricing (per 1M tokens)</div>
                              <div className="flex justify-between text-[11px]">
                                <span className="text-t3-berry/60 font-medium">Input</span>
                                <span className="text-t3-berry font-bold">{model.pricing?.input}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span className="text-t3-berry/60 font-medium">Output</span>
                                <span className="text-t3-berry font-bold">{model.pricing?.output}</span>
                              </div>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}

                    {/* Favorite Star */}
                    <button
                      onClick={(e) => toggleFavorite(model.id, e)}
                      className={cn(
                        "p-1 ml-1 hover:bg-black/5 rounded-md transition-colors",
                        favorites.includes(model.id) ? "text-amber-400" : "text-t3-berry/20 hover:text-t3-berry/40"
                      )}
                    >
                      <Star size={14} className={cn(favorites.includes(model.id) && "fill-current")} />
                    </button>
                  </div>
                </button>
              ))}

              {filteredModels.length === 0 && (
                <div className="py-8 text-center text-t3-berry/40 text-[13px]">
                  No models found
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
