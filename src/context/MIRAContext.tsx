'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useMediaCapture } from '@/hooks';
import { useMIRAEngine } from '@/hooks/useMIRAEngine';
import { isMobileDevice } from '@/lib/utils/deviceDetection';
import { SpeakerDetectionManager, DetectedSpeaker } from '@/lib/voice/speakerDetection';

type AgentType = 'mira';

interface Message {
  id: string;
  role: 'user' | 'mira' | 'system';
  content: string;
  timestamp: Date;
  emotion?: string;
}

interface VisualContext {
  cameraDescription?: string;
  screenDescription?: string;
}

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  data: string;
}

interface DateTimeContext {
  date: string;
  time: string;
  dayOfWeek: string;
  timestamp: number;
  timezone: string;
  formattedDateTime: string;
}

// MIRA wake words - simple and fast
const MIRA_WAKE_WORDS = new Set([
  'mira', 'meera', 'mi', 'ra', 'myra', 'mera', 'maya', 'mia', 'miri',
  'hey mira', 'hi mira', 'hello mira', 'ok mira', 'okay mira',
]);

function containsWakeWord(text: string): boolean {
  const lower = text.toLowerCase().trim();
  
  // Direct match
  for (const wake of MIRA_WAKE_WORDS) {
    if (lower.includes(wake)) return true;
  }
  
  // Check first few words
  const words = lower.split(/\s+/).slice(0, 4);
  for (const word of words) {
    const clean = word.replace(/[.,!?'"]/g, '');
    if (MIRA_WAKE_WORDS.has(clean)) return true;
  }
  
  return false;
}

function getCurrentDateTime(): DateTimeContext {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  return {
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0],
    dayOfWeek: days[now.getDay()],
    timestamp: now.getTime(),
    timezone,
    formattedDateTime: now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  };
}

interface MIRAContextType {
  // Auth
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  user: { id: string; name: string; email: string } | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;

  // Conversation
  messages: Message[];
  isLoading: boolean;
  sendMessage: (text: string, attachments?: FileAttachment[]) => Promise<void>;
  clearConversation: () => void;

  // Voice - Pure WebRTC
  isConnected: boolean;
  isMicReady: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  activeProvider: string;
  isListening: boolean;
  isSpeaking: boolean;
  speakingAgent: AgentType | null;
  audioLevel: number;
  outputAudioLevel: number; // MIRA's voice level for sphere reactivity
  transcript: string;
  lastResponse: string;
  connect: () => void;
  disconnect: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  enableProactive: boolean;
  setEnableProactive: (value: boolean) => void;

  // Media
  isCameraActive: boolean;
  isScreenActive: boolean;
  cameraStream: MediaStream | null;
  startCamera: () => Promise<MediaStream | null>;
  stopCamera: () => void;
  startScreenCapture: () => Promise<MediaStream | null>;
  stopScreenCapture: () => void;
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
  visualContext: VisualContext;

  // Time
  dateTime: DateTimeContext;
}

const MIRAContext = createContext<MIRAContextType | null>(null);

export function useMIRA() {
  const context = useContext(MIRAContext);
  if (!context) {
    throw new Error('useMIRA must be used within a MIRAProvider');
  }
  return context;
}

export function MIRAProvider({ children }: { children: React.ReactNode }) {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(null);

  // Conversation state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Proactive mode
  const [enableProactive, setEnableProactive] = useState(false);

  // Visual context
  const [visualContext, setVisualContext] = useState<VisualContext>({});

  // DateTime state
  const [dateTime, setDateTime] = useState<DateTimeContext>(() => getCurrentDateTime());

  // Auto-start ref
  const autoStartedRef = useRef(false);
  
  // Speaker detection for identifying different people in conversations
  const speakerManagerRef = useRef<SpeakerDetectionManager | null>(null);
  const [pendingUnknownSpeakers, setPendingUnknownSpeakers] = useState<DetectedSpeaker[]>([]);
  const lastSpeechTimeRef = useRef<number>(Date.now());
  const conversationSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const askAboutSpeakersRef = useRef<(() => void) | null>(null);

  // Update datetime every minute
  useEffect(() => {
    const interval = setInterval(() => setDateTime(getCurrentDateTime()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Send message to chat API
  const sendMessage = useCallback(async (text: string, attachments?: FileAttachment[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    
    setIsLoading(true);
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          message: text,
          attachments,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const miraMessage: Message = {
          id: `${Date.now()}-response`,
          role: 'mira',
          content: data.response || data.message || 'I received your message.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, miraMessage]);
      }
    } catch (error) {
      console.error('[MIRA] Send message error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Clear conversation
  const clearConversation = useCallback(() => {
    setMessages([]);
  }, []);

  // Session ID for transcripts (generated once per session)
  const sessionIdRef = useRef(`session_${Date.now()}`);
  
  // Save transcript entry to database (background)
  const saveTranscript = useCallback(async (
    content: string,
    speakerType: 'user' | 'mira' | 'other',
    speakerName?: string
  ) => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return;
      
      // Fire and forget - don't await
      fetch('/api/transcripts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          content,
          speakerType,
          speakerName: speakerName || (speakerType === 'mira' ? 'MIRA' : undefined),
        }),
      }).catch(err => console.error('[Transcript Save]', err));
    } catch (err) {
      console.error('[Transcript Save Error]', err);
    }
  }, []);
  
  // Initialize speaker manager when user is authenticated
  useEffect(() => {
    if (user?.id && !speakerManagerRef.current) {
      speakerManagerRef.current = new SpeakerDetectionManager(
        sessionIdRef.current,
        user.id,
        {
          onUnknownSpeakerDetected: (speaker) => {
            console.log('[Speaker Detection] New unknown speaker detected:', speaker.id);
            setPendingUnknownSpeakers(prev => [...prev, speaker]);
          },
        }
      );
    }
  }, [user?.id]);
  
  // Function to ask about unknown speakers after conversation ends
  const askAboutUnknownSpeakers = useCallback(() => {
    if (pendingUnknownSpeakers.length === 0) return;
    
    const unknownSpeaker = pendingUnknownSpeakers[0];
    const speechSample = unknownSpeaker.speechSegments
      .map(s => s.text)
      .join(' ')
      .slice(0, 200);
    
    // Add a system message that will trigger MIRA to ask
    const systemMessage: Message = {
      id: `system_${Date.now()}`,
      role: 'system',
      content: `[SPEAKER_IDENTIFICATION_NEEDED] I detected another person in your conversation who said: "${speechSample}". Who was that person? I'd like to remember them for future conversations.`,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, systemMessage]);
    
    // Save to transcript as "other"
    saveTranscript(speechSample, 'other', 'Unknown Person');
    
    console.log('[Speaker Detection] Asking about unknown speaker, speech sample:', speechSample);
  }, [pendingUnknownSpeakers, saveTranscript]);
  
  // Store the ask function in ref so timer can access it
  useEffect(() => {
    askAboutSpeakersRef.current = askAboutUnknownSpeakers;
  }, [askAboutUnknownSpeakers]);
  
  // Check for conversation silence and trigger speaker identification
  const checkConversationSilence = useCallback(() => {
    // Clear existing timer
    if (conversationSilenceTimerRef.current) {
      clearTimeout(conversationSilenceTimerRef.current);
    }
    
    // Set new timer - wait 5 seconds of silence before asking
    conversationSilenceTimerRef.current = setTimeout(() => {
      if (pendingUnknownSpeakers.length > 0 && askAboutSpeakersRef.current) {
        askAboutSpeakersRef.current();
      }
    }, 5000);
  }, [pendingUnknownSpeakers.length]);

  // Handle transcript from WebRTC - with speaker detection
  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) return;
    
    console.log('[MIRA] Transcript:', text);
    
    // Update last speech time
    lastSpeechTimeRef.current = Date.now();
    
    // Process through speaker detection
    // Note: For now we attribute to user, but the system listens for different voices
    // In production, this would analyze audio characteristics
    if (speakerManagerRef.current) {
      speakerManagerRef.current.processSpeech(text, undefined, true);
    }
    
    // Check if this might be someone else talking (heuristic: not directed at MIRA)
    const isDirectedAtMira = containsWakeWord(text);
    
    // If not directed at MIRA and we detect conversation-like patterns
    // This is a simplified detection - real implementation would use audio analysis
    const conversationPatterns = [
      /\b(yeah|yes|no|okay|sure|right|hmm|uh huh|really)\b/i,
      /\b(what do you think|I think|in my opinion)\b/i,
      /\b(tell me about|what about|how about)\b/i,
    ];
    
    const looksLikeConversation = conversationPatterns.some(p => p.test(text));
    
    if (!isDirectedAtMira && looksLikeConversation && text.length > 5) {
      // Might be another person - mark for potential speaker detection
      console.log('[Speaker Detection] Possible other person speaking:', text);
      // The speaker detection would ideally use audio characteristics here
    }
    
    // Reset silence timer since there's activity
    checkConversationSilence();
    
    // Check if user is identifying an unknown speaker
    // Patterns like "That was John" or "His name is John" or "It's my friend John"
    const identificationPatterns = [
      /(?:that was|that's|it was|it's|he is|she is|his name is|her name is|they are|their name is)\s+(?:my\s+)?(?:friend|colleague|brother|sister|mom|dad|wife|husband|boss|coworker)?\s*(\w+)/i,
      /(?:^|\s)(\w+)\s+(?:was talking|said that|mentioned)/i,
      /(?:talking to|speaking with|chatting with)\s+(?:my\s+)?(?:friend|colleague)?\s*(\w+)/i,
    ];
    
    for (const pattern of identificationPatterns) {
      const match = text.match(pattern);
      if (match && pendingUnknownSpeakers.length > 0) {
        const identifiedName = match[1];
        const speaker = pendingUnknownSpeakers[0];
        
        console.log('[Speaker Detection] User identified speaker as:', identifiedName);
        
        // Save the identified person
        savePerson(identifiedName, speaker);
        
        // Remove from pending list
        setPendingUnknownSpeakers(prev => prev.slice(1));
        break;
      }
    }
    
    // Save transcript to database (background)
    saveTranscript(text, 'user');
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
  }, [saveTranscript, checkConversationSilence, pendingUnknownSpeakers]);
  
  // Save identified person to database
  const savePerson = useCallback(async (name: string, speaker: DetectedSpeaker) => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return;
      
      const conversationText = speaker.speechSegments.map(s => s.text).join(' ');
      
      // Save to people API
      await fetch('/api/people', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          conversationContext: conversationText,
          firstMet: speaker.firstDetectedAt,
          source: 'voice_detection',
        }),
      });
      
      console.log('[Speaker Detection] Saved person:', name, 'with context:', conversationText.slice(0, 100));
      
      // Update speaker manager
      if (speakerManagerRef.current) {
        speakerManagerRef.current.identifySpeaker(speaker.id, name);
      }
    } catch (err) {
      console.error('[Speaker Detection] Error saving person:', err);
    }
  }, []);

  // Handle AI response from WebRTC
  const handleResponse = useCallback((text: string) => {
    if (!text.trim()) return;
    
    console.log('[MIRA] Response:', text);
    
    // Save MIRA's response to transcript database (background)
    saveTranscript(text, 'mira', 'MIRA');
    
    // Add MIRA message
    const miraMessage: Message = {
      id: `${Date.now()}-response`,
      role: 'mira',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, miraMessage]);
  }, [saveTranscript]);

  const handleError = useCallback((error: string) => {
    console.error('[MIRA] Error:', error);
  }, []);

  // Fallback-enabled AI Engine
  const {
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    isConnected,
    isSpeaking,
    isListening,
    transcript,
    lastResponse,
    audioLevel,
    outputAudioLevel, // MIRA's voice level
    activeProvider // Expose active provider if needed for UI
  } = useMIRAEngine({
    voice: 'mira',
    onTranscript: handleTranscript,
    onResponse: handleResponse,
    onError: handleError,
  });

  // Media capture
  const handleCameraFrame = useCallback(async (imageBase64: string) => {
    if (isMobileDevice()) return;
    // Camera frames available for future use
  }, []);

  const handleScreenFrame = useCallback(async (imageBase64: string) => {
    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch('/api/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ imageBase64, type: 'screen' }),
      });

      if (response.ok) {
        const { analysis } = await response.json();
        setVisualContext(prev => ({
          ...prev,
          screenDescription: analysis.description,
        }));
      }
    } catch (error) {
      console.error('Screen analysis error:', error);
    }
  }, []);

  const {
    isCameraActive,
    isScreenActive,
    cameraStream,
    startCamera,
    stopCamera,
    startScreenCapture,
    stopScreenCapture,
    cameraVideoRef,
  } = useMediaCapture({
    onCameraFrame: handleCameraFrame,
    onScreenFrame: handleScreenFrame,
    captureInterval: 10000,
  });

  // Auto-start WebRTC and Camera after auth
  const autoStart = useCallback(() => {
    if (!autoStartedRef.current) {
      autoStartedRef.current = true;
      // Start WebRTC immediately
      setTimeout(() => {
        connectRealtime();
        console.log('[MIRA] WebRTC connected');
      }, 300);
      
      // Start camera slightly after WebRTC (to not overwhelm browser)
      setTimeout(() => {
        startCamera().then(() => {
          console.log('[MIRA] Camera started for visual recognition');
        }).catch((err) => {
          console.log('[MIRA] Camera auto-start failed:', err);
        });
      }, 800);
    }
  }, [connectRealtime, startCamera]);

  // Auth functions
  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const { user, token } = await response.json();
        localStorage.setItem('mira_token', token);
        setUser(user);
        setIsAuthenticated(true);
        autoStart();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [autoStart]);

  const register = useCallback(async (
    email: string,
    password: string,
    name: string
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });

      if (response.ok) {
        const { user, token } = await response.json();
        localStorage.setItem('mira_token', token);
        setUser(user);
        setIsAuthenticated(true);
        autoStart();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [autoStart]);

  const logout = useCallback(() => {
    localStorage.removeItem('mira_token');
    setUser(null);
    setIsAuthenticated(false);
    setMessages([]);
    disconnectRealtime();
  }, [disconnectRealtime]);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('mira_token');
      if (!token) {
        setIsAuthLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const { user } = await response.json();
          setUser(user);
          setIsAuthenticated(true);
          autoStart();
        } else {
          localStorage.removeItem('mira_token');
        }
      } catch {
        localStorage.removeItem('mira_token');
      } finally {
        setIsAuthLoading(false);
      }
    };

    checkAuth();
  }, [autoStart]);

  const value: MIRAContextType = {
    // Auth
    isAuthenticated,
    isAuthLoading,
    user,
    login,
    register,
    logout,

    // Conversation
    messages,
    isLoading,
    sendMessage,
    clearConversation,

    // Voice - Pure WebRTC
    isConnected,
    isMicReady: isConnected,
    isRecording: isListening,
    activeProvider,
    isListening,
    isSpeaking,
    speakingAgent: isSpeaking ? 'mira' : null,
    audioLevel,
    outputAudioLevel, // MIRA's voice level for sphere
    transcript,
    lastResponse,
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    isProcessing: isLoading,
    startRecording: connectRealtime,
    stopRecording: disconnectRealtime,
    enableProactive,
    setEnableProactive,

    // Media
    isCameraActive,
    isScreenActive,
    cameraStream,
    startCamera,
    stopCamera,
    startScreenCapture,
    stopScreenCapture,
    cameraVideoRef,
    visualContext,

    // Time
    dateTime,
  };

  return <MIRAContext.Provider value={value}>{children}</MIRAContext.Provider>;
}

export default MIRAProvider;
