import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  type MouseEvent,
} from "react";
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
  Loader2,
  ChevronRight,
  X,
  Compass,
  Bookmark,
  Package,
  Heart,
  Upload,
  ChevronLeft,
  LogOut,
  User as UserIcon,
  GitBranch,
} from "lucide-react";
import { authClient } from "../../lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useQuery, useMutation, useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  useNavigate,
  useParams,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useIsMobile } from "../../hooks/useIsMobile";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { toast } from "sonner";
import { identifyUser, resetAnalytics, trackEvent } from "../../lib/analytics";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

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
interface SidebarProps {
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}

export const Sidebar = ({ isOpen: externalOpen, onToggle }: SidebarProps) => {
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const convex = useConvex();
  const { threadId: activeThreadId } = useParams({ strict: false }) as any;
  const isMobile = useIsMobile();
  const isNestedExplore =
    location.pathname.includes("/explore/category") ||
    location.pathname.includes("/explore/search");
  const [internalOpen, setInternalOpen] = useState(!isMobile); // Closed by default on mobile
  const hasSyncedMobileRef = useRef(false);

  const { data: authSession, isPending: isAuthPending } =
    authClient.useSession();
  const { isLoading: isConvexAuthLoading } = useConvexAuth();
  const currentUserId = authSession?.user?.id ?? null;
  const prevTrackedUserId = useRef<string | null>(null);

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

  useEffect(() => {
    if (currentUserId) {
      identifyUser(currentUserId, {
        email: authSession?.user?.email,
        name: authSession?.user?.name,
      });
      if (prevTrackedUserId.current !== currentUserId) {
        trackEvent("sign_in_completed", { user_id: currentUserId });
      }
      prevTrackedUserId.current = currentUserId;
      return;
    }

    if (prevTrackedUserId.current) {
      trackEvent("sign_out");
    }
    prevTrackedUserId.current = null;
    resetAnalytics();
  }, [authSession?.user?.email, authSession?.user?.name, currentUserId]);

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
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);
  const [sessionId, setSessionId] = useState("");

  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const unpinnedStartRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [unpinnedScrollTop, setUnpinnedScrollTop] = useState(0);
  const [unpinnedViewportHeight, setUnpinnedViewportHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("sendcat_session_id");
    if (saved) {
      setSessionId(saved);
      return;
    }
    const newId = uuidv4();
    localStorage.setItem("sendcat_session_id", newId);
    setSessionId(newId);
  }, []);

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
  const shouldSkipQuery =
    isAuthPending || isConvexAuthLoading || isAuthTransitioning;
  const shouldSkipThreadsQuery = shouldSkipQuery || !sessionId;
  const threads = useQuery(
    api.threads.list,
    shouldSkipThreadsQuery
      ? "skip"
      : {
          sessionId,
          search: debouncedSearchQuery || undefined,
        },
  );
  const togglePinned = useMutation(api.threads.togglePinned);
  const removeThread = useMutation(api.threads.remove);
  const renameThread = useMutation(api.threads.rename);
  const createShareToken = useMutation(api.threads.createShareToken);

  const threadList = useMemo(
    () => (Array.isArray(threads) ? threads : []),
    [threads],
  );
  const pinnedThreads = useMemo(
    () => threadList.filter((t: any) => t.isPinned),
    [threadList],
  );
  const unpinnedThreads = useMemo(
    () => threadList.filter((t: any) => !t.isPinned),
    [threadList],
  );

  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareRequestRef = useRef(false);
  const prefetchedThreadsRef = useRef(new Set<string>());
  const prefetchedThreadRoutesRef = useRef(new Set<string>());

  useEffect(() => {
    // Prefetch tracking is per-auth session. Clear on user change to avoid stale IDs suppressing future prefetches.
    prefetchedThreadsRef.current.clear();
    prefetchedThreadRoutesRef.current.clear();
  }, [currentUserId]);

  useLayoutEffect(() => {
    const el = sidebarScrollRef.current;
    if (!el) return;

    const update = () => setUnpinnedViewportHeight(el.clientHeight);
    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const handleSidebarScroll = () => {
    const el = sidebarScrollRef.current;
    if (!el) return;

    const offsetTop = unpinnedStartRef.current?.offsetTop ?? 0;

    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      setUnpinnedScrollTop(Math.max(0, el.scrollTop - offsetTop));
    });
  };

  useEffect(() => {
    setShareToken(null);
    setShareError(null);
    setShareLoading(false);
  }, [activeThreadId]);

  useEffect(() => {
    if (!isShareOpen || !activeThreadId || shareToken) return;
    if (shareRequestRef.current) return;
    let cancelled = false;
    const loadShareToken = async () => {
      try {
        shareRequestRef.current = true;
        setShareLoading(true);
        setShareError(null);
        const result = await createShareToken({
          threadId: activeThreadId,
          sessionId,
        });
        if (cancelled) return;
        setShareToken(result.shareToken);
      } catch (err: any) {
        if (cancelled) return;
        setShareError(err?.message || "Unable to create share link.");
      } finally {
        shareRequestRef.current = false;
        if (!cancelled) {
          setShareLoading(false);
        }
      }
    };
    loadShareToken();
    return () => {
      cancelled = true;
      shareRequestRef.current = false;
    };
  }, [
    activeThreadId,
    createShareToken,
    isShareOpen,
    sessionId,
    shareToken,
  ]);

  const handleNewChat = async () => {
    // Navigate home to start a fresh chat
    navigate({ to: "/" });
    if (isMobile) setIsOpen(false);
  };

  const getShareUrl = () => {
    if (!shareToken) return "";
    const shareSlug = shareToken.replace(/^share_/, "");
    if (typeof window === "undefined") return `/share/${shareSlug}`;
    return `${window.location.origin}/share/${shareSlug}`;
  };

  const handleOpenShare = () => {
    if (!activeThreadId) {
      toast.error("Open a chat to share.");
      return;
    }
    trackEvent("share_dialog_open", { thread_id: activeThreadId });
    setIsShareOpen(true);
  };

  const handleCopyShare = async () => {
    const url = getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied");
      trackEvent("share_thread_copy", { thread_id: activeThreadId, url });
    } catch (err) {
      toast.error("Failed to copy link");
    }
  };

  const handleShareTo = (target: "x" | "whatsapp" | "instagram") => {
    const url = getShareUrl();
    if (!url) return;
    trackEvent("share_thread_share", { thread_id: activeThreadId, target });
    const shareText = "Check out this chat";
    const encodedUrl = encodeURIComponent(url);
    const encodedText = encodeURIComponent(shareText);

    if (target === "x") {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }

    if (target === "whatsapp") {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }

    handleCopyShare();
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  };

  const shareUrl = getShareUrl();

  const handleCloseSidebar = () => {
    if (isMobile) setIsOpen(false);
  };

  const prefetchThread = (threadId: string, opts?: { preloadRoute?: boolean }) => {
    if (!threadId) return;

    // Route chunk preload does not depend on sessionId, so do it even before
    // Convex auth/session plumbing is ready.
    if ((opts?.preloadRoute ?? true) && !prefetchedThreadRoutesRef.current.has(threadId)) {
      prefetchedThreadRoutesRef.current.add(threadId);
      void router
        .preloadRoute({ to: "/chat/$threadId", params: { threadId } as any })
        .catch(() => {});
    }

    if (!sessionId) return;
    if (shouldSkipQuery) return;
    if (prefetchedThreadsRef.current.has(threadId)) return;
    prefetchedThreadsRef.current.add(threadId);

    const convexThreadId = threadId as Id<"threads">;

    // Prime the Convex query caches for quick navigation. Failures should be silent.
    void convex.query(api.threads.get, { id: convexThreadId, sessionId }).catch(() => {});
    void convex.query(api.messages.list, { threadId: convexThreadId, sessionId }).catch(() => {});
  };

  // Idle prefetch: warm the most likely next click (first visible thread).
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    if (!sessionId || shouldSkipQuery) return;

    const target =
      (unpinnedThreads.find((t: any) => t?._id && t._id !== activeThreadId)
        ?._id as string | undefined) ??
      (threads.find((t: any) => t?._id && t._id !== activeThreadId)?._id as
        | string
        | undefined);
    if (!target) return;

    const schedule = (cb: () => void) => {
      const w = window as any;
      if (typeof w.requestIdleCallback === "function") {
        return w.requestIdleCallback(cb, { timeout: 800 });
      }
      return window.setTimeout(cb, 250);
    };

    const cancel = (id: any) => {
      const w = window as any;
      if (typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(id);
        return;
      }
      clearTimeout(id);
    };

    const id = schedule(() => prefetchThread(target, { preloadRoute: false }));
    return () => cancel(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, threads, sessionId, shouldSkipQuery]);

  const handleRename = async (id: any) => {
    if (!editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await renameThread({
      id,
      title: editingTitle.trim(),
      sessionId: sessionId || undefined,
    });
    setEditingId(null);
  };

  const handleDeleteThread = async (id: any) => {
    if (activeThreadId === id) {
      await navigate({ to: "/" });
    }
    await removeThread({ id, sessionId: sessionId || undefined });
  };

  useEffect(() => {
    // Keep virtualization math in sync when pinned sections appear/disappear.
    handleSidebarScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedThreads.length, unpinnedThreads.length, isOpen]);

  // Keep this in sync with the rendered ThreadItem height. If the CSS changes and the row height changes,
  // the manual windowing math will need to be updated (otherwise you may see gaps/overlap).
  const THREAD_ROW_HEIGHT = 44;
  const THREAD_OVERSCAN = 8;
  const shouldVirtualizeUnpinned = unpinnedThreads.length > 80;

  const safeViewportHeight = unpinnedViewportHeight || 480;
  const startIndex = shouldVirtualizeUnpinned
    ? Math.max(
        0,
        Math.floor(unpinnedScrollTop / THREAD_ROW_HEIGHT) - THREAD_OVERSCAN,
      )
    : 0;
  const endIndex = shouldVirtualizeUnpinned
    ? Math.min(
        unpinnedThreads.length,
        Math.ceil(
          (unpinnedScrollTop + safeViewportHeight) / THREAD_ROW_HEIGHT,
        ) + THREAD_OVERSCAN,
      )
    : unpinnedThreads.length;
  const visibleUnpinned = shouldVirtualizeUnpinned
    ? unpinnedThreads.slice(startIndex, endIndex)
    : unpinnedThreads;
  const unpinnedTotalHeight = shouldVirtualizeUnpinned
    ? unpinnedThreads.length * THREAD_ROW_HEIGHT
    : undefined;

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
          "fixed z-[110] flex items-center gap-1 transition-all duration-300",
          "top-[calc(1rem+env(safe-area-inset-top,0px))] left-4",
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
              <Link
                to="/packages"
                onClick={handleCloseSidebar}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground [&.active]:bg-black/[0.05] [&.active]:text-foreground"
                activeProps={{ className: "active" }}
              >
                <Package
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground group-[.active]:text-foreground"
                />
                <span>Packages</span>
              </Link>
              <Link
                to="/pre-alerts"
                onClick={handleCloseSidebar}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground [&.active]:bg-black/[0.05] [&.active]:text-foreground"
                activeProps={{ className: "active" }}
              >
                <Bookmark
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground group-[.active]:text-foreground"
                />
                <span>Pre-alerts</span>
              </Link>
              <Link
                to="/favorites"
                onClick={handleCloseSidebar}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-all hover:bg-black/[0.03] hover:text-foreground [&.active]:bg-black/[0.05] [&.active]:text-foreground"
                activeProps={{ className: "active" }}
              >
                <Heart
                  size={16}
                  className="text-foreground/40 transition-colors group-hover:text-foreground group-[.active]:text-foreground"
                />
                <span>Favorites</span>
              </Link>
            </div>
          </div>

          <div className="mb-2 shrink-0 px-3">
            <div className="group relative flex items-center rounded-lg bg-black/5 px-3 focus-within:ring-1 focus-within:ring-primary/20">
              <Search className="flex-shrink-0 text-foreground/30" size={14} />
              <input
                id="thread-search"
                name="thread_search"
                type="text"
                placeholder="Search your threads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border-none bg-transparent px-2 py-2 text-[13px] text-foreground placeholder-foreground/35 focus:ring-0 focus:outline-none"
              />
            </div>
          </div>

          <div
            ref={sidebarScrollRef}
            onScroll={handleSidebarScroll}
            className="scrollbar-hide sidebar-scroll-area relative flex-1 overflow-y-auto px-1"
          >
            {pinnedThreads.length > 0 && (
              <>
                <div className="px-3 py-3 text-[10px] font-bold tracking-[0.05em] text-foreground/40 uppercase opacity-80">
                  Pinned
                </div>
                {pinnedThreads.map((thread: any) => (
                    <ThreadItem
                      key={thread._id}
                      thread={thread}
                      onPrefetch={prefetchThread}
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
            <div ref={unpinnedStartRef} />
            {threads === undefined ? (
              <div className="animate-pulse space-y-3 px-6 py-4">
                <div className="h-3 w-3/4 rounded bg-black/5" />
                <div className="h-3 w-1/2 rounded bg-black/5" />
                <div className="h-3 w-2/3 rounded bg-black/5" />
                <div className="h-3 w-1/3 rounded bg-black/5" />
              </div>
            ) : shouldVirtualizeUnpinned ? (
              <div style={{ height: unpinnedTotalHeight, position: "relative" }}>
                {visibleUnpinned.map((thread: any, idx: number) => {
                  const absoluteIndex = startIndex + idx;
                  return (
                    <div
                      key={thread._id}
                      style={{
                        position: "absolute",
                        top: absoluteIndex * THREAD_ROW_HEIGHT,
                        left: 0,
                        right: 0,
                      }}
                    >
                      <ThreadItem
                        thread={thread}
                        onPrefetch={prefetchThread}
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
                    </div>
                  );
                })}
              </div>
            ) : (
              unpinnedThreads.map((thread: any) => (
                  <ThreadItem
                    key={thread._id}
                    thread={thread}
                    onPrefetch={prefetchThread}
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
                        <img
                          src={authSession.user.image}
                          className="h-full w-full rounded-full border border-black/5 object-cover"
                        />
                      ) : (
                        <UserIcon size={14} />
                      )}
                    </div>
                    <span className="flex-1 truncate text-left">
                      {authSession?.user?.name}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="w-52"
                  sideOffset={10}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {authSession?.user?.image ? (
                        <img
                          src={authSession.user.image}
                          className="h-full w-full rounded-full border border-black/5 object-cover"
                        />
                      ) : (
                        <UserIcon size={16} />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span className="truncate text-xs font-semibold">
                        {authSession?.user?.name}
                      </span>
                      <span className="truncate text-[10px] text-foreground/50">
                        {authSession?.user?.email}
                      </span>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => navigate({ to: "/settings" })}
                  >
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
        <button
          onClick={handleOpenShare}
          className={cn(
            "rounded-lg p-1.5 transition-colors",
            activeThreadId
              ? "text-foreground/50 hover:bg-black/10"
              : "text-foreground/20 cursor-not-allowed",
          )}
          aria-disabled={!activeThreadId}
        >
          <Upload size={18} />
        </button>
        <Link
          to="/settings"
          className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-black/10 [&.active]:bg-primary/5 [&.active]:text-primary"
        >
          <Settings size={18} />
        </Link>
      </div>

      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent
          overlayProps={{ onPointerDown: () => setIsShareOpen(false) }}
          onPointerDownOutside={() => setIsShareOpen(false)}
          onInteractOutside={() => setIsShareOpen(false)}
          onEscapeKeyDown={() => setIsShareOpen(false)}
        >
          <DialogClose asChild>
            <button
              type="button"
              className="absolute right-4 top-4 rounded-full p-1 text-foreground/40 transition-colors hover:bg-black/10 hover:text-foreground/70"
              aria-label="Close share dialog"
            >
              <X size={14} />
            </button>
          </DialogClose>
          <DialogTitle>Share this chat</DialogTitle>
          <DialogDescription>
            Anyone with this link can open and continue the conversation.
          </DialogDescription>

          {shareLoading ? (
            <div className="mt-6 flex items-center gap-3 text-foreground/60">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Generating share link...</span>
            </div>
          ) : shareError ? (
            <p className="mt-4 text-sm text-red-500">{shareError}</p>
          ) : (
            <>
              <div className="mt-4 flex items-center gap-2">
                <input
                  id="share-link"
                  name="share_link"
                  readOnly
                  value={shareUrl}
                  className="flex-1 truncate rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-xs text-foreground/70"
                />
                <button
                  onClick={handleCopyShare}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-deep"
                >
                  Copy
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleShareTo("x")}
                  className="flex flex-col items-center gap-2 rounded-lg border border-black/10 px-3 py-3 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="currentColor"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.507 11.24h-6.667l-5.219-6.834-5.98 6.834H1.658l7.73-8.835L1.25 2.25h6.835l4.713 6.231zm-1.161 17.52h1.833L6.612 4.126H4.646z" />
                    </svg>
                  </span>
                  <span>Share on X</span>
                </button>
                <button
                  onClick={() => handleShareTo("whatsapp")}
                  className="flex flex-col items-center gap-2 rounded-lg border border-black/10 px-3 py-3 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="currentColor"
                    >
                      <path d="M12.04 2.001c-5.505 0-9.998 4.493-9.998 9.998 0 1.765.462 3.486 1.338 4.997L2 22l5.147-1.312a9.96 9.96 0 0 0 4.893 1.313h.004c5.505 0 9.998-4.493 9.998-9.998 0-2.668-1.039-5.177-2.926-7.07A9.92 9.92 0 0 0 12.04 2.001zm5.705 15.037c-.24.676-1.38 1.293-1.901 1.347-.495.052-1.12.074-1.806-.114-.415-.131-.948-.31-1.633-.606-2.873-1.236-4.743-4.144-4.886-4.336-.14-.192-1.164-1.547-1.164-2.952 0-1.405.735-2.096.995-2.38.258-.284.564-.355.752-.355.188 0 .376.001.54.009.174.008.41-.066.642.488.24.576.815 2.002.886 2.148.07.146.117.316.023.508-.095.192-.142.316-.282.486-.14.17-.296.381-.423.512-.14.14-.286.293-.123.575.163.282.727 1.2 1.56 1.944 1.072.956 1.976 1.252 2.258 1.392.282.14.446.117.611-.07.164-.187.705-.82.893-1.102.188-.282.376-.235.634-.14.258.094 1.64.773 1.92.914.282.14.47.21.54.328.07.118.07.683-.17 1.36z" />
                    </svg>
                  </span>
                  <span>WhatsApp</span>
                </button>
                <button
                  onClick={() => handleShareTo("instagram")}
                  className="flex flex-col items-center gap-2 rounded-lg border border-black/10 px-3 py-3 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#515bd4] text-white">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="currentColor"
                    >
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.366.062 2.633.333 3.608 1.308.975.975 1.246 2.242 1.308 3.608.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.062 1.366-.333 2.633-1.308 3.608-.975.975-2.242 1.246-3.608 1.308-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.366-.062-2.633-.333-3.608-1.308-.975-.975-1.246-2.242-1.308-3.608-.058-1.266-.07-1.646-.07-4.85s.012-3.584.07-4.85c.062-1.366.333-2.633 1.308-3.608.975-.975 2.242-1.246 3.608-1.308 1.266-.058 1.646-.07 4.85-.07m0-2.163C8.741 0 8.332.013 7.052.072 5.775.131 4.602.356 3.6 1.358 2.598 2.36 2.373 3.533 2.314 4.81 2.255 6.09 2.242 6.499 2.242 9.758v4.484c0 3.259.013 3.668.072 4.948.059 1.277.284 2.45 1.286 3.452 1.002 1.002 2.175 1.227 3.452 1.286 1.28.059 1.689.072 4.948.072s3.668-.013 4.948-.072c1.277-.059 2.45-.284 3.452-1.286 1.002-1.002 1.227-2.175 1.286-3.452.059-1.28.072-1.689.072-4.948V9.758c0-3.259-.013-3.668-.072-4.948-.059-1.277-.284-2.45-1.286-3.452C19.45.356 18.277.131 17 .072 15.72.013 15.311 0 12 0z" />
                    </svg>
                  </span>
                  <span>Instagram</span>
                </button>
              </div>
              <p className="mt-3 text-xs text-foreground/40">
                Instagram will open in a new tab. Paste the link in your story or
                bio.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const ThreadItem = ({
  thread,
  onPrefetch,
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

  const handleExport = async (format: "markdown" | "json" | "text" | "html") => {
    if (!threadMessages) return;
    try {
      const orderedMessages = [...threadMessages].sort(
        (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0),
      );
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

      const exportBase = await import("./sidebarExportBase");
      const transcriptEntries =
        exportBase.normalizeTranscriptEntries(orderedMessages);

      if (format === "html") {
        const exportHtml = await import("./sidebarExportHtml");
        const transcript = exportHtml.formatTranscriptHtml(transcriptEntries);
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${exportBase.escapeHtml(threadTitle)}</title>
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
      <h1>${exportBase.escapeHtml(threadTitle)}</h1>
      <div><a href="${exportBase.escapeHtml(threadUrl)}">${exportBase.escapeHtml(threadUrl)}</a></div>
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
        const transcript = exportBase.formatTranscriptMarkdown(transcriptEntries);
        const content = `# ${threadTitle}\n\n${threadUrl}\n\nExported: ${exportedAt}\n\n---\n\n${transcript}`;
        downloadTextFile(
          formatExportFilename(threadTitle, "md"),
          content,
          "text/markdown",
        );
        return;
      }

      const transcript = exportBase.formatTranscriptText(transcriptEntries);
      const content = `${threadTitle}\n${threadUrl}\nExported: ${exportedAt}\n\n${transcript}`;
      downloadTextFile(
        formatExportFilename(threadTitle, "txt"),
        content,
        "text/plain",
      );
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Sidebar] export failed", err);
      toast.error("Export failed. Please try again.");
    }
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
            onMouseEnter={() => onPrefetch?.(thread._id)}
            onFocus={() => onPrefetch?.(thread._id)}
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
            {thread.parentThreadId ? (
              <GitBranch
                size={14}
                className={cn(
                  "flex-shrink-0 text-primary/60 transition-opacity",
                  isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100",
                )}
              />
            ) : (
              <MessageSquare
                size={14}
                className={cn(
                  "flex-shrink-0 transition-opacity",
                  thread.isPinned || isActive
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-40",
                )}
              />
            )}
            {isEditing ? (
              <input
                id={`thread-title-${thread._id}`}
                name="thread_title"
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
            <DropdownMenuItem
              onSelect={() =>
                togglePinned({
                  id: thread._id,
                  sessionId: sessionId || undefined,
                })
              }
            >
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
              togglePinned({
                id: thread._id,
                sessionId: sessionId || undefined,
              });
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
