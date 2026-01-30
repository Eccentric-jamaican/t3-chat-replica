import { createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { ChatInput, type ChatInputHandle } from "../components/chat/ChatInput";
import { LandingHero } from "../components/chat/LandingHero";
import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";

import { authClient } from "../lib/auth";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  const chatInputRef = useRef<ChatInputHandle>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const { isPending } = authClient.useSession();

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Show nothing while auth is resolving
  if (isPending) return null;

  return (
    <div className="relative flex h-dvh min-h-screen overflow-hidden bg-background">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <main className="relative z-0 flex flex-1 flex-col items-center justify-center overflow-visible p-4">
          <LandingHero
            onSelectPrompt={(text) =>
              chatInputRef.current?.setContentAndSend(text)
            }
          />
        </main>

        <div className="absolute bottom-0 left-0 z-[50] w-full p-2 pt-0 md:p-4">
          <ChatInput ref={chatInputRef} />
        </div>
      </div>
    </div>
  );
}
