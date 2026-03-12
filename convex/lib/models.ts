export interface ModelCapability {
  id: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isThinking: boolean; // For DeepSeek R1, o1, etc.
  toolFallback?: "regex" | "none";
  promptStrategy?: "standard" | "reasoning" | "minimal"; // New strategy field
}

type OpenRouterModelCatalogEntry = {
  id: string;
  supportedParameters: ReadonlySet<string>;
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_MODEL_CATALOG_TTL_MS = 15 * 60 * 1000;
const OPENROUTER_MODEL_CATALOG_TIMEOUT_MS = 5_000;

let modelCatalogCache:
  | {
      expiresAt: number;
      entries: Map<string, OpenRouterModelCatalogEntry>;
    }
  | null = null;
let inflightModelCatalogPromise:
  | Promise<Map<string, OpenRouterModelCatalogEntry>>
  | null = null;

export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // === GOOGLE ===
  "google/gemini-2.0-flash-exp:free": {
    id: "google/gemini-2.0-flash-exp:free",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "google/gemini-3-flash-preview": {
    id: "google/gemini-3-flash-preview",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "google/gemini-flash-1.5": {
    id: "google/gemini-flash-1.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "google/gemini-pro-1.5": {
    id: "google/gemini-pro-1.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === ANTHROPIC ===
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "anthropic/claude-3-haiku": {
    id: "anthropic/claude-3-haiku",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "anthropic/claude-haiku-4.5": {
    id: "anthropic/claude-haiku-4.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === OPENAI ===
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/gpt-5-nano": {
    id: "openai/gpt-5-nano",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/gpt-5-nano:free": {
    id: "openai/gpt-5-nano:free",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/o1-mini": {
    id: "openai/o1-mini",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true,
    toolFallback: "regex",
    promptStrategy: "reasoning",
  },
  "openai/o1-preview": {
    id: "openai/o1-preview",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true,
    toolFallback: "regex",
    promptStrategy: "reasoning",
  },
  // [NEW] GPT-OSS-120B (Open-Weight Native Tool Support)
  "openai/gpt-oss-120b": {
    id: "openai/gpt-oss-120b",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false, // Standard MoE
    promptStrategy: "standard",
  },

  // === DEEPSEEK ===
  "deepseek/deepseek-chat": {
    id: "deepseek/deepseek-chat",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "deepseek/deepseek-r1": {
    id: "deepseek/deepseek-r1",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true,
    promptStrategy: "reasoning", // Needs <think> handling awareness
  },

  // === META ===
  "meta-llama/llama-3.3-70b-instruct": {
    id: "meta-llama/llama-3.3-70b-instruct",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === MOONSHOT (KIMI) ===
  "moonshotai/kimi-k2.5": {
    id: "moonshotai/kimi-k2.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "moonshotai/moonshot-v1-8k": {
    id: "moonshotai/moonshot-v1-8k",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === XAI (GROK) ===
  "x-ai/grok-2-vision-1212": {
    id: "x-ai/grok-2-vision-1212",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard", // Grok now supports native tools via OpenRouter
  },
  "x-ai/grok-4": {
    id: "x-ai/grok-4",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true, // Grok 4 has reasoning
    promptStrategy: "reasoning",
  },

  // === OPENAI GPT-5 ===
  "openai/gpt-5.1-chat": {
    id: "openai/gpt-5.1-chat",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
};

function inferIsThinking(modelId: string, supportedParameters?: ReadonlySet<string>) {
  const modelIdLower = modelId.toLowerCase();
  return (
    supportedParameters?.has("reasoning") === true ||
    modelIdLower.includes("r1") ||
    modelIdLower.includes("reasoning") ||
    modelIdLower.includes("thinking")
  );
}

function buildHeuristicModelCapability(
  modelId: string | undefined,
): ModelCapability {
  if (!modelId) {
    return MODEL_CAPABILITIES["moonshotai/kimi-k2.5"]; // Default
  }

  // Specific override for known capabilities if not found in map
  if (MODEL_CAPABILITIES[modelId]) {
    return MODEL_CAPABILITIES[modelId];
  }

  // [AGENTIC] Modern Default Strategy
  // Assume most new models on OpenRouter support tools unless known otherwise.
  // This replaces the old "safely fail to regex" strategy.

  const modelIdLower = modelId.toLowerCase();
  const isThinking = inferIsThinking(modelId);

  if (modelIdLower.includes("gpt-5")) {
    return {
      id: modelId,
      supportsTools: true,
      supportsStreaming: true,
      isThinking,
      promptStrategy: isThinking ? "reasoning" : "standard",
    };
  }

  return {
    id: modelId,
    supportsTools: false, // Default to false for tool safety
    supportsStreaming: true, // Most modern models support streaming
    isThinking,
    promptStrategy: isThinking ? "reasoning" : "standard",
    toolFallback: "regex", // Fallback to parsing text for tool blocks if they occur
  };
}

export function getModelCapabilities(
  modelId: string | undefined,
): ModelCapability {
  return buildHeuristicModelCapability(modelId);
}

function toCatalogEntry(record: unknown): OpenRouterModelCatalogEntry | null {
  if (!record || typeof record !== "object") return null;

  const maybeId =
    "id" in record && typeof record.id === "string" ? record.id : null;
  if (!maybeId) return null;

  const supportedParameters = new Set<string>();
  if ("supported_parameters" in record && Array.isArray(record.supported_parameters)) {
    for (const value of record.supported_parameters) {
      if (typeof value === "string" && value.trim()) {
        supportedParameters.add(value);
      }
    }
  }

  return {
    id: maybeId,
    supportedParameters,
  };
}

async function fetchOpenRouterModelCatalog() {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    OPENROUTER_MODEL_CATALOG_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `OpenRouter models API timed out after ${OPENROUTER_MODEL_CATALOG_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error(
      `OpenRouter models API returned ${response.status} ${response.statusText}`,
    );
  }

  const payload: unknown = await response.json();
  const rawEntries =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray(payload.data)
      ? payload.data
      : [];

  const entries = new Map<string, OpenRouterModelCatalogEntry>();
  for (const rawEntry of rawEntries) {
    const entry = toCatalogEntry(rawEntry);
    if (entry) {
      entries.set(entry.id, entry);
    }
  }

  return entries;
}

async function getOpenRouterModelCatalog() {
  if (modelCatalogCache && modelCatalogCache.expiresAt > Date.now()) {
    return modelCatalogCache.entries;
  }

  if (!inflightModelCatalogPromise) {
    inflightModelCatalogPromise = fetchOpenRouterModelCatalog()
      .then((entries) => {
        modelCatalogCache = {
          entries,
          expiresAt: Date.now() + OPENROUTER_MODEL_CATALOG_TTL_MS,
        };
        return entries;
      })
      .catch((error) => {
        console.warn("[models] Failed to refresh OpenRouter catalog", error);
        const fallback =
          modelCatalogCache?.entries ??
          new Map<string, OpenRouterModelCatalogEntry>();
        modelCatalogCache = {
          entries: fallback,
          expiresAt: Date.now() + OPENROUTER_MODEL_CATALOG_TTL_MS,
        };
        return fallback;
      })
      .finally(() => {
        inflightModelCatalogPromise = null;
      });
  }

  return inflightModelCatalogPromise;
}

export async function resolveModelCapabilities(
  modelId: string | undefined,
): Promise<ModelCapability> {
  const heuristic = buildHeuristicModelCapability(modelId);
  if (!modelId) return heuristic;

  const catalog = await getOpenRouterModelCatalog();
  const entry = catalog.get(modelId);
  if (!entry || entry.supportedParameters.size === 0) {
    return heuristic;
  }

  const supportsTools = entry.supportedParameters.has("tools");
  const isThinking = inferIsThinking(modelId, entry.supportedParameters);

  return {
    ...heuristic,
    id: modelId,
    supportsTools,
    isThinking,
    promptStrategy: isThinking ? "reasoning" : "standard",
    toolFallback: supportsTools ? "none" : "regex",
  };
}

export function resetModelCatalogCacheForTests() {
  modelCatalogCache = null;
  inflightModelCatalogPromise = null;
}
