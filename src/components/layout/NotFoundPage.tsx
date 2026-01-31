import { Link } from "@tanstack/react-router";
import { SearchX, Home } from "lucide-react";
import { Button } from "../ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <div className="relative z-10 flex flex-col items-center max-w-md w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Icon & Visual Wrapper */}
        <div className="relative">
          <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
          <div className="relative bg-white/40 border-reflect rounded-3xl p-8 shadow-2xl backdrop-blur-md">
            <SearchX size={64} className="text-primary/60 mx-auto" />
          </div>
        </div>

        {/* Text Content */}
        <div className="space-y-3">
          <h1 className="text-4xl font-black text-foreground tracking-tight sm:text-5xl">
            404
          </h1>
          <p className="text-lg text-foreground/60 font-medium">
            Lost in the whiskers? This page doesn't exist.
          </p>
        </div>

        {/* Navigation Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <Link to="/" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto gap-2 group">
              <Home size={18} className="group-hover:-translate-y-0.5 transition-transform" />
              Take Me Home
            </Button>
          </Link>
          <Button 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto"
            onClick={() => window.history.back()}
          >
            Go Back
          </Button>
        </div>
      </div>
    </div>
  );
}
