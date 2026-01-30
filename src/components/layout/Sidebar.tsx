import { useState, useRef, useEffect, type MouseEvent } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  PanelLeft,
  Plus,
  Search,
  MessageSquare,
  Settings,
  LogIn,
  Pin,
  Trash2,
  Edit3,
  Share2,
  ExternalLink,
  Sparkles,
  Download,
  ChevronRight,
  X,
  Compass,
  Bookmark,
  Package,
  Ticket,
  ArrowUp,
  ChevronLeft,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { authClient } from "../../lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  useNavigate,
  useParams,
  Link,
  useLocation,
} from "@tanstack/react-router";
import { useIsMobile } from "../../hooks/useIsMobile";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

const getThreadUrl = (threadId: string) => {
  if (typeof window === "undefined") return `/chat/${threadId}`;
  return `${window.location.origin}/chat/${threadId}`;
};

const formatExportFilename = (title: string, ext: string) => {
  const base = title.trim() ? title.trim() : "untitled-chat";
  const cleaned = base
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .toLowerCase();
  return `${cleaned || "untitled-chat"}.${ext}`;
};

const formatMessageRole = (role: string) =>
  role.charAt(0).toUpperCase() + role.slice(1);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatAttachments = (attachments: any[] | undefined) => {
  if (!attachments || attachments.length === 0) return "";
  return attachments
    .map((att) => `${att.name} (${att.type}, ${Math.round(att.size / 1024)}kb)`)
    .join("\n");
};

const formatToolCalls = (toolCalls: any[] | undefined) => {
  if (!toolCalls || toolCalls.length === 0) return "";
  return toolCalls
    .map(
      (call) =>
        `${call.function?.name ?? "tool"}(${call.function?.arguments ?? ""})`,
    )
    .join("\n");
};

const CodeHeaderIcon = ({ type }: { type: "download" | "wrap" | "copy" }) => {
  if (type === "download") {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    );
  }

  if (type === "wrap") {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="3" y1="6" x2="17" y2="6" />
        <line x1="3" y1="12" x2="13" y2="12" />
        <line x1="3" y1="18" x2="9" y2="18" />
        <path d="M17 12a4 4 0 1 1 0 8" />
        <polyline points="15 16 17 20 19 16" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
};

const renderMarkdownToHtml = (markdown: string) => {
  const components: any = {
    pre: ({ children }: any) => <>{children}</>,
    code: ({ className, children, inline }: any) => {
      if (inline) {
        return <code className="inline-code">{children}</code>;
      }

      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "text";

      return (
        <div className="code-card">
          <div className="code-header">
            <span className="code-lang">{language}</span>
            <div className="code-actions">
              <span className="code-action" aria-hidden>
                <CodeHeaderIcon type="download" />
              </span>
              <span className="code-action" aria-hidden>
                <CodeHeaderIcon type="wrap" />
              </span>
              <span className="code-action" aria-hidden>
                <CodeHeaderIcon type="copy" />
              </span>
            </div>
          </div>
          <pre className="code-body">
            <code className={className}>{children}</code>
          </pre>
        </div>
      );
    },
  };

  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>,
  );
};

const normalizeTranscriptEntries = (messages: any[]) => {
  const entries: any[] = [];
  const assistantByToolCall = new Map<string, any>();

  messages.forEach((msg) => {
    if (msg.role === "tool") {
      const key = msg.toolCallId;
      const target = key ? assistantByToolCall.get(key) : null;
      if (target) {
        target.toolOutputs.push(msg);
        return;
      }

      entries.push({ ...msg, toolOutputs: [], isOrphanTool: true });
      return;
    }

    const entry = { ...msg, toolOutputs: [] as any[] };
    entries.push(entry);

    if (msg.toolCalls) {
      msg.toolCalls.forEach((call: any) => {
        if (call.id) assistantByToolCall.set(call.id, entry);
      });
    }
  });

  return entries;
};

const formatToolOutputsText = (toolOutputs: any[]) =>
  toolOutputs
    .map((tool) => {
      const label = tool.name ? `Tool output (${tool.name})` : "Tool output";
      return `${label}:\n${tool.content?.trim() || ""}`;
    })
    .join("\n\n");

const formatTranscriptText = (entries: any[]) =>
  entries
    .map((msg) => {
      const roleLabel =
        msg.role === "tool"
          ? `TOOL OUTPUT${msg.name ? ` (${msg.name})` : ""}`
          : (msg.role?.toUpperCase() ?? "MESSAGE");
      const content = msg.content?.trim() || "";
      const attachments = formatAttachments(msg.attachments);
      const toolCalls = formatToolCalls(msg.toolCalls);
      const sections = [content];

      if (msg.toolOutputs?.length) {
        sections.push(formatToolOutputsText(msg.toolOutputs));
      }

      if (attachments) {
        sections.push(`Attachments:\n${attachments}`);
      }

      if (toolCalls) {
        sections.push(`Tool calls:\n${toolCalls}`);
      }

      return `${roleLabel}\n${sections.join("\n\n")}`.trim();
    })
    .join("\n\n---\n\n");

const formatTranscriptMarkdown = (entries: any[]) =>
  entries
    .map((msg) => {
      const role =
        msg.role === "tool"
          ? `Tool Output${msg.name ? ` (${msg.name})` : ""}`
          : formatMessageRole(msg.role ?? "message");
      const content = msg.content?.trim() || "";
      const attachments = formatAttachments(msg.attachments);
      const toolCalls = formatToolCalls(msg.toolCalls);
      const sections = [] as string[];

      if (msg.role === "tool") {
        sections.push(`\`\`\`\n${content}\n\`\`\``);
      } else {
        sections.push(content || "_No content_");
      }

      if (msg.toolOutputs?.length) {
        const outputs = msg.toolOutputs
          .map((tool: any) => {
            const label = tool.name
              ? `Tool output (${tool.name})`
              : "Tool output";
            return `> ${label}\n>\n> \`\`\`\n> ${tool.content?.trim() || ""}\n> \`\`\``;
          })
          .join("\n\n");
        sections.push(outputs);
      }

      if (attachments) {
        sections.push(
          `**Attachments**\n\n${attachments
            .split("\n")
            .map((line) => `- ${line}`)
            .join("\n")}`,
        );
      }

      if (toolCalls) {
        sections.push(
          `**Tool calls**\n\n${toolCalls
            .split("\n")
            .map((line) => `- ${line}`)
            .join("\n")}`,
        );
      }

      return `### ${role}\n\n${sections.join("\n\n")}`;
    })
    .join("\n\n---\n\n");

const formatTranscriptHtml = (entries: any[]) =>
  entries
    .map((msg) => {
      const role =
        msg.role === "tool"
          ? `Tool Output${msg.name ? ` (${msg.name})` : ""}`
          : formatMessageRole(msg.role ?? "message");
      const attachments = formatAttachments(msg.attachments);
      const toolCalls = formatToolCalls(msg.toolCalls);
      const bodyHtml =
        msg.role === "tool"
          ? `<pre class="tool-output"><code>${escapeHtml(msg.content?.trim() || "")}</code></pre>`
          : renderMarkdownToHtml(msg.content?.trim() || "");

      const toolOutputsHtml = msg.toolOutputs?.length
        ? `<div class="tool-outputs">
          ${msg.toolOutputs
            .map((tool: any) => {
              const label = tool.name
                ? `Tool output (${tool.name})`
                : "Tool output";
              return `
              <div class="tool-output-inline">
                <div class="tool-output-label">${escapeHtml(label)}</div>
                <pre class="tool-output"><code>${escapeHtml(tool.content?.trim() || "")}</code></pre>
              </div>
            `;
            })
            .join("")}
        </div>`
        : "";

      const attachmentsHtml = attachments
        ? `<div class="meta"><div class="meta-title">Attachments</div><ul>${attachments
            .split("\n")
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}</ul></div>`
        : "";

      const toolCallsHtml = toolCalls
        ? `<div class="meta"><div class="meta-title">Tool calls</div><ul>${toolCalls
            .split("\n")
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}</ul></div>`
        : "";

      return `
      <section class="message">
        <h3>${escapeHtml(role)}</h3>
        <div class="message-body">${bodyHtml || "<p><em>No content</em></p>"}</div>
        ${toolOutputsHtml}
        ${attachmentsHtml}
        ${toolCallsHtml}
      </section>
    `;
    })
    .join("\n");

interface SidebarProps {
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}

export const Sidebar = ({ isOpen: externalOpen, onToggle }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { threadId: activeThreadId } = useParams({ strict: false }) as any;
  const isMobile = useIsMobile();
  const isNestedExplore =
    location.pathname.includes("/explore/category") ||
    location.pathname.includes("/explore/search");
  const [internalOpen, setInternalOpen] = useState(!isMobile); // Closed by default on mobile
  const hasSyncedMobileRef = useRef(false);

  const { data: authSession, isPending: isAuthPending } = authClient.useSession();
  const { isLoading: isConvexAuthLoading } = useConvexAuth();
  const currentUserId = authSession?.user?.id ?? null;

  // Track auth transitions to prevent showing stale data from previous user
  const prevUserIdRef = useRef<string | null>(undefined as any);
  const [isAuthTransitioning, setIsAuthTransitioning] = useState(false);

  useEffect(() => {
    // On first render, just record the initial state
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = currentUserId;
      return;
    }

    // If user ID changed (sign in/out), mark as transitioning
    if (prevUserIdRef.current !== currentUserId) {
      setIsAuthTransitioning(true);
      prevUserIdRef.current = currentUserId;
      // Clear transitioning state after a short delay to allow query to update
      const timeout = setTimeout(() => setIsAuthTransitioning(false), 100);
      return () => clearTimeout(timeout);
    }
  }, [currentUserId]);

  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = (open: boolean) => {
    if (onToggle) {
      onToggle(open);
    } else {
      setInternalOpen(open);
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = localStorage.getItem("t3_session_id");
    if (saved) return saved;
    const newId = uuidv4();
    localStorage.setItem("t3_session_id", newId);
    return newId;
  });

  useEffect(() => {
    if (hasSyncedMobileRef.current) return;
    setInternalOpen(!isMobile);
    hasSyncedMobileRef.current = true;
  }, [isMobile]);

  // Close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile && activeThreadId) {
      setIsOpen(false);
    }
  }, [activeThreadId, isMobile]);

  // Close on ESC key (mobile)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobile && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, isOpen]);

  // Skip query during auth state transitions to prevent showing wrong user's threads
  const shouldSkipQuery = isAuthPending || isConvexAuthLoading || isAuthTransitioning;
  const threads = useQuery(
    api.threads.list,
    shouldSkipQuery ? "skip" : { sessionId, search: searchQuery || undefined }
  );
  const togglePinned = useMutation(api.threads.togglePinned);
  const removeThread = useMutation(api.threads.remove);
  const renameThread = useMutation(api.threads.rename);

  const handleNewChat = async () => {
    // Navigate home to start a fresh chat
    navigate({ to: "/" });
    if (isMobile) setIsOpen(false);
  };

  const handleCloseSidebar = () => {
    if (isMobile) setIsOpen(false);
  };

  const handleRename = async (id: any) => {
    if (!editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await renameThread({ id, title: editingTitle.trim(), sessionId: sessionId || undefined });
    setEditingId(null);
  };

  const handleDeleteThread = async (id: any) => {
    if (activeThreadId === id) {
      await navigate({ to: "/" });
    }
    await removeThread({ id, sessionId: sessionId || undefined });
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <AnimatePresence>
        {isMobile && isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Toggle & Mini-Header (Fixed) */}
      <div
        className={cn(
          "fixed top-4 left-4 z-[110] flex items-center gap-1 transition-all duration-300",
          !isOpen &&
            "rounded-xl border border-black/5 bg-background/70 px-2 py-1.5 shadow-sm backdrop-blur-sm",
        )}
      >
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-lg p-1.5 text-foreground/60 transition-all hover:bg-black/5 focus:outline-none"
        >
          <PanelLeft size={18} />
        </button>
        {!isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-1"
          >
            {/* Back button for nested explore pages */}
            {isNestedExplore && isMobile && (
              <button
                onClick={() => window.history.back()}
                className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-black/10"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <span className="ml-1 hidden text-sm font-bold text-foreground/80 md:inline">
              Sendcat
            </span>
            {!isMobile && (
              <button className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-black/10">
                <Search size={18} />
              </button>
            )}
            <button
              className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-black/10"
              onClick={handleNewChat}
            >
              <Plus size={18} />
            </button>
          </motion.div>
        )}
      </div>

      {/* Main Sidebar - Fixed on mobile, relative on desktop */}
      <motion.aside
        initial={false}
        animate={{
          x: isOpen ? 0 : isMobile ? -240 : 0,
          width: isMobile ? 240 : isOpen ? 240 : 0,
          opacity: isOpen ? 1 : isMobile ? 1 : 0,
        }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={cn(
          "z-[100] h-full bg-background",
          isMobile ? "fixed top-0 left-0" : "relative",
        )}
      >
        <div className="border-border/40 sidebar-glass flex h-full w-[240px] flex-col border-r">
          {/* Mobile close button */}
          {isMobile && (
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 z-10 rounded-lg p-1.5 text-foreground/40 hover:bg-black/5"
            >
              <X size={18} />
            </button>
          )}
          <div className="mb-3 flex shrink-0 flex-col gap-1 px-3 pt-14">
            <div className="mb-1 px-3 py-1">
              <span className="text-sm font-bold tracking-tight text-foreground/90">
                Sendcat
              </span>
            </div>
            <button
              onClick={handleNewChat}
              className="mb-2 flex w-full items-center justify-between rounded-lg bg-primary px-4 py-2 text-[13.5px] font-bold text-white shadow-[0_2px_10px_rgba(162,59,103,0.3)] transition-opacity hover:opacity-95"
            >
              <span>New Chat</span>
              <Plus size={14} />
            </button>

            <div className="mb-2 flex flex-col gap-0.5">
              <Link
                to="/explore"
                onClick={handleCloseSidebar}
                activeProps={{ className: "active" }}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground [&.active]:bg-black/[0.05] [&.active]:text-foreground"
              >
                <Compass
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground group-[.active]:text-foreground"
                />
                <span>Explore</span>
              </Link>
              <button className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground">
                <Bookmark
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground"
                />
                <span>Saved items</span>
              </button>
              <Link
                to="/pre-alerts"
                onClick={handleCloseSidebar}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground [&.active]:bg-black/[0.05] [&.active]:text-foreground"
                activeProps={{ className: "active" }}
              >
                <Package
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground group-[.active]:text-foreground"
                />
                <span>Pre-alerts</span>
              </Link>
              <button className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground">
                <Ticket
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground"
                />
                <span>My coupons</span>
              </button>
            </div>
          </div>

          <div className="mb-2 shrink-0 px-3">
            <div className="group relative flex items-center rounded-lg bg-black/5 px-3 focus-within:ring-1 focus-within:ring-primary/20">
              <Search className="flex-shrink-0 text-foreground/30" size={14} />
              <input
                type="text"
                placeholder="Search your threads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border-none bg-transparent px-2 py-2 text-[13px] text-foreground placeholder-foreground/35 focus:ring-0 focus:outline-none"
              />
            </div>
          </div>

          <div className="scrollbar-hide sidebar-scroll-area flex-1 overflow-y-auto px-1">
            {threads && threads.some((t) => t.isPinned) && (
              <>
                <div className="px-3 py-3 text-[10px] font-bold tracking-[0.05em] text-foreground/40 uppercase opacity-80">
                  Pinned
                </div>
                {threads
                  .filter((t) => t.isPinned)
                  .map((thread) => (
                    <ThreadItem
                      key={thread._id}
                      thread={thread}
                      navigate={navigate}
                      activeThreadId={activeThreadId}
                      editingId={editingId}
                      setEditingId={setEditingId}
                      editingTitle={editingTitle}
                      setEditingTitle={setEditingTitle}
                      handleRename={handleRename}
                      togglePinned={togglePinned}
                      onDelete={handleDeleteThread}
                      sessionId={sessionId}
                    />
                  ))}
              </>
            )}

            <div className="px-3 py-3 text-[10px] font-bold tracking-[0.05em] text-foreground/40 uppercase opacity-80">
              Today
            </div>
            {threads === undefined ? (
              <div className="animate-pulse space-y-3 px-6 py-4">
                <div className="h-3 w-3/4 rounded bg-black/5" />
                <div className="h-3 w-1/2 rounded bg-black/5" />
              </div>
            ) : (
              threads
                .filter((t) => !t.isPinned)
                .map((thread) => (
                  <ThreadItem
                    key={thread._id}
                    thread={thread}
                    navigate={navigate}
                    activeThreadId={activeThreadId}
                    editingId={editingId}
                    setEditingId={setEditingId}
                    editingTitle={editingTitle}
                    setEditingTitle={setEditingTitle}
                    handleRename={handleRename}
                    togglePinned={togglePinned}
                    onDelete={handleDeleteThread}
                    sessionId={sessionId}
                  />
                ))
            )}
          </div>

          <div className="border-border/10 shrink-0 border-t p-3">
            {!authSession ? (
              <Link
                to="/sign-in"
                className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-[13.5px] font-bold text-foreground/60 transition-all hover:bg-black/5"
              >
                <LogIn size={16} className="opacity-70" />
                <span>Login</span>
              </Link>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-bold text-foreground/60 transition-all hover:bg-black/5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {authSession?.user?.image ? (
                        <img src={authSession.user.image} className="h-full w-full rounded-full border border-black/5 object-cover" />
                      ) : (
                        <UserIcon size={14} />
                      )}
                    </div>
                    <span className="flex-1 truncate text-left">{authSession?.user?.name}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-52" sideOffset={10}>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {authSession?.user?.image ? (
                        <img src={authSession.user.image} className="h-full w-full rounded-full border border-black/5 object-cover" />
                      ) : (
                        <UserIcon size={16} />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span className="truncate text-xs font-semibold">{authSession?.user?.name}</span>
                      <span className="truncate text-[10px] text-foreground/50">{authSession?.user?.email}</span>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                    <Settings size={15} />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      await authClient.signOut();
                      navigate({ to: "/sign-in" });
                    }}
                    className="text-red-500/90 focus:bg-red-50 focus:text-red-600"
                  >
                    <LogOut size={15} />
                    <span>Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Settings & Primary Actions (Fixed Top Right) */}
      <div className="fixed top-4 right-4 z-[100] flex items-center gap-1.5 rounded-xl border border-black/5 bg-background/70 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <button className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-black/10">
          <ArrowUp size={18} />
        </button>
        <Link
          to="/settings"
          className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-black/10 [&.active]:bg-primary/5 [&.active]:text-primary"
        >
          <Settings size={18} />
        </Link>
      </div>
    </>
  );
};

const ThreadItem = ({
  thread,
  navigate,
  activeThreadId,
  editingId,
  setEditingId,
  editingTitle,
  setEditingTitle,
  handleRename,
  togglePinned,
  onDelete,
  sessionId,
}: any) => {
  const isEditing = editingId === thread._id;
  const isActive = activeThreadId === thread._id;
  const [menuOpen, setMenuOpen] = useState(false);
  const contextOpenRef = useRef(false);
  const threadTitle = thread.title || "Untitled Chat";
  const threadUrl = getThreadUrl(thread._id);
  const threadMessages = useQuery(
    api.messages.list,
    menuOpen ? { threadId: thread._id, sessionId } : "skip",
  );
  const isExportReady = threadMessages !== undefined;

  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isEditing) {
      return;
    }
    contextOpenRef.current = true;
    setMenuOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !contextOpenRef.current) return;
    contextOpenRef.current = false;
    setMenuOpen(nextOpen);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(threadUrl);
  };

  const handleOpenNewTab = () => {
    window.open(threadUrl, "_blank", "noopener,noreferrer");
  };

  const handleExport = (format: "markdown" | "json" | "text" | "html") => {
    if (!threadMessages) return;
    const orderedMessages = [...threadMessages].sort(
      (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0),
    );
    const transcriptEntries = normalizeTranscriptEntries(orderedMessages);
    const exportedAt = new Date().toISOString();
    const base = {
      id: thread._id,
      title: threadTitle,
      url: threadUrl,
      exportedAt,
      messages: orderedMessages.map((msg) => ({
        id: msg._id,
        role: msg.role,
        content: msg.content,
        status: msg.status,
        name: msg.name,
        modelId: msg.modelId,
        toolCallId: msg.toolCallId,
        toolCalls: msg.toolCalls,
        attachments: msg.attachments,
        createdAt: msg._creationTime,
      })),
    };

    if (format === "json") {
      downloadTextFile(
        formatExportFilename(threadTitle, "json"),
        JSON.stringify(base, null, 2),
        "application/json",
      );
      return;
    }

    if (format === "html") {
      const transcript = formatTranscriptHtml(transcriptEntries);
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(threadTitle)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        font-family: "Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7eef6;
        color: #501854;
        margin: 0;
        padding: 32px;
      }
      .header {
        background: #ffffff;
        border: 1px solid rgba(80, 24, 84, 0.08);
        border-radius: 16px;
        padding: 20px 24px;
        box-shadow: 0 12px 28px rgba(80, 24, 84, 0.08);
        margin-bottom: 24px;
      }
      .header h1 {
        margin: 0 0 8px;
        font-size: 24px;
        letter-spacing: -0.02em;
      }
      .header a {
        color: #a23b67;
        text-decoration: none;
      }
      .meta-line {
        font-size: 12px;
        color: rgba(80, 24, 84, 0.6);
      }
      .message {
        background: #fff;
        border: 1px solid rgba(80, 24, 84, 0.08);
        border-radius: 16px;
        padding: 18px 22px;
        margin-bottom: 18px;
        box-shadow: 0 8px 18px rgba(80, 24, 84, 0.06);
      }
      .message h3 {
        margin: 0 0 10px;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(80, 24, 84, 0.55);
      }
      .message-body {
        font-size: 15px;
        line-height: 1.7;
      }
      .message-body pre,
      .tool-output,
      .code-body {
        background: #f7ecfb;
        border: 1px solid rgba(162, 59, 103, 0.15);
        border-radius: 12px;
        padding: 14px 16px;
        overflow-x: auto;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 13px;
      }
      .code-card {
        border: 1px solid rgba(162, 59, 103, 0.18);
        border-radius: 12px;
        overflow: hidden;
        background: #fbf5ff;
        margin: 10px 0;
      }
      .code-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #f3c9ed;
        border-bottom: 1px solid rgba(162, 59, 103, 0.2);
      }
      .code-lang {
        font-size: 12px;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: lowercase;
        letter-spacing: 0.04em;
        color: rgba(80, 24, 84, 0.8);
      }
      .code-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        color: rgba(80, 24, 84, 0.55);
      }
      .code-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
      }
      .code-body {
        margin: 0;
        border: none;
        border-radius: 0 0 12px 12px;
        background: #fbf5ff;
      }
      .code-body code {
        background: transparent;
        padding: 0;
        white-space: pre;
      }
      .inline-code {
        background: rgba(162, 59, 103, 0.08);
        border-radius: 6px;
        padding: 0.1em 0.35em;
      }
      .message-body pre code {
        background: transparent;
        padding: 0;
      }
      .meta {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid rgba(80, 24, 84, 0.08);
      }
      .tool-outputs {
        margin-top: 12px;
        display: grid;
        gap: 12px;
      }
      .tool-output-inline {
        background: rgba(247, 236, 251, 0.6);
        border: 1px dashed rgba(162, 59, 103, 0.18);
        border-radius: 12px;
        padding: 12px 14px;
      }
      .tool-output-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(80, 24, 84, 0.55);
        margin-bottom: 6px;
      }
      .meta-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(80, 24, 84, 0.5);
        margin-bottom: 6px;
      }
      .meta ul {
        margin: 0;
        padding-left: 18px;
      }
    </style>
  </head>
  <body>
    <section class="header">
      <h1>${escapeHtml(threadTitle)}</h1>
      <div><a href="${threadUrl}">${threadUrl}</a></div>
      <div class="meta-line">Exported: ${exportedAt}</div>
    </section>
    ${transcript}
  </body>
</html>`;
      downloadTextFile(
        formatExportFilename(threadTitle, "html"),
        html,
        "text/html",
      );
      return;
    }

    if (format === "markdown") {
      const transcript = formatTranscriptMarkdown(transcriptEntries);
      const content = `# ${threadTitle}\n\n${threadUrl}\n\nExported: ${exportedAt}\n\n---\n\n${transcript}`;
      downloadTextFile(
        formatExportFilename(threadTitle, "md"),
        content,
        "text/markdown",
      );
      return;
    }

    const transcript = formatTranscriptText(transcriptEntries);
    const content = `${threadTitle}\n${threadUrl}\nExported: ${exportedAt}\n\n${transcript}`;
    downloadTextFile(
      formatExportFilename(threadTitle, "txt"),
      content,
      "text/plain",
    );
  };

  return (
    <div className="group relative">
      <DropdownMenu
        open={menuOpen}
        onOpenChange={handleOpenChange}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            onClick={() =>
              navigate({
                to: "/chat/$threadId",
                params: { threadId: thread._id },
              })
            }
            onContextMenu={handleContextMenu}
            className={cn(
              "group my-0.5 flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 pr-[72px] text-left text-[13px] font-medium transition-all",
              isActive
                ? "bg-black/[0.04] text-foreground"
                : thread.isPinned
                  ? "text-primary/90 hover:bg-primary/5"
                  : "text-foreground/75 hover:bg-black/[0.03] hover:text-foreground",
            )}
          >
            <MessageSquare
              size={14}
              className={cn(
                "flex-shrink-0 transition-opacity",
                thread.isPinned || isActive
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-40",
              )}
            />
            {isEditing ? (
              <input
                autoFocus
                className="flex-1 border-none bg-transparent p-0 text-[13px] outline-none"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => handleRename(thread._id)}
                onKeyDown={(e) => e.key === "Enter" && handleRename(thread._id)}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{threadTitle}</span>
            )}
          </button>
        </DropdownMenuTrigger>
        {!isEditing && (
          <DropdownMenuContent side="right" align="start" sideOffset={10}>
            <DropdownMenuItem onSelect={() => togglePinned({ id: thread._id, sessionId: sessionId || undefined })}>
              <Pin size={15} />
              <span>{thread.isPinned ? "Unpin" : "Pin"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleShare}>
              <Share2 size={15} />
              <span>Share</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleOpenNewTab}>
              <ExternalLink size={15} />
              <span>Open in New Tab</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setEditingId(thread._id);
                setEditingTitle(threadTitle);
              }}
            >
              <Edit3 size={15} />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setEditingId(thread._id);
                setEditingTitle("");
              }}
            >
              <Sparkles size={15} />
              <span>Regenerate Title</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className="justify-between"
                disabled={!isExportReady}
              >
                <div className="flex items-center gap-2">
                  <Download size={15} />
                  <span>Export</span>
                </div>
                <ChevronRight
                  size={14}
                  className="ml-auto text-fuchsia-900/40"
                />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => handleExport("markdown")}
                  disabled={!isExportReady}
                >
                  <span>Markdown</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleExport("text")}
                  disabled={!isExportReady}
                >
                  <span>Plain text</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleExport("html")}
                  disabled={!isExportReady}
                >
                  <span>HTML (Rendered)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleExport("json")}
                  disabled={!isExportReady}
                >
                  <span>JSON</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDelete(thread._id)}
              className="text-red-500/90 focus:bg-red-50 focus:text-red-600"
            >
              <Trash2 size={15} />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {/* Actions */}
      {!isEditing && (
        <div className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 bg-transparent px-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePinned({ id: thread._id, sessionId: sessionId || undefined });
            }}
            className="rounded p-1 text-foreground/40 transition-colors hover:bg-black/5 hover:text-foreground"
          >
            <Pin size={12} className={thread.isPinned ? "fill-current" : ""} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingId(thread._id);
              setEditingTitle(thread.title || "");
            }}
            className="rounded p-1 text-foreground/40 transition-colors hover:bg-black/5 hover:text-foreground"
          >
            <Edit3 size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(thread._id);
            }}
            className="rounded p-1 text-foreground/40 transition-colors hover:bg-black/5 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
};
