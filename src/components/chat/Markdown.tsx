import { Copy, Check, Download, AlignLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/tokyo-night-light.css";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface MarkdownProps {
  content: string;
  enableHighlight?: boolean;
}

const languageExtensions: Record<string, string> = {
  js: "js",
  javascript: "js",
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  html: "html",
  css: "css",
  md: "md",
  markdown: "md",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  python: "py",
  py: "py",
  go: "go",
  rust: "rs",
  rs: "rs",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  cs: "cs",
  yaml: "yml",
  yml: "yml",
  toml: "toml",
  sql: "sql",
  text: "txt",
  txt: "txt",
};

const downloadTextFile = (
  filename: string,
  contents: string,
  type = "text/plain",
) => {
  const blob = new Blob([contents], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const getNodeText = (node: any): string => {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (node.props?.children) return getNodeText(node.props.children);
  return "";
};

const getTableText = (table: HTMLTableElement | null) => {
  if (!table) return { tsv: "", csv: "" };

  const rows = Array.from(table.querySelectorAll("tr"));
  const cells = rows.map((row) =>
    Array.from(row.querySelectorAll("th, td")).map(
      (cell) => cell.textContent?.trim() ?? "",
    ),
  );
  const tsv = cells.map((row) => row.join("\t")).join("\n");
  const csv = cells
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  return { tsv, csv };
};

type TooltipIconButtonProps = {
  onClick?: () => void;
  label: string;
  isActive?: boolean;
  children: ReactNode;
  className?: string;
  ariaPressed?: boolean;
};

const TooltipIconButton = ({
  onClick,
  label,
  isActive,
  children,
  className,
  ariaPressed,
}: TooltipIconButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        onClick={onClick}
        className={`rounded-md p-1.5 transition-colors ${className ?? ""}`}
        aria-label={label}
        aria-pressed={ariaPressed}
        type="button"
      >
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent
      className={isActive ? "border-fuchsia-300/80 bg-[#F8E4F3]" : undefined}
    >
      {label}
    </TooltipContent>
  </Tooltip>
);

const MarkdownTable = ({ ...props }: any) => {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const { tsv } = getTableText(tableRef.current);
    if (!tsv) return;
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const { csv } = getTableText(tableRef.current);
    if (!csv) return;
    downloadTextFile("table.csv", csv, "text/csv");
  };

  return (
    <div className="my-4 flex max-w-full flex-col overflow-hidden rounded-lg border border-white/10">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-white/10 bg-white/5 px-3 py-2">
        <TooltipIconButton
          onClick={handleDownload}
          label="Download table"
          className="text-foreground/50 hover:text-foreground/80"
        >
          <Download size={14} />
        </TooltipIconButton>
        <TooltipIconButton
          onClick={handleCopy}
          label={copied ? "Copied" : "Copy table"}
          isActive={copied}
          className="text-foreground/50 hover:text-foreground/80"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </TooltipIconButton>
      </div>
      <div className="scrollbar-hide w-full overflow-x-auto">
        <table
          ref={tableRef}
          className="min-w-full divide-y divide-white/10"
          {...props}
        />
      </div>
    </div>
  );
};

export const Markdown = ({
  content,
  enableHighlight = true,
}: MarkdownProps) => {
  const [wrapEnabled, setWrapEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("markdown.codeWrap");
    if (stored !== null) {
      setWrapEnabled(stored === "true");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("markdown.codeWrap", String(wrapEnabled));
  }, [wrapEnabled]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="prose dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={
            enableHighlight
              ? [rehypeSanitize, rehypeHighlight]
              : [rehypeSanitize]
          }
          components={{
            pre: ({ children }) => <>{children}</>,
            table: MarkdownTable,
            thead: ({ node, ...props }) => (
              <thead className="bg-white/5" {...props} />
            ),
            th: ({ node, ...props }) => (
              <th
                className="px-4 py-2 text-left text-xs font-bold tracking-wider text-foreground/70 uppercase"
                {...props}
              />
            ),
            td: ({ node, ...props }) => (
              <td
                className="border-t border-white/5 px-4 py-2 text-sm"
                {...props}
              />
            ),
            code: ({ className, children, ...props }: any) => {
              const match = /language-(\w+)/.exec(className || "");
              const language = match ? match[1] : "";
              const isBlock = match;
              const [copied, setCopied] = useState(false);

              const codeText = getNodeText(children).replace(/\n$/, "");
              const extension = languageExtensions[language] ?? "txt";

              const handleCopy = async () => {
                await navigator.clipboard.writeText(codeText);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              };

              const handleDownload = () => {
                downloadTextFile(`code.${extension}`, codeText);
              };

              return isBlock ? (
                <div className="my-6 w-full overflow-hidden rounded-lg border border-fuchsia-100 bg-[#FBF5FF] shadow-[0_4px_18px_rgba(151,71,255,0.08)]">
                  <div className="flex items-center justify-between border-b border-fuchsia-200/60 bg-[#F3C9ED] px-4 py-2.5">
                    <span className="font-mono text-[13px] font-medium tracking-wide text-fuchsia-900 lowercase">
                      {language || "text"}
                    </span>
                    <div className="flex items-center gap-3">
                      <TooltipIconButton
                        onClick={handleDownload}
                        label="Download code"
                        className="text-fuchsia-900/50 hover:text-fuchsia-900/80"
                      >
                        <Download size={15} />
                      </TooltipIconButton>
                      <TooltipIconButton
                        onClick={() => setWrapEnabled((prev) => !prev)}
                        label={wrapEnabled ? "Disable wrap" : "Wrap code"}
                        isActive={wrapEnabled}
                        className={
                          wrapEnabled
                            ? "text-fuchsia-900/90"
                            : "text-fuchsia-900/50 hover:text-fuchsia-900/80"
                        }
                        ariaPressed={wrapEnabled}
                      >
                        <AlignLeft size={15} />
                      </TooltipIconButton>
                      <TooltipIconButton
                        onClick={handleCopy}
                        label={copied ? "Copied" : "Copy code"}
                        isActive={copied}
                        className="text-fuchsia-900/50 hover:text-fuchsia-900/80"
                      >
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                      </TooltipIconButton>
                    </div>
                  </div>
                  <div
                    className={`w-full p-4 break-normal ${wrapEnabled ? "overflow-x-hidden" : "overflow-x-auto"}`}
                  >
                    <code
                      className={`${className} block w-full bg-transparent text-[15px] leading-7 break-normal text-fuchsia-950 ${
                        wrapEnabled ? "!whitespace-pre-wrap" : "!whitespace-pre"
                      }`}
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      {...props}
                    >
                      {children}
                    </code>
                  </div>
                </div>
              ) : (
                <code
                  className="rounded-md border border-white/10 bg-white/10 px-1.5 py-0.5 text-[0.9em] font-medium"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            h1: ({ node, ...props }) => (
              <h1
                className="mt-6 mb-2 text-[28px] leading-[36px] font-bold"
                {...props}
              />
            ),
            h2: ({ node, ...props }) => (
              <h2
                className="mt-5 mb-2 text-[24px] leading-[32px] font-bold"
                {...props}
              />
            ),
            h3: ({ node, ...props }) => (
              <h3
                className="mt-4 mb-2 text-[20px] leading-[32px] font-semibold"
                {...props}
              />
            ),
            ul: ({ node, ...props }) => (
              <ul className="mb-4 list-inside list-disc space-y-2" {...props} />
            ),
            ol: ({ node, ...props }) => (
              <ol
                className="mb-4 list-inside list-decimal space-y-2"
                {...props}
              />
            ),
            p: ({ node, ...props }) => (
              <p className="mb-4 last:mb-0" {...props} />
            ),
            li: ({ node, ...props }) => <li className="" {...props} />,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </TooltipProvider>
  );
};
