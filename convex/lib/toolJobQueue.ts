export const TOOL_JOB_NAMES = [
  "search_web",
  "search_products",
  "search_global",
] as const;

export type ToolJobName = (typeof TOOL_JOB_NAMES)[number];

export type ToolJobCounts = Record<ToolJobName, number>;

export function createToolJobCounts(initial = 0): ToolJobCounts {
  return {
    search_web: initial,
    search_products: initial,
    search_global: initial,
  };
}

export function isToolJobName(value: string): value is ToolJobName {
  return (
    value === "search_web" ||
    value === "search_products" ||
    value === "search_global"
  );
}

type ClaimCandidate<TId> = {
  _id: TId;
  toolName: string;
};

export function pickClaimableToolJob<TId>(
  candidates: Array<ClaimCandidate<TId>>,
  runningByTool: ToolJobCounts,
  maxRunningByTool: ToolJobCounts,
) {
  for (const candidate of candidates) {
    if (!isToolJobName(candidate.toolName)) {
      continue;
    }
    const running = runningByTool[candidate.toolName];
    const cap = maxRunningByTool[candidate.toolName];
    if (running < cap) {
      return candidate;
    }
  }
  return null;
}
