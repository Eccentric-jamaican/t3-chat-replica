import { useState, useEffect } from 'react'
import { RotateCcw, GitBranch, Star, ChevronRight, ChevronDown } from 'lucide-react'
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

import { ProviderIcon, PROVIDER_CONFIG } from './ProviderIcons'
import { setSelectedModelId } from '../../lib/selectedModel'

interface MessageActionMenuProps {
  type: 'retry' | 'branch'
  onAction: (modelId?: string) => void
  children: React.ReactNode
}

export function MessageActionMenu({ type, onAction, children }: MessageActionMenuProps) {
  const isMobile = useIsMobile()
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [models, setModels] = useState<AppModel[]>([])
  const [favorites, setFavorites] = useState<string[]>([
    'google/gemini-2.0-flash-exp:free',
  ])

  useEffect(() => {
    const loadModels = async () => {
      const fetched = await fetchOpenRouterModels()
      if (fetched.length > 0) {
        setModels(fetched)
      }
    }
    loadModels()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('t3-model-favorites')
    if (saved) {
      setFavorites(JSON.parse(saved))
    }
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

  const runAction = (modelId?: string) => {
    if (modelId) setSelectedModelId(modelId)
    onAction(modelId)
  }

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
        <DropdownMenuItem onClick={() => runAction()} className="gap-2">
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
                      onClick={(e) => { e.stopPropagation(); runAction(model.id); }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-black/5 cursor-pointer text-[13px]"
                    >
                      <ProviderIcon provider={model.provider} className="w-4 h-4" />
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
                    <DropdownMenuItem key={model.id} onClick={() => runAction(model.id)} className="gap-2">
                    <ProviderIcon provider={model.provider} className="w-4 h-4" />
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
                <ProviderIcon provider={provider.id} className="w-4 h-4" />
                <span className="flex-1 font-medium">{provider.name}</span>
                <ChevronDown size={14} className={`opacity-50 transition-transform ${expandedGroup === provider.id ? 'rotate-180' : ''}`} />
              </div>
              {expandedGroup === provider.id && (
                <div className="pl-2 border-l-2 border-fuchsia-100 ml-3.5 my-1 space-y-0.5 animate-in slide-in-from-top-1 duration-200">
                  {modelsByProvider[provider.id].map(model => (
                    <div 
                      key={model.id} 
                      onClick={(e) => { e.stopPropagation(); runAction(model.id); }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-black/5 cursor-pointer text-[13px]"
                    >
                      <ProviderIcon provider={model.provider} className="w-4 h-4" />
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
                <ProviderIcon provider={provider.id} className="w-4 h-4" />
                <span className="flex-1">{provider.name}</span>
                <ChevronRight size={14} className="opacity-50" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto z-[250]">
                {modelsByProvider[provider.id].map(model => (
                  <DropdownMenuItem key={model.id} onClick={() => runAction(model.id)} className="gap-2">
                    <ProviderIcon provider={model.provider} className="w-4 h-4" />
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
