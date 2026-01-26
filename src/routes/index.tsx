import { createFileRoute } from '@tanstack/react-router'
import { Sidebar } from '../components/layout/Sidebar'
import { ChatInput, type ChatInputHandle } from '../components/chat/ChatInput'
import { LandingHero } from '../components/chat/LandingHero'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const chatInputRef = useRef<ChatInputHandle>(null)
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)

  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile])

  return (
    <div className="flex h-dvh min-h-screen overflow-hidden bg-background relative">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="flex-1 flex flex-col relative min-w-0">
        <main className="flex-1 relative flex flex-col items-center justify-center p-4 z-0 overflow-visible">
          <LandingHero onSelectPrompt={(text) => chatInputRef.current?.setContentAndSend(text)} />
        </main>

        <div className="absolute bottom-0 left-0 z-[50] w-full p-2 md:p-4 pt-0">
          <ChatInput ref={chatInputRef} />
        </div>
      </div>
    </div>
  )
}
