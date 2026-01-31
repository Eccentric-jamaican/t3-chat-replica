import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp, Home } from "lucide-react";
import { Button } from "../ui/button";
import { useState } from "react";

export function ErrorPage({ error }: { error: Error }) {
  const [showDetails, setShowDetails] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <div className="relative z-10 flex flex-col items-center max-w-lg w-full text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
        {/* Error Icon */}
        <div className="relative">
          <div className="absolute inset-0 bg-red-400/20 blur-3xl rounded-full" />
          <div className="relative bg-white/40 border-reflect rounded-3xl p-8 shadow-2xl backdrop-blur-md">
            <AlertCircle size={64} className="text-red-500/80 mx-auto" />
          </div>
        </div>

        {/* Messaging */}
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-foreground tracking-tight sm:text-4xl">
            Something went wrong
          </h1>
          <p className="text-lg text-foreground/60 font-medium">
            We've encountered an unexpected hiccup.
          </p>
        </div>

        {/* Technical Details (Collapsible) */}
        <div className="w-full bg-black/5 rounded-2xl overflow-hidden border border-black/5">
          <button 
            onClick={() => setShowDetails(!showDetails)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-foreground/40 hover:bg-black/5 transition-colors"
          >
            <span>TECHNICAL DETAILS</span>
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {showDetails && (
            <div className="px-4 pb-4 pt-0 text-left">
              <pre className="text-xs text-red-600/70 font-mono bg-white/50 p-3 rounded-lg border border-red-200/50 break-words whitespace-pre-wrap max-h-40 overflow-y-auto">
                {error.message || "An unknown error occurred"}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <Button 
            size="lg" 
            className="w-full sm:w-auto gap-2 group"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-500" />
            Reload Page
          </Button>
          <Button 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto gap-2"
            onClick={() => navigate({ to: "/" })}
          >
            <Home size={18} />
            Go Home
          </Button>
        </div>
      </div>
    </div>
  );
}
