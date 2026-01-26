import { useState, useEffect } from 'react'
import { RotateCcw, GitBranch, Star, Sparkles, ChevronRight, ChevronDown } from 'lucide-react'
import { fetchOpenRouterModels, type AppModel } from '../../lib/openrouter'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

// Provider icons (copied from ModelPicker for consistency)
const ProviderIcon = ({ provider }: { provider: string }) => {
  switch (provider) {
    case 'favorites':
      return <Star size={16} className="fill-current" />
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4043-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
        </svg>
      )
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M17.304 3.541h-3.613l6.696 16.918h3.613l-6.696-16.918zm-10.608 0-6.696 16.918h3.714l1.412-3.693h6.942l1.412 3.693h3.714l-6.696-16.918h-3.802zm-.093 10.244 2.212-5.782 2.211 5.782h-4.423z" />
        </svg>
      )
    case 'google':
      return <Sparkles size={16} />
    case 'meta':
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a5.034 5.034 0 0 0 1.81 2.889c.893.725 2.093 1.042 3.469.622 1.156-.35 2.236-1.143 3.205-2.119.968-.975 1.868-2.161 2.674-3.414.806-1.254 1.512-2.582 2.098-3.837.586-1.255 1.052-2.435 1.38-3.4.325-.965.513-1.715.513-2.105 0-.39-.088-.693-.244-.893-.157-.2-.378-.297-.637-.297-.26 0-.556.098-.871.287-.316.188-.649.47-.983.835-.334.364-.668.81-.985 1.33a11.54 11.54 0 0 0-.869 1.74c-.257.643-.475 1.283-.656 1.877-.18.594-.321 1.118-.415 1.524-.2.858-.327 1.485-.374 1.862-.047.377-.022.555.063.555.085 0 .242-.178.455-.555.213-.377.498-.977.827-1.862.33-.885.716-1.985 1.131-3.151.415-1.165.86-2.396 1.305-3.471.166-.399.339-.77.518-1.094.18-.324.365-.6.556-.82.19-.22.382-.39.574-.505a.98.98 0 0 1 .555-.172c.298 0 .531.106.696.32.164.213.247.49.247.83 0 .34-.083.75-.247 1.217-.165.468-.4.985-.699 1.535-.3.55-.648 1.12-1.032 1.672-.384.553-.793 1.066-1.214 1.515-.42.448-.839.816-1.24 1.083-.4.268-.769.402-1.083.402-.314 0-.556-.134-.724-.402-.167-.267-.25-.613-.25-1.036 0-.423.083-.88.25-1.37.167-.492.4-.998.699-1.516.299-.518.648-.998 1.032-1.433.384-.435.793-.785 1.214-1.033.42-.247.839-.371 1.24-.371.4 0 .736.124 1.01.371.274.247.41.562.41.937 0 .374-.136.794-.41 1.252-.273.458-.65.931-1.13 1.395-.48.464-1.045.88-1.685 1.223-.64.344-1.356.516-2.132.516-.775 0-1.49-.172-2.13-.516-.64-.344-1.206-.759-1.686-1.223-.48-.464-.857-.937-1.13-1.395-.274-.458-.411-.878-.411-1.252 0-.374.137-.69.41-.937.274-.247.61-.37 1.011-.37.401 0 .82.123 1.24.37.42.248.83.598 1.214 1.033.384.435.733.915 1.032 1.433.299.518.532 1.024.699 1.516.167.49.25.947.25 1.37 0 .423-.083.77-.25 1.036-.167.267-.41.402-.724.402-.313 0-.682-.134-1.083-.402-.4-.267-.82-.635-1.24-1.083-.42-.449-.83-.962-1.214-1.515-.384-.553-.732-1.122-1.032-1.672-.3-.55-.534-1.067-.699-1.535-.165-.467-.247-.876-.247-1.217 0-.34.083-.617.247-.83.165-.214.398-.32.696-.32a.98.98 0 0 1 .555.172c.192.114.384.284.574.505.191.22.377.496.556.82.179.324.352.695.518 1.094.445 1.075.89 2.306 1.305 3.471.415 1.166.801 2.266 1.131 3.151.329.885.614 1.485.827 1.862.213.377.37.555.455.555.085 0 .11-.178.063-.555-.047-.377-.173-1.004-.374-1.862-.094-.406-.235-.93-.415-1.524-.18-.594-.399-1.234-.656-1.877a11.54 11.54 0 0 0-.869-1.74 9.282 9.282 0 0 0-.985-1.33c-.334-.364-.667-.646-.983-.835-.315-.188-.611-.287-.87-.287-.26 0-.48.098-.638.297-.156.2-.244.502-.244.893 0 .39.188 1.14.513 2.105.328.965.794 2.145 1.38 3.4.586 1.255 1.292 2.583 2.098 3.837.806 1.253 1.706 2.44 2.674 3.414.969.976 2.049 1.768 3.205 2.119 1.376.42 2.576.103 3.469-.622a5.034 5.034 0 0 0 1.81-2.889c.14-.604.21-1.267.21-1.973 0-2.566-.704-5.241-2.046-7.307-1.188-1.833-2.903-3.113-4.871-3.113H6.915z" />
        </svg>
      )
    case 'deepseek':
      return (
        <div className="w-4 h-4 flex items-center justify-center text-[10px] font-black">
          DS
        </div>
      )
    case 'qwen':
      return (
        <div className="w-4 h-4 flex items-center justify-center text-[10px] font-black">
          QW
        </div>
      )
    case 'mistral':
      return (
        <div className="w-4 h-4 flex items-center justify-center text-[10px] font-black">
          MI
        </div>
      )
    case 'xai':
      return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M.026 6.489h5.048L11.996 16l-3.467 5.511-8.503-15.022zM23.974 6.489h-5.048L5.015 24h5.047l13.912-17.511zM18.928 0h-5.048l-1.884 2.989 2.524 4.489L18.928 0zM5.072 0h5.049l8.903 14.133L16.5 18.622 5.072 0z" />
        </svg>
      )
    case 'cohere':
      return (
        <div className="w-4 h-4 flex items-center justify-center text-[10px] font-black">
          CO
        </div>
      )
    case 'perplexity':
      return (
        <div className="w-4 h-4 flex items-center justify-center text-[10px] font-black">
          PX
        </div>
      )
    default:
      return (
        <div className="w-4 h-4 flex items-center justify-center text-[9px] font-bold uppercase opacity-60">
          {provider.charAt(0)}
        </div>
      )
  }
}

// Provider configuration for grouping
const PROVIDER_CONFIG: Record<string, { name: string; group: string; order: number }> = {
  'openai': { name: 'OpenAI', group: 'us-closed', order: 1 },
  'anthropic': { name: 'Claude', group: 'us-closed', order: 2 },
  'google': { name: 'Gemini', group: 'us-closed', order: 3 },
  'perplexity': { name: 'Perplexity', group: 'us-closed', order: 4 },
  'cohere': { name: 'Cohere', group: 'us-closed', order: 5 },
  'xai': { name: 'Grok', group: 'us-closed', order: 6 },
  'meta': { name: 'Llama', group: 'us-open', order: 1 },
  'deepseek': { name: 'DeepSeek', group: 'chinese', order: 1 },
  'qwen': { name: 'Qwen', group: 'chinese', order: 2 },
  'mistral': { name: 'Mistral', group: 'eu', order: 1 },
  'minimax': { name: 'MiniMax', group: 'chinese', order: 3 },
  'kimi': { name: 'Kimi', group: 'chinese', order: 4 },
  'glm': { name: 'GLM', group: 'chinese', order: 5 },
}

interface MessageActionMenuProps {
  type: 'retry' | 'branch'
  onAction: (modelId?: string) => void
  children: React.ReactNode
}

export function MessageActionMenu({ type, onAction, children }: MessageActionMenuProps) {
  const isMobile = useIsMobile()
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [models, setModels] = useState<AppModel[]>([])
  const [favorites] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('t3-model-favorites')
      return saved ? JSON.parse(saved) : ['google/gemini-2.0-flash-exp:free']
    }
    return ['google/gemini-2.0-flash-exp:free']
  })

  useEffect(() => {
    const loadModels = async () => {
      const cached = localStorage.getItem('t3-models-cache')
      const cacheTime = localStorage.getItem('t3-models-cache-time')
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 86400000) {
        setModels(JSON.parse(cached))
        return
      }
      const fetched = await fetchOpenRouterModels()
      if (fetched.length > 0) {
        setModels(fetched)
        localStorage.setItem('t3-models-cache', JSON.stringify(fetched))
        localStorage.setItem('t3-models-cache-time', Date.now().toString())
      }
    }
    loadModels()
  }, [])

  // Group models by provider
  const modelsByProvider = models.reduce((acc, model) => {
    const provider = model.provider
    if (!acc[provider]) acc[provider] = []
    acc[provider].push(model)
    return acc
  }, {} as Record<string, AppModel[]>)

  // Get sorted provider list
  const sortedProviders = Object.keys(modelsByProvider)
    .map(id => ({
      id,
      ...(PROVIDER_CONFIG[id] || { name: id.charAt(0).toUpperCase() + id.slice(1), group: 'other', order: 99 })
    }))
    .sort((a, b) => {
      const groups = ['us-closed', 'us-open', 'chinese', 'eu', 'other']
      const gA = groups.indexOf(a.group)
      const gB = groups.indexOf(b.group)
      if (gA !== gB) return gA - gB
      return a.order - b.order
    })

  const favoriteModels = models.filter(m => favorites.includes(m.id))

  const actionLabel = type === 'retry' ? 'Retry same' : 'Branch off'
  const Icon = type === 'retry' ? RotateCcw : GitBranch

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {children}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="border-fuchsia-200/70 bg-[#FDF0FB] text-fuchsia-900 text-[11px] font-medium">
          {type === 'retry' ? 'Retry' : 'Branch'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent 
        side={isMobile ? "bottom" : "right"}
        align={isMobile ? "end" : "start"} 
        sideOffset={12} 
        alignOffset={isMobile ? 0 : -4}
        collisionPadding={isMobile ? 10 : 40}
        className="min-w-[220px] max-h-[400px] overflow-y-auto scrollbar-hide z-[250]"
      >
        {/* Primary action */}
        <DropdownMenuItem onClick={() => onAction()} className="gap-2">
          <Icon size={14} />
          <span>{actionLabel}</span>
        </DropdownMenuItem>

        {/* Divider with label */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <div className="flex-1 h-px bg-fuchsia-100/80" />
          <span className="text-[11px] font-medium text-t3-berry">or switch model</span>
          <div className="flex-1 h-px bg-fuchsia-100/80" />
        </div>

        {/* Favorites submenu */}
        {favoriteModels.length > 0 && (
          isMobile ? (
            // Mobile: Accordion Style
            <>
              <div 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedGroup(expandedGroup === 'favorites' ? null : 'favorites'); }}
                className="flex items-center gap-2 px-2 py-2 rounded-sm hover:bg-black/5 cursor-pointer text-sm outline-none"
              >
                <Star size={14} className="fill-current text-t3-berry" />
                <span className="flex-1 font-medium">Favorites</span>
                <ChevronDown size={14} className={`opacity-50 transition-transform ${expandedGroup === 'favorites' ? 'rotate-180' : ''}`} />
              </div>
              {expandedGroup === 'favorites' && (
                <div className="pl-2 border-l-2 border-fuchsia-100 ml-3.5 my-1 space-y-0.5 animate-in slide-in-from-top-1 duration-200">
                  {favoriteModels.map(model => (
                    <div 
                      key={model.id} 
                      onClick={(e) => { e.stopPropagation(); onAction(model.id); }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-black/5 cursor-pointer text-[13px]"
                    >
                      <ProviderIcon provider={model.provider} />
                      <span className="truncate">{model.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            // Desktop: Submenu Style
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Star size={14} className="fill-current" />
                <span className="flex-1">Favorites</span>
                <ChevronRight size={14} className="opacity-50" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto z-[250]">
                {favoriteModels.map(model => (
                  <DropdownMenuItem key={model.id} onClick={() => onAction(model.id)} className="gap-2">
                    <ProviderIcon provider={model.provider} />
                    <span>{model.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        )}

        {/* Provider submenus */}
        {sortedProviders.map(provider => (
          isMobile ? (
             // Mobile: Accordion Style
             <div key={provider.id}>
              <div 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedGroup(expandedGroup === provider.id ? null : provider.id); }}
                className="flex items-center gap-2 px-2 py-2 rounded-sm hover:bg-black/5 cursor-pointer text-sm outline-none"
              >
                <ProviderIcon provider={provider.id} />
                <span className="flex-1 font-medium">{provider.name}</span>
                <ChevronDown size={14} className={`opacity-50 transition-transform ${expandedGroup === provider.id ? 'rotate-180' : ''}`} />
              </div>
              {expandedGroup === provider.id && (
                <div className="pl-2 border-l-2 border-fuchsia-100 ml-3.5 my-1 space-y-0.5 animate-in slide-in-from-top-1 duration-200">
                  {modelsByProvider[provider.id].map(model => (
                    <div 
                      key={model.id} 
                      onClick={(e) => { e.stopPropagation(); onAction(model.id); }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-black/5 cursor-pointer text-[13px]"
                    >
                      <span className="truncate">{model.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Desktop: Submenu Style
            <DropdownMenuSub key={provider.id}>
              <DropdownMenuSubTrigger className="gap-2">
                <ProviderIcon provider={provider.id} />
                <span className="flex-1">{provider.name}</span>
                <ChevronRight size={14} className="opacity-50" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto z-[250]">
                {modelsByProvider[provider.id].map(model => (
                  <DropdownMenuItem key={model.id} onClick={() => onAction(model.id)} className="gap-2">
                    <span>{model.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
