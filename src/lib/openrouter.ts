export interface OpenRouterModel {
  id: string
  name: string
  description: string
  context_length: number
  pricing: {
    prompt: string
    completion: string
  }
}

export interface AppModel {
  id: string
  name: string
  provider: string
  description: string
  contextWindow: string
  contextLength?: number
  maxOutput: string
  pricing: {
    input: string
    output: string
  }
  isNew?: boolean
  hasVision?: boolean
  isFast?: boolean
  supportsTools?: boolean
  supportsImages?: boolean
  supportsPDF?: boolean
  // Reasoning support
  reasoningType?: 'effort' | 'max_tokens' | null  // null = no reasoning support
  isThinking?: boolean
}

export async function fetchOpenRouterModels(): Promise<AppModel[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models')
    const data = await response.json()
    
    // safe guard if API fails or shape changes
    if (!data?.data) return []

    return data.data.map((m: any) => {
      // Determine provider from ID prefix
      let provider = m.id.split('/')[0]
      if (provider === 'meta-llama') provider = 'meta'
      if (provider === 'x-ai') provider = 'xai'
      
      // Determine reasoning support based on model ID patterns (per OpenRouter docs)
      // effort-based: OpenAI o1/o3/gpt-5, Grok models
      // max_tokens-based: Gemini thinking, Anthropic Claude 3.7+/4+, Qwen thinking
      let reasoningType: 'effort' | 'max_tokens' | null = null
      
      const modelIdLower = m.id.toLowerCase()
      const supportsEffort = 
        modelIdLower.includes('/o1') || 
        modelIdLower.includes('/o3') || 
        modelIdLower.includes('/gpt-5') ||
        modelIdLower.includes('grok');
      
      const supportsMaxTokens = 
        (modelIdLower.includes('gemini') && modelIdLower.includes('thinking')) ||
        modelIdLower.includes('claude-3.7') ||
        modelIdLower.includes('claude-sonnet-4') ||
        modelIdLower.includes('claude-4') ||
        (modelIdLower.includes('qwen') && modelIdLower.includes('thinking')) ||
        modelIdLower.includes('deepseek-r1') ||
        modelIdLower.includes('kimi');
      
      if (supportsEffort) reasoningType = 'effort'
      else if (supportsMaxTokens) reasoningType = 'max_tokens'
      
      // Use architecture for vision (image input)
      const hasVision = m.architecture?.input_modalities?.includes('image') || m.id.includes('vision')
      
      // Use supported_parameters for tool calling when explicitly declared,
      // otherwise fall back to known model heuristics
      let supportsTools: boolean
      if (m.supported_parameters != null) {
        supportsTools = m.supported_parameters.includes('tools')
      } else {
        const descLower = m.description?.toLowerCase() ?? ''
        const knownToolModels =
          modelIdLower.includes('gpt-4') ||
          modelIdLower.includes('gpt-3.5') ||
          modelIdLower.includes('claude') ||
          modelIdLower.includes('gemini') ||
          modelIdLower.includes('llama-3') ||
          modelIdLower.includes('mistral') ||
          modelIdLower.includes('mixtral') ||
          modelIdLower.includes('command-r') ||
          modelIdLower.includes('deepseek') ||
          descLower.includes('function calling') ||
          descLower.includes('tool use')
        supportsTools = knownToolModels
      }
      
      // Image Generation (output)
      const supportsImages = m.architecture?.output_modalities?.includes('image') || m.id.includes('flux') || m.id.includes('dall-e') || m.id.includes('stable-diffusion') || m.id.includes('ideogram')

      const isFast = m.id.includes('flash') || m.id.includes('haiku') || m.id.includes('mini') || m.id.includes('turbo')

      // Format pricing
      const formatPrice = (p: string) => {
        const val = parseFloat(p) * 1000000
        return val === 0 ? "Free" : `$${val.toFixed(2)}`
      }

      // Format context window
      const formatContext = (ctx: number) => {
        if (ctx >= 1000000) return `${ctx / 1000000}M`
        if (ctx >= 1000) return `${Math.round(ctx / 1000)}K`
        return ctx.toString()
      }

      return {
        id: m.id,
        name: m.name,
        provider: provider,
        description: m.description || "No description available",
        contextWindow: formatContext(m.context_length),
        contextLength: m.context_length, // Store raw number for filtering
        maxOutput: formatContext(m.top_provider?.max_completion_tokens || 4096), // Fallback
        pricing: {
          input: formatPrice(m.pricing.prompt),
          output: formatPrice(m.pricing.completion)
        },
        reasoningType,
        hasVision,
        isFast,
        supportsTools,
        supportsImages,
        supportsPDF: true, // Generally true for modern LLMs
        isNew: false // Can't easily determine "new" without a date reference
      }
    })
  } catch (error) {
    console.error("Failed to fetch OpenRouter models", error)
    return []
  }
}
