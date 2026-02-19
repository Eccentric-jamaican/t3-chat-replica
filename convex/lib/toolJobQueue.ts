export const TOOL_JOB_NAMES = [
  "search_web",
  "search_products",
  "search_global",
] as const;

export type ToolJobName = (typeof TOOL_JOB_NAMES)[number];
export const TOOL_JOB_QOS_CLASSES = [
  "realtime",
  "interactive",
  "batch",
] as const;
export type ToolJobQosClass = (typeof TOOL_JOB_QOS_CLASSES)[number];
export type ToolJobQosCounts = Record<ToolJobQosClass, number>;
export const TOOL_JOB_QOS_BY_NAME: Record<ToolJobName, ToolJobQosClass> = {
  search_web: "realtime",
  search_products: "interactive",
  search_global: "batch",
};

export type ToolJobCounts = Record<ToolJobName, number>;

export function createToolJobCounts(initial = 0): ToolJobCounts {
  return {
    search_web: initial,
    search_products: initial,
    search_global: initial,
  };
}

export function createToolJobQosCounts(initial = 0): ToolJobQosCounts {
  return {
    realtime: initial,
    interactive: initial,
    batch: initial,
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

export function pickClaimableToolJob<
  TId,
  TCandidate extends ClaimCandidate<TId>,
>(
  candidates: Array<TCandidate>,
  runningByTool: ToolJobCounts,
  maxRunningByTool: ToolJobCounts,
  runningByQos: ToolJobQosCounts,
  maxRunningByQos: ToolJobQosCounts,
): TCandidate | null {
  for (const qosClass of TOOL_JOB_QOS_CLASSES) {
    if (runningByQos[qosClass] >= maxRunningByQos[qosClass]) {
      continue;
    }

    for (const candidate of candidates) {
      if (!isToolJobName(candidate.toolName)) {
        continue;
      }
      if (TOOL_JOB_QOS_BY_NAME[candidate.toolName] !== qosClass) {
        continue;
      }
      const running = runningByTool[candidate.toolName];
      const cap = maxRunningByTool[candidate.toolName];
      if (running < cap) {
        return candidate;
      }
    }
  }
  return null;
}
