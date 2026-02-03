import { EbayToolResult } from "./EbayToolResult";

interface ProductToolResultProps {
  isLoading: boolean;
  result?: unknown;
  args?: string;
}

export function ProductToolResult({
  isLoading,
  result,
  args,
}: ProductToolResultProps) {
  return (
    <EbayToolResult
      isLoading={isLoading}
      result={result}
      args={args}
      title="Searched products"
    />
  );
}
