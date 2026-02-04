import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Loader2, AlertTriangle } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { trackEvent } from "../lib/analytics";

export const Route = createFileRoute("/share/$token")({
  component: ShareRoute,
});

function ShareRoute() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const createShareFork = useMutation(api.threads.createShareFork);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const getSessionId = () => {
      if (typeof window === "undefined") return "";
      const saved = localStorage.getItem("sendcat_session_id");
      if (saved) return saved;
      const newId = uuidv4();
      localStorage.setItem("sendcat_session_id", newId);
      return newId;
    };

    const forkThread = async () => {
      try {
        const sessionId = getSessionId();
        trackEvent("share_thread_open", { token });
        const result = await createShareFork({ token, sessionId });
        if (cancelled) return;
        navigate({ to: "/chat/$threadId", params: { threadId: result.threadId } });
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Unable to open shared chat.");
      }
    };

    forkThread();

    return () => {
      cancelled = true;
    };
  }, [createShareFork, navigate, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      {error ? (
        <div className="w-full max-w-md rounded-2xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-lg font-bold text-foreground">Link unavailable</h1>
          <p className="mt-2 text-sm text-foreground/50">{error}</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white"
          >
            Go home
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-foreground/60">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm font-medium">Preparing shared chat…</span>
        </div>
      )}
    </div>
  );
}
