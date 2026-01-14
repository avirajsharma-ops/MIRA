'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MIRAProvider, useMIRA } from '@/context/MIRAContext';
import { AuthScreen, AgentDisplay, PeopleLibraryModal, ChatHistoryModal, FaceRegistrationModal, ReminderBar, VoiceEnrollmentModal } from '@/components';

// Detect if running inside an iframe
function useIframeDetection() {
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      // If we can't access window.top due to cross-origin, we're definitely in an iframe
      setIsInIframe(true);
    }

    // Apply iframe mode class to body
    if (window.self !== window.top) {
      document.body.classList.add('iframe-mode');
    }
  }, []);

  return isInIframe;
}

// Code/Outputs Panel Component
function CodeOutputsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { messages } = useMIRA();
  
  // Extract code blocks and structured outputs from messages
  const outputs = messages.flatMap((msg, msgIndex) => {
    if (msg.role === 'user') return [];
    
    const results: { type: 'code' | 'list' | 'table' | 'output'; content: string; language?: string; agent: string; timestamp: Date; id: string }[] = [];
    
    // Extract code blocks (```code```)
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let match;
    let codeIndex = 0;
    while ((match = codeBlockRegex.exec(msg.content)) !== null) {
      results.push({
        type: 'code',
        language: match[1] || 'plaintext',
        content: match[2].trim(),
        agent: msg.role,
        timestamp: msg.timestamp,
        id: `${msgIndex}-code-${codeIndex++}`,
      });
    }
    
    // Extract numbered lists (2+ items)
    const numberedListRegex = /(?:^|\n)(\d+\.\s+.+(?:\n\d+\.\s+.+)+)/gm;
    let listIndex = 0;
    while ((match = numberedListRegex.exec(msg.content)) !== null) {
      results.push({
        type: 'list',
        content: match[1].trim(),
        agent: msg.role,
        timestamp: msg.timestamp,
        id: `${msgIndex}-numlist-${listIndex++}`,
      });
    }
    
    // Extract bulleted lists (2+ items)
    const bulletListRegex = /(?:^|\n)([-•*]\s+.+(?:\n[-•*]\s+.+)+)/gm;
    let bulletIndex = 0;
    while ((match = bulletListRegex.exec(msg.content)) !== null) {
      results.push({
        type: 'list',
        content: match[1].trim(),
        agent: msg.role,
        timestamp: msg.timestamp,
        id: `${msgIndex}-bulletlist-${bulletIndex++}`,
      });
    }
    
    return results;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed right-4 top-16 bottom-20 w-80 sm:w-96 z-[55] bg-black/90 border border-white/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span className="text-white font-medium">Code & Outputs</span>
          <span className="text-white/40 text-xs">({outputs.length})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
            <path d="M18 6L6 18" />
            <path d="M6 6L18 18" />
          </svg>
        </button>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {outputs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-50">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <p>No code or outputs yet</p>
            <p className="text-xs mt-1">Ask MIRA for code, lists, or data</p>
          </div>
        ) : (
          outputs.map((output) => (
            <div key={output.id} className="bg-white/5 rounded-xl overflow-hidden border border-white/10">
              {/* Output header */}
              <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  {output.type === 'code' && (
                    <>
                      <span className="text-emerald-400 text-xs font-mono">{output.language}</span>
                      <span className="text-white/30">•</span>
                    </>
                  )}
                  {output.type === 'list' && (
                    <>
                      <span className="text-blue-400 text-xs">List</span>
                      <span className="text-white/30">•</span>
                    </>
                  )}
                  <span className={`text-xs ${output.agent === 'mi' ? 'text-pink-400' : output.agent === 'ra' ? 'text-cyan-400' : 'text-purple-400'}`}>
                    {output.agent === 'mi' ? 'मी' : output.agent === 'ra' ? 'रा' : 'MIRA'}
                  </span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(output.content);
                  }}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                  title="Copy to clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
              {/* Output content */}
              <div className="p-3 overflow-x-auto">
                <pre className={`text-xs ${output.type === 'code' ? 'font-mono text-emerald-300' : 'text-white/80'} whitespace-pre-wrap break-words`}>
                  {output.content}
                </pre>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Resting Transcripts Panel - Shows ambient conversation during resting mode
function RestingTranscriptsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { restingTranscript, isResting, miraState } = useMIRA();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new transcripts come in
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [restingTranscript]);

  if (!isOpen) return null;

  return (
    <div className="fixed left-4 top-16 bottom-20 w-80 sm:w-96 z-[55] bg-black/90 border border-white/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isResting ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <span className="text-white font-medium">
            {isResting ? 'Listening (Resting)' : 'Ambient Audio'}
          </span>
          <span className="text-white/40 text-xs">({restingTranscript.length})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
            <path d="M18 6L6 18" />
            <path d="M6 6L18 18" />
          </svg>
        </button>
      </div>
      
      {/* Status bar */}
      <div className={`px-4 py-2 text-xs border-b border-white/10 ${isResting ? 'bg-amber-500/10 text-amber-300' : 'bg-green-500/10 text-green-300'}`}>
        <div className="flex items-center gap-2">
          {isResting ? (
            <>
              <span className="animate-pulse">●</span>
              <span>MIRA is resting - Say "Hey MIRA" to wake up</span>
            </>
          ) : (
            <>
              <span>●</span>
              <span>MIRA is {miraState} - Ambient listening paused</span>
            </>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {restingTranscript.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-50">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <p>No ambient audio detected yet</p>
            <p className="text-xs mt-1">Transcripts will appear here when MIRA is resting</p>
          </div>
        ) : (
          restingTranscript.map((text, index) => (
            <div 
              key={index} 
              className="bg-white/5 rounded-lg p-3 border border-white/10 animate-fade-in"
            >
              <div className="flex items-start gap-2">
                <span className="text-amber-400/70 text-xs mt-0.5">#{index + 1}</span>
                <p className="text-white/80 text-sm flex-1">{text}</p>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* Footer with info */}
      <div className="px-4 py-2 border-t border-white/10 bg-white/5">
        <p className="text-white/40 text-xs text-center">
          Ambient transcripts are saved for context
        </p>
      </div>
    </div>
  );
}

function FloatingKeyboard() {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ name: string; type: string; size: number; data: string }[]>([]);
  const { sendMessage, isLoading } = useMIRA();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((text.trim() || attachments.length > 0) && !isLoading) {
      await sendMessage(text.trim(), attachments.length > 0 ? attachments : undefined);
      setText('');
      setAttachments([]);
      setIsOpen(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: typeof attachments = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Limit file size to 10MB
      if (file.size > 10 * 1024 * 1024) {
        alert(`File ${file.name} is too large. Max size is 10MB.`);
        continue;
      }

      const reader = new FileReader();
      const data = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      newAttachments.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: data,
      });
    }

    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 floating-keyboard-container safe-area-bottom">
      {isOpen ? (
        <div className="flex flex-col gap-2">
          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 sm:px-0 max-w-[calc(100vw-2rem)] sm:max-w-md">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1 bg-purple-600/30 rounded-full text-xs text-white/90 border border-purple-500/30">
                  {att.type.startsWith('image/') ? '🖼️' : att.type === 'application/pdf' ? '📄' : '📎'}
                  <span className="truncate max-w-[100px]">{att.name}</span>
                  <button onClick={() => removeAttachment(i)} className="ml-1 hover:text-red-400">×</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 px-2 sm:px-0">
            {/* File upload button */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.json,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="floating-keyboard-btn p-3 bg-black/40 hover:bg-black/60 rounded-full text-white/70 hover:text-white transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center border border-white/10"
              title="Attach files"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={attachments.length > 0 ? "Add a message..." : "Type a message..."}
              autoFocus
              className="floating-keyboard-input w-[calc(100vw-11rem)] sm:w-64 max-w-64 px-4 py-3 bg-black/80 border border-white/20 rounded-full text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50 text-base"
            />
            <button
              type="submit"
              disabled={isLoading || (!text.trim() && attachments.length === 0)}
              className="floating-keyboard-btn p-3 bg-purple-600 text-white rounded-full disabled:opacity-50 transition-opacity hover:bg-purple-700 min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => { setIsOpen(false); setAttachments([]); }}
              className="floating-keyboard-btn p-3 bg-black/40 hover:bg-black/60 rounded-full text-white/70 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center border border-white/10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6L18 18" />
              </svg>
            </button>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="floating-keyboard-btn p-4 bg-black/60 hover:bg-black/80 border border-white/20 rounded-full text-white/70 hover:text-white transition-all shadow-lg hover:scale-105 min-w-[56px] min-h-[56px] flex items-center justify-center"
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
  const { isAuthenticated, isAuthLoading, user, logout, clearConversation, isRecording, isCameraActive, messages, isMicReady, pendingNotifications, droppedCalls, dismissNotification, acknowledgeDroppedCall, reminders, reminderJustCreated, clearReminderCreatedFlag, miraState, isResting, restingTranscript, isOwnerVoiceEnrolled, isEnrollingVoice, startVoiceEnrollment, currentSpeakerName, isOwnerSpeaking, micError, attemptMicRecovery, idleTimeRemaining, isConnected } = useMIRA();
  const [showPeopleModal, setShowPeopleModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showFaceRegistration, setShowFaceRegistration] = useState(false);
  const [showVoiceEnrollment, setShowVoiceEnrollment] = useState(false);
  const [hasCheckedOwnerFace, setHasCheckedOwnerFace] = useState(false);
  const [hasCheckedVoiceEnrollment, setHasCheckedVoiceEnrollment] = useState(false);
  const [showVoiceEnrollmentPrompt, setShowVoiceEnrollmentPrompt] = useState(false);
  const [showUI, setShowUI] = useState(false); // UI hidden by default
  const [showCodePanel, setShowCodePanel] = useState(false); // Code/outputs panel
  const [showReminderBar, setShowReminderBar] = useState(false); // Reminders panel
  const [showRestingPanel, setShowRestingPanel] = useState(false); // Resting transcripts panel
  const [isRecoveringMic, setIsRecoveringMic] = useState(false);
  const prevMessagesLengthRef = useRef(0);
  const prevRestingRef = useRef(false);
  const isInIframe = useIframeDetection();

  // Check if voice enrollment is needed (show prompt if not enrolled)
  useEffect(() => {
    if (isAuthenticated && !hasCheckedVoiceEnrollment && !isAuthLoading) {
      // Small delay to let the voice enrollment status load
      const timer = setTimeout(() => {
        if (!isOwnerVoiceEnrolled && !isEnrollingVoice) {
          setShowVoiceEnrollmentPrompt(true);
        }
        setHasCheckedVoiceEnrollment(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, hasCheckedVoiceEnrollment, isOwnerVoiceEnrolled, isEnrollingVoice, isAuthLoading]);

  // Hide prompt when enrollment completes
  useEffect(() => {
    if (isOwnerVoiceEnrolled) {
      setShowVoiceEnrollmentPrompt(false);
    }
  }, [isOwnerVoiceEnrolled]);

  // Auto-show/hide resting panel based on MIRA state
  useEffect(() => {
    if (isResting && !prevRestingRef.current) {
      // MIRA just went to resting - show the ambient panel
      setShowRestingPanel(true);
    } else if (!isResting && prevRestingRef.current) {
      // MIRA just woke up (active) - hide the ambient panel
      setShowRestingPanel(false);
    }
    prevRestingRef.current = isResting;
  }, [isResting]);

  // Auto-open ReminderBar when reminder is created
  useEffect(() => {
    if (reminderJustCreated) {
      setShowReminderBar(true);
      clearReminderCreatedFlag();
    }
  }, [reminderJustCreated, clearReminderCreatedFlag]);

  // Count urgent reminders for badge
  const urgentReminderCount = reminders.filter(r => {
    const now = new Date();
    const due = new Date(r.dueDate);
    const diff = due.getTime() - now.getTime();
    const hoursLeft = diff / (1000 * 60 * 60);
    return hoursLeft <= 1 || diff < 0;
  }).length;

  // Auto-open code panel when AI sends code or structured output
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      // Check the latest message for code blocks or lists
      const latestMsg = messages[messages.length - 1];
      if (latestMsg && latestMsg.role !== 'user') {
        // Detect code blocks
        const hasCodeBlock = /```[\s\S]*?```/.test(latestMsg.content);
        // Detect numbered lists (2+ items)
        const hasNumberedList = /(?:^|\n)\d+\.\s+.+(?:\n\d+\.\s+.+)+/m.test(latestMsg.content);
        // Detect bulleted lists (2+ items)
        const hasBulletedList = /(?:^|\n)[-•*]\s+.+(?:\n[-•*]\s+.+)+/m.test(latestMsg.content);
        // Detect step-by-step content
        const hasSteps = /(?:step\s*\d|first,|second,|third,|finally,)/i.test(latestMsg.content);
        
        if (hasCodeBlock || hasNumberedList || hasBulletedList || hasSteps) {
          setShowCodePanel(true);
        }
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Check if owner face exists after authentication
  const checkOwnerFace = useCallback(async () => {
    if (!isAuthenticated || hasCheckedOwnerFace) return;
    
    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch('/api/faces/owner', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (!data.hasOwnerFace) {
          // Show face registration popup if no owner face registered
          setShowFaceRegistration(true);
        }
      }
    } catch (err) {
      console.error('Error checking owner face:', err);
    } finally {
      setHasCheckedOwnerFace(true);
    }
  }, [isAuthenticated, hasCheckedOwnerFace]);

  useEffect(() => {
    checkOwnerFace();
  }, [checkOwnerFace]);

  // Show loading screen while checking auth
  if (isAuthLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isInIframe ? 'bg-black/80' : 'bg-black'}`}>
        <div className="flex flex-col items-center gap-4">
          <img src="/icons/favicon.png" alt="MIRA" className="w-16 h-16 rounded-2xl animate-pulse" />
          <div className={`text-sm ${isInIframe ? 'text-black/60' : 'text-white/60'}`}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  // Handle mic recovery
  const handleMicRecovery = async () => {
    setIsRecoveringMic(true);
    try {
      const success = await attemptMicRecovery();
      if (!success) {
        console.warn('Mic recovery failed');
      }
    } finally {
      setIsRecoveringMic(false);
    }
  };

  return (
    <div className={`min-h-screen app-container ${isInIframe ? 'bg-transparent' : 'bg-black'}`}>
      {/* Voice Enrollment Prompt - Show before user can use MIRA */}
      {showVoiceEnrollmentPrompt && !isOwnerVoiceEnrolled && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-gray-900 to-black border border-purple-500/30 rounded-3xl px-8 py-8 shadow-2xl max-w-md mx-4">
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <div>
                <h2 className="text-white text-xl font-semibold mb-2">Set Up Your Voice</h2>
                <p className="text-white/70 text-sm leading-relaxed">
                  MIRA needs to learn your voice to recognize you. This takes about 30 seconds and helps MIRA distinguish you from others.
                </p>
              </div>
              <div className="flex flex-col gap-3 w-full mt-2">
                <button
                  onClick={() => {
                    setShowVoiceEnrollmentPrompt(false);
                    setShowVoiceEnrollment(true);
                  }}
                  className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium rounded-xl transition-all shadow-lg hover:shadow-purple-500/25"
                >
                  Enroll My Voice
                </button>
                <button
                  onClick={() => setShowVoiceEnrollmentPrompt(false)}
                  className="w-full py-2 px-6 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-sm rounded-xl transition-all"
                >
                  Skip for now
                </button>
              </div>
              <p className="text-white/40 text-xs mt-1">
                You can always enroll later from the Voice ID button
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mic Error Recovery Toast */}
      {micError && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] animate-slide-in">
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 shadow-xl backdrop-blur-sm flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <div className="flex-1">
              <p className="text-white text-sm font-medium">Microphone Issue</p>
              <p className="text-white/60 text-xs">{micError}</p>
            </div>
            <button
              onClick={handleMicRecovery}
              disabled={isRecoveringMic}
              className="px-3 py-1.5 bg-red-500/30 hover:bg-red-500/50 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
            >
              {isRecoveringMic ? 'Recovering...' : 'Retry'}
            </button>
          </div>
        </div>
      )}

      {/* MIRA Getting Ready Loading Dialog - hide when mic is ready, recording, or in resting mode */}
      {!isMicReady && !isRecording && !isResting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <div className="bg-black/90 border border-white/20 rounded-3xl px-8 py-6 shadow-2xl">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse" />
                <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-white/30 animate-spin" style={{ borderTopColor: 'transparent' }} />
              </div>
              <div className="text-white/90 font-medium text-lg">MIRA is getting ready...</div>
              <div className="text-white/50 text-sm">Setting up voice connection</div>
              <button 
                className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-full text-xs text-white/70 pointer-events-auto transition-colors"
                onClick={() => window.location.reload()}
              >
                Reload if stuck
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Top center toggle buttons */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2">
        {/* Reminders Panel Toggle Button (Left side) */}
        <button
          onClick={() => setShowReminderBar(!showReminderBar)}
          className={`p-2 border rounded-full transition-all relative ${
            showReminderBar 
              ? 'bg-amber-500/30 border-amber-500/50 text-amber-400' 
              : 'bg-black/40 hover:bg-black/60 border-white/20 text-white/70 hover:text-white'
          }`}
          title={showReminderBar ? 'Hide Reminders' : 'Show Reminders'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          {urgentReminderCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
              {urgentReminderCount}
            </span>
          )}
        </button>

        {/* UI Toggle Button */}
        <button
          onClick={() => setShowUI(!showUI)}
          className="p-2 bg-black/60 hover:bg-black/80 border border-white/20 rounded-full text-white/70 hover:text-white transition-all ui-toggle-btn"
          title={showUI ? 'Hide UI' : 'Show UI'}
        >
          {showUI ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>

        {/* Resting Transcripts Panel Toggle (Left side) */}
        <button
          onClick={() => setShowRestingPanel(!showRestingPanel)}
          className={`relative p-2 border rounded-full transition-all ${
            showRestingPanel 
              ? 'bg-amber-500/30 border-amber-500/50 text-amber-400' 
              : isResting
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 animate-pulse'
                : 'bg-black/40 hover:bg-black/60 border-white/20 text-white/70 hover:text-white'
          }`}
          title={showRestingPanel ? 'Hide Ambient Audio' : 'Show Ambient Audio'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          {restingTranscript.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {restingTranscript.length > 9 ? '9+' : restingTranscript.length}
            </span>
          )}
        </button>

        {/* Code/Outputs Panel Toggle Button (Right side) */}
        <button
          onClick={() => setShowCodePanel(!showCodePanel)}
          className={`p-2 border rounded-full transition-all ${
            showCodePanel 
              ? 'bg-emerald-500/30 border-emerald-500/50 text-emerald-400' 
              : 'bg-black/40 hover:bg-black/60 border-white/20 text-white/70 hover:text-white'
          }`}
          title={showCodePanel ? 'Hide Code & Outputs' : 'Show Code & Outputs'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
      </div>

      {/* Header - Collapsible */}
      <header className={`fixed top-0 left-0 right-0 z-50 bg-black/90 border-b border-white/10 safe-area-top ui-collapsible ${showUI ? 'ui-visible' : 'ui-hidden'}`}>
        <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <img src="/icons/favicon.png" alt="MIRA" className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg" />
              <h1 className="text-xl sm:text-2xl font-bold text-white">
                MIRA
              </h1>
            </div>
            <span className="text-white/30 text-sm hidden sm:inline">|</span>
            <span className="text-white/50 text-xs sm:text-sm hidden sm:inline">Hello, {user?.name}</span>
            {/* Status indicators */}
            <div className="flex items-center gap-1 sm:gap-2 ml-2 sm:ml-4">
              <div className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs ${isRecording ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                <div className={`w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full ${isRecording ? 'bg-green-400 animate-pulse' : 'bg-white/40'}`} />
                <span className="hidden xs:inline">Mic</span>
              </div>
              <div className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs ${isCameraActive ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/40'}`}>
                <div className={`w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full ${isCameraActive ? 'bg-blue-400 animate-pulse' : 'bg-white/40'}`} />
                <span className="hidden xs:inline">Cam</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* People Library Button */}
            <button
              onClick={() => setShowPeopleModal(true)}
              className="flex items-center justify-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-cyan-400 text-xs sm:text-sm transition-colors min-w-[36px] sm:min-w-0 min-h-[36px]"
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

            {/* Voice Enrollment Button */}
            <button
              onClick={() => setShowVoiceEnrollment(true)}
              className={`flex items-center justify-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 border rounded-lg text-xs sm:text-sm transition-colors min-w-[36px] sm:min-w-0 min-h-[36px] ${
                isOwnerVoiceEnrolled 
                  ? 'bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-400' 
                  : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400 animate-pulse'
              }`}
              title={isOwnerVoiceEnrolled ? 'Voice Enrolled ✓' : 'Enroll Your Voice'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span className="hidden sm:inline">{isOwnerVoiceEnrolled ? 'Voice ✓' : 'Voice ID'}</span>
            </button>

            {/* Chat History Button */}
            <button
              onClick={() => setShowHistoryModal(true)}
              className="flex items-center justify-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-400 text-xs sm:text-sm transition-colors min-w-[36px] sm:min-w-0 min-h-[36px]"
              title="Chat History"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="hidden sm:inline">History</span>
            </button>

            <div className="w-px h-6 bg-white/10 hidden sm:block" />

            {/* Auto-initiate indicator - always on, no toggle */}
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-white/50 text-sm hidden lg:inline">Always Listening</span>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="MIRA is always ready" />
            </div>

            <button
              onClick={clearConversation}
              className="hidden sm:block px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/70 text-sm transition-colors"
            >
              New Chat
            </button>

            <button
              onClick={logout}
              className="px-2 sm:px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs sm:text-sm transition-colors min-h-[36px]"
            >
              <span className="hidden sm:inline">Logout</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sm:hidden">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main content - Full width agent display */}
      <main className={`h-screen ${showUI ? 'pt-14 sm:pt-16' : 'pt-0'}`}>
        <AgentDisplay showControls={showUI} />
      </main>

      {/* Floating keyboard button */}
      <FloatingKeyboard />

      {/* Reminder Bar (Left side) */}
      <ReminderBar 
        isOpen={showReminderBar} 
        onClose={() => setShowReminderBar(false)} 
      />

      {/* Code & Outputs Panel (Right side) */}
      <CodeOutputsPanel 
        isOpen={showCodePanel} 
        onClose={() => setShowCodePanel(false)} 
      />

      {/* Resting Transcripts Panel (Left side) */}
      <RestingTranscriptsPanel 
        isOpen={showRestingPanel} 
        onClose={() => setShowRestingPanel(false)} 
      />

      {/* Reminder Notifications Toast */}
      {pendingNotifications.length > 0 && (
        <div className="fixed bottom-24 right-4 z-[70] flex flex-col gap-2 max-w-sm">
          {pendingNotifications.slice(0, 3).map((notification) => (
            <div
              key={notification.id}
              className={`p-3 rounded-xl border shadow-xl backdrop-blur-sm animate-slide-in ${
                notification.urgency === 'overdue' ? 'bg-red-500/20 border-red-500/50' :
                notification.urgency === 'urgent' ? 'bg-orange-500/20 border-orange-500/50' :
                notification.urgency === 'warning' ? 'bg-yellow-500/20 border-yellow-500/50' :
                'bg-blue-500/20 border-blue-500/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {notification.urgency === 'overdue' ? '🚨' :
                       notification.urgency === 'urgent' ? '⚠️' :
                       notification.urgency === 'warning' ? '⏰' : '📋'}
                    </span>
                    <span className="text-white font-medium text-sm">{notification.title}</span>
                  </div>
                  <p className="text-white/70 text-xs mt-1">{notification.message}</p>
                </div>
                <button
                  onClick={() => dismissNotification(notification.id)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
                    <path d="M18 6L6 18" />
                    <path d="M6 6L18 18" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dropped Calls Toast */}
      {droppedCalls.length > 0 && (
        <div className="fixed bottom-24 left-4 z-[70] flex flex-col gap-2 max-w-sm">
          {droppedCalls.slice(0, 2).map((call) => (
            <div
              key={call.id}
              className="p-3 rounded-xl border shadow-xl backdrop-blur-sm bg-purple-500/20 border-purple-500/50 animate-slide-in"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📞</span>
                    <span className="text-white font-medium text-sm">Dropped Call</span>
                  </div>
                  <p className="text-white/70 text-xs mt-1">
                    {call.callerInfo || 'Unknown caller'} • {call.timestamp.toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => acknowledgeDroppedCall(call.id)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
                    <path d="M18 6L6 18" />
                    <path d="M6 6L18 18" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fixed Idle Timer - Bottom Left Corner */}
      {isConnected && !isResting && (
        <div className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium shadow-lg backdrop-blur-sm transition-all ${
          idleTimeRemaining <= 2 
            ? 'bg-red-500/30 border border-red-500/50 text-red-400 animate-pulse' 
            : idleTimeRemaining <= 3 
              ? 'bg-amber-500/25 border border-amber-500/40 text-amber-400' 
              : 'bg-white/10 border border-white/20 text-white/70'
        }`} title="Time until MIRA goes to sleep">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{idleTimeRemaining}s</span>
        </div>
      )}

      {/* Modals */}
      <PeopleLibraryModal 
        isOpen={showPeopleModal} 
        onClose={() => setShowPeopleModal(false)} 
      />
      <ChatHistoryModal 
        isOpen={showHistoryModal} 
        onClose={() => setShowHistoryModal(false)} 
      />
      <FaceRegistrationModal
        isOpen={showFaceRegistration}
        onClose={() => setShowFaceRegistration(false)}
        onSuccess={() => setShowFaceRegistration(false)}
        userName={user?.name || 'User'}
        isNewAccount={!hasCheckedOwnerFace}
      />
      <VoiceEnrollmentModal
        isOpen={showVoiceEnrollment}
        onClose={() => setShowVoiceEnrollment(false)}
        onComplete={() => setShowVoiceEnrollment(false)}
        userName={user?.name || 'User'}
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
