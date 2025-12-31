'use client';

import { useState } from 'react';
import { MIRAProvider, useMIRA } from '@/context/MIRAContext';
import { AuthScreen, AgentDisplay, PeopleLibraryModal, ChatHistoryModal } from '@/components';

function FloatingKeyboard() {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const { sendMessage, isLoading } = useMIRA();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !isLoading) {
      await sendMessage(text.trim());
      setText('');
      setIsOpen(false);
    }
  };

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
      {isOpen ? (
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message..."
            autoFocus
            className="w-80 px-4 py-3 bg-black/60 backdrop-blur-md border border-white/20 rounded-full text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50"
          />
          <button
            type="submit"
            disabled={isLoading || !text.trim()}
            className="p-3 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full text-white disabled:opacity-50 transition-opacity hover:opacity-90"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white/70 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6L18 18" />
            </svg>
          </button>
        </form>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="p-4 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-full text-white/70 hover:text-white transition-all shadow-lg hover:scale-105"
          title="Type a message"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01" />
            <path d="M10 8h.01" />
            <path d="M14 8h.01" />
            <path d="M18 8h.01" />
            <path d="M8 12h.01" />
            <path d="M12 12h.01" />
            <path d="M16 12h.01" />
            <path d="M7 16h10" />
          </svg>
        </button>
      )}
    </div>
  );
}

function MIRAApp() {
  const { isAuthenticated, user, logout, clearConversation, enableProactive, setEnableProactive, isRecording, isCameraActive } = useMIRA();
  const [showPeopleModal, setShowPeopleModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/30 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              MIRA
            </h1>
            <span className="text-white/30 text-sm">|</span>
            <span className="text-white/50 text-sm">Hello, {user?.name}</span>
            {/* Status indicators */}
            <div className="flex items-center gap-2 ml-4">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${isRecording ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-green-400 animate-pulse' : 'bg-white/40'}`} />
                Mic
              </div>
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${isCameraActive ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/40'}`}>
                <div className={`w-2 h-2 rounded-full ${isCameraActive ? 'bg-blue-400 animate-pulse' : 'bg-white/40'}`} />
                Camera
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* People Library Button */}
            <button
              onClick={() => setShowPeopleModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm transition-colors"
              title="People Library"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span className="hidden sm:inline">People</span>
            </button>

            {/* Chat History Button */}
            <button
              onClick={() => setShowHistoryModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-400 text-sm transition-colors"
              title="Chat History"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="hidden sm:inline">History</span>
            </button>

            <div className="w-px h-6 bg-white/10" />

            {/* Proactive toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-white/50 text-sm hidden sm:inline">Auto-initiate</span>
              <div
                className={`w-10 h-5 rounded-full transition-colors ${
                  enableProactive ? 'bg-green-500' : 'bg-white/20'
                }`}
                onClick={() => setEnableProactive(!enableProactive)}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full transition-transform mt-0.5 ${
                    enableProactive ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </div>
            </label>

            <button
              onClick={clearConversation}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/70 text-sm transition-colors"
            >
              New Chat
            </button>

            <button
              onClick={logout}
              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main content - Full width agent display */}
      <main className="pt-16 h-screen">
        <AgentDisplay />
      </main>

      {/* Floating keyboard button */}
      <FloatingKeyboard />

      {/* Modals */}
      <PeopleLibraryModal 
        isOpen={showPeopleModal} 
        onClose={() => setShowPeopleModal(false)} 
      />
      <ChatHistoryModal 
        isOpen={showHistoryModal} 
        onClose={() => setShowHistoryModal(false)} 
      />
    </div>
  );
}

export default function Home() {
  return (
    <MIRAProvider>
      <MIRAApp />
    </MIRAProvider>
  );
}
