'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useMediaCapture } from '@/hooks';
import { useMIRAEngine } from '@/hooks/useMIRAEngine';
import { isMobileDevice } from '@/lib/utils/deviceDetection';
import { SpeakerDetectionManager, DetectedSpeaker } from '@/lib/voice/speakerDetection';
import { getPhoneCallDetector, PhoneCallEvent, PhoneCallState } from '@/lib/voice/phoneCallDetection';
import { getReminderTracker, ReminderNotification } from '@/lib/utils/reminderTracker';
import { detectTasks, shouldAutoCreateReminder, DetectedTask, isDirectedAtMira as checkDirectedAtMira, extractTasksFromMiraResponse } from '@/lib/ai/taskDetection';

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

interface ReminderType {
  _id: string;
  title: string;
  description?: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  source: string;
}

// MIRA States - for cost optimization
export type MIRAState = 'resting' | 'active' | 'listening' | 'speaking' | 'thinking';

// MIRA wake words - simple and fast
const MIRA_WAKE_WORDS = new Set([
  'mira', 'meera', 'myra', 'mera', 'maya', 'mia', 'miri',
  'hey mira', 'hi mira', 'hello mira', 'ok mira', 'okay mira',
  // Hindi variations
  'मीरा', 'मिरा', 'मायरा', 'मेरा',
]);

// Fuzzy matching for wake word detection
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

// Check if word is similar to any wake word (fuzzy match)
function isSimilarToWakeWord(word: string): { match: boolean; confidence: number; matchedWord?: string } {
  const clean = word.toLowerCase().replace(/[.,!?'"]/g, '').trim();
  
  // Exact match
  if (MIRA_WAKE_WORDS.has(clean)) {
    return { match: true, confidence: 1.0, matchedWord: clean };
  }
  
  // Fuzzy match - allow 1-2 character differences for words >= 4 chars
  for (const wake of MIRA_WAKE_WORDS) {
    if (wake.includes(' ')) continue; // Skip phrases for fuzzy match
    
    const distance = levenshteinDistance(clean, wake);
    const maxAllowedDistance = clean.length >= 4 ? 2 : 1;
    
    if (distance <= maxAllowedDistance) {
      const confidence = 1 - (distance / Math.max(clean.length, wake.length));
      return { match: true, confidence, matchedWord: wake };
    }
  }
  
  return { match: false, confidence: 0 };
}

// Check for wake word anywhere in text with confidence scoring
function detectWakeWord(text: string): { detected: boolean; confidence: number; position: number } {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);
  
  // Check each word and pairs of words
  for (let i = 0; i < words.length; i++) {
    // Single word check
    const result = isSimilarToWakeWord(words[i]);
    if (result.match) {
      return { detected: true, confidence: result.confidence, position: i };
    }
    
    // Two word phrase check (e.g., "hey mira")
    if (i < words.length - 1) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      if (MIRA_WAKE_WORDS.has(phrase.replace(/[.,!?'"]/g, ''))) {
        return { detected: true, confidence: 1.0, position: i };
      }
    }
  }
  
  return { detected: false, confidence: 0, position: -1 };
}

function containsWakeWord(text: string): boolean {
  return detectWakeWord(text).detected;
}

// Noise and irrelevant audio detection
// Detects music, background noise, TV/radio, and other non-conversational audio
interface NoiseAnalysis {
  isNoise: boolean;
  noiseType: 'music' | 'tv' | 'ambient' | 'gibberish' | 'none';
  confidence: number;
}

function analyzeForNoise(transcript: string): NoiseAnalysis {
  const lower = transcript.toLowerCase().trim();
  const words = lower.split(/\s+/);
  
  // Empty or very short - likely noise
  if (!lower || words.length === 0) {
    return { isNoise: true, noiseType: 'ambient', confidence: 0.9 };
  }
  
  // Single character or very short sounds (hmm, uh, etc.)
  if (lower.length <= 3 && !containsWakeWord(lower)) {
    return { isNoise: true, noiseType: 'ambient', confidence: 0.8 };
  }
  
  // Music detection patterns - lyrics, la la la, na na na, etc.
  const musicPatterns = [
    /\b(la\s*)+la\b/i,
    /\b(na\s*)+na\b/i,
    /\b(da\s*)+da\b/i,
    /\b(oh\s*)+oh\b/i,
    /\b(yeah\s*)+yeah\b/i,
    /\b(baby|love|heart|dance|party|tonight|forever)\s+(baby|love|heart|dance|party|tonight|forever)\b/i,
    /\blalala|nanana|dododo|tralala|hmhmhm\b/i,
  ];
  
  for (const pattern of musicPatterns) {
    if (pattern.test(lower)) {
      return { isNoise: true, noiseType: 'music', confidence: 0.85 };
    }
  }
  
  // TV/Radio detection - common broadcast phrases
  const tvPatterns = [
    /\b(breaking news|weather forecast|sports update|commercial break)\b/i,
    /\b(tune in|stay tuned|coming up next|after the break)\b/i,
    /\b(available at|call now|limited time|order now)\b/i,
    /\b(sponsored by|brought to you by)\b/i,
  ];
  
  for (const pattern of tvPatterns) {
    if (pattern.test(lower)) {
      return { isNoise: true, noiseType: 'tv', confidence: 0.7 };
    }
  }
  
  // Gibberish/unclear audio - lots of repeated sounds or no clear words
  const repeatedSounds = lower.match(/(.)\1{3,}/g); // Same char repeated 4+ times
  if (repeatedSounds && repeatedSounds.length > 0) {
    return { isNoise: true, noiseType: 'gibberish', confidence: 0.75 };
  }
  
  // All words very short (like "a a um uh eh") - likely noise
  const shortWordCount = words.filter(w => w.length <= 2).length;
  if (words.length > 2 && shortWordCount / words.length > 0.7) {
    return { isNoise: true, noiseType: 'ambient', confidence: 0.7 };
  }
  
  // Check for nonsensical combinations - no verbs, no structure
  const hasCommonWords = /\b(the|a|an|is|are|was|were|have|has|do|does|can|will|would|could|should|i|you|he|she|it|we|they|my|your|his|her|what|how|when|where|why|this|that|there|here)\b/i.test(lower);
  
  if (words.length > 3 && !hasCommonWords) {
    // Likely not English/Hindi speech
    return { isNoise: true, noiseType: 'gibberish', confidence: 0.6 };
  }
  
  return { isNoise: false, noiseType: 'none', confidence: 0 };
}

// Check if transcript is meaningful user speech (not noise)
function isMeaningfulSpeech(transcript: string): boolean {
  const noiseAnalysis = analyzeForNoise(transcript);
  return !noiseAnalysis.isNoise || noiseAnalysis.confidence < 0.6;
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

  // MIRA State - for cost optimization
  miraState: MIRAState;
  isResting: boolean;
  restingTranscript: string[]; // Transcripts collected during resting mode
  activateMira: () => void;
  deactivateMira: () => void;

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

  // Phone Call Detection
  phoneCallState: PhoneCallState;
  droppedCalls: Array<{ id: string; timestamp: Date; callerInfo?: string }>;
  acknowledgeDroppedCall: (id: string) => void;

  // Reminders
  reminders: ReminderType[];
  pendingNotifications: ReminderNotification[];
  createReminder: (title: string, dueDate: Date, priority?: string, description?: string) => Promise<boolean>;
  dismissNotification: (id: string) => void;
  refreshReminders: () => Promise<void>;
  reminderJustCreated: boolean; // Flag to trigger auto-open of ReminderBar
  clearReminderCreatedFlag: () => void;

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

// Helper to parse JWT token and extract user info
function parseTokenPayload(token: string): { id: string; name: string; email: string } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    
    // Check if token is expired
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.log('[MIRA] Token expired');
      return null;
    }
    
    if (payload.userId && payload.email && payload.name) {
      return { id: payload.userId, email: payload.email, name: payload.name };
    }
    return null;
  } catch {
    return null;
  }
}

// Initialize auth state from localStorage synchronously
function getInitialAuthState(): { isAuthenticated: boolean; user: { id: string; name: string; email: string } | null } {
  if (typeof window === 'undefined') {
    return { isAuthenticated: false, user: null };
  }
  
  const token = localStorage.getItem('mira_token');
  if (!token) {
    return { isAuthenticated: false, user: null };
  }
  
  const user = parseTokenPayload(token);
  if (user) {
    console.log('[MIRA] Restored auth state from token:', user.email);
    return { isAuthenticated: true, user };
  }
  
  // Invalid token - remove it
  localStorage.removeItem('mira_token');
  return { isAuthenticated: false, user: null };
}

export function MIRAProvider({ children }: { children: React.ReactNode }) {
  // Auth state - initialize from localStorage for immediate persistence
  const [authState] = useState(() => getInitialAuthState());
  const [isAuthenticated, setIsAuthenticated] = useState(authState.isAuthenticated);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(authState.user);

  // Conversation state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Conversation history context for AI (loaded from DB)
  const conversationHistoryRef = useRef<Array<{ role: string; content: string; timestamp: Date }>>([]);
  const historyLoadedRef = useRef(false);

  // Proactive mode
  // Auto-initiate is always enabled - no option to disable
  const [enableProactive] = useState(true);
  const setEnableProactive = useCallback(() => {
    // No-op: auto-initiate cannot be disabled
    console.log('[MIRA] Auto-initiate is always enabled');
  }, []);

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

  // Phone Call Detection state
  const [phoneCallState, setPhoneCallState] = useState<PhoneCallState>({
    isRinging: false,
    isOnCall: false,
    ringCount: 0,
  });
  const [droppedCalls, setDroppedCalls] = useState<Array<{ id: string; timestamp: Date; callerInfo?: string }>>([]);
  const currentCallIdRef = useRef<string | null>(null);
  const phoneDetectorStartedRef = useRef(false);

  // Reminders state
  const [reminders, setReminders] = useState<ReminderType[]>([]);
  const [pendingNotifications, setPendingNotifications] = useState<ReminderNotification[]>([]);
  const [reminderJustCreated, setReminderJustCreated] = useState(false);
  const reminderTrackerStartedRef = useRef(false);
  const speakReminderRef = useRef<((text: string) => void) | null>(null);
  const isVoiceConnectedRef = useRef(false);
  const savePersonRef = useRef<((name: string, speaker: any) => void) | null>(null);
  const deactivateMiraRef = useRef<(() => void) | null>(null);
  
  // Track reminders without timeline to ask about later
  const pendingTimelineQuestionsRef = useRef<Array<{ id: string; title: string; isDirectRequest: boolean; createdAt: number }>>([]);
  const timelineQuestionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // === MIRA STATE MANAGEMENT (Cost Optimization) ===
  // Always start in active mode - auto-initiate is always on
  const [miraState, setMiraState] = useState<MIRAState>('active');
  const [restingTranscript, setRestingTranscript] = useState<string[]>([]);
  const restingSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const webSpeechRecognitionRef = useRef<any>(null);
  const wakeWordConfirmationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [pendingWakeWordConfirmation, setPendingWakeWordConfirmation] = useState<string | null>(null);
  const lastActiveTimeRef = useRef<number>(Date.now());
  // Silence timeout - 10 seconds to both visual resting AND disconnect
  // Reconnection is optimized to be instant when wake word detected
  const SILENCE_TIMEOUT_MS = 10000; // 10 seconds of silence before going to resting

  // Computed state
  const isResting = miraState === 'resting';

  // Clear reminder created flag
  const clearReminderCreatedFlag = useCallback(() => {
    setReminderJustCreated(false);
  }, []);

  // Update datetime every minute
  useEffect(() => {
    const interval = setInterval(() => setDateTime(getCurrentDateTime()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch reminders from API
  const refreshReminders = useCallback(async () => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return;
      
      const response = await fetch('/api/reminders', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setReminders(data.reminders || []);
        
        // Update tracker
        const tracker = getReminderTracker();
        tracker.updateReminders(data.reminders || []);
      }
    } catch (error) {
      console.error('[Reminders] Failed to fetch:', error);
    }
  }, []);

  // Create reminder
  const createReminder = useCallback(async (
    title: string,
    dueDate: Date,
    priority: string = 'medium',
    description?: string
  ): Promise<boolean> => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return false;
      
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          dueDate: dueDate.toISOString(),
          priority,
          description,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // IMMEDIATELY add to tracker for real-time notifications
        if (data.reminder) {
          const tracker = getReminderTracker();
          tracker.addReminder(data.reminder);
        }
        
        await refreshReminders();
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Reminders] Failed to create:', error);
      return false;
    }
  }, [refreshReminders]);

  // Dismiss notification
  const dismissNotification = useCallback((id: string) => {
    setPendingNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // === MIRA STATE FUNCTIONS ===
  
  // Play state transition sounds
  const playStateSound = useCallback((state: 'active' | 'resting') => {
    if (typeof window === 'undefined') return;
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      if (state === 'active') {
        // Activation sound: ascending pleasant tone
        oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.15);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.25);
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
      } else {
        // Resting sound: descending soft tone  
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(300, audioContext.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.35);
      }
    } catch (e) {
      console.log('[Sound] Failed to play state sound:', e);
    }
  }, []);

  // Track if this is a quick reconnect from resting state (for faster wake-up)
  const isQuickReconnectRef = useRef<boolean>(false);
  
  // Ref to store activateMira function for use in transcription callback
  const activateMiraRef = useRef<(text?: string) => void>(() => {});
  
  // Ref to store processRestingTranscript for use in transcription callback
  const processRestingTranscriptRef = useRef<(text: string) => void>(() => {});
  
  // Ref to store queueSave for use in processRestingTranscript
  const queueSaveRef = useRef<((type: 'transcript' | 'conversation' | 'person', data: any) => void) | null>(null);

  // Process resting transcript for passive task detection AND save to DB
  // DEFINED FIRST to avoid circular dependency
  const processRestingTranscript = useCallback((transcript: string) => {
    // Check for tasks/reminders even in resting mode
    const taskResult = detectTasks(transcript);
    
    for (const task of taskResult.tasks) {
      if (shouldAutoCreateReminder(task)) {
        console.log('[Resting] Auto-creating reminder from passive detection:', task.title);
        // Will implement this through autoCreateReminderFromTask
      }
    }
    
    // Save resting transcript to DB for future context
    if (queueSaveRef.current && transcript.trim()) {
      const timestamp = new Date().toISOString();
      queueSaveRef.current('transcript', {
        sessionId: sessionIdRef.current,
        content: transcript,
        speakerType: 'user',
        speakerName: undefined,
        timestamp,
        isRestingMode: true, // Mark this as captured during resting mode
      });
      console.log('[Resting] Saved ambient transcript to DB:', transcript.substring(0, 50));
    }
  }, []);

  // Start real-time wake word detection using Web Speech API (lightweight, no API calls)
  // This is much more efficient than sending audio samples to Whisper
  const startRestingSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.log('[Resting] Web Speech API not supported');
      return;
    }
    
    // Stop any existing recognition
    if (webSpeechRecognitionRef.current) {
      try { webSpeechRecognitionRef.current.stop(); } catch {}
    }
    
    console.log('[Resting] Starting Web Speech API for real-time wake word detection');
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // Get results as user speaks for faster wake word detection
    recognition.lang = 'en-IN'; // Support Hinglish
    recognition.maxAlternatives = 3; // Get multiple alternatives for better wake word matching
    
    recognition.onresult = (event: any) => {
      // Check ALL results, not just the last one
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;
        
        // Check for wake word on BOTH interim and final results for instant response
        const wakeResult = detectWakeWord(transcript);
        
        if (wakeResult.detected) {
          // High confidence on interim - activate immediately
          if (wakeResult.confidence >= 0.8) {
            console.log('[Resting] Wake word detected!', isFinal ? '(final)' : '(interim)', 
              'Confidence:', wakeResult.confidence, 'Text:', transcript);
            activateMiraRef.current(transcript);
            return;
          }
          
          // Medium confidence on final - still activate
          if (isFinal && wakeResult.confidence >= 0.5) {
            console.log('[Resting] Wake word detected (final)! Confidence:', wakeResult.confidence);
            activateMiraRef.current(transcript);
            return;
          }
        }
        
        // Only process final results for passive task detection (not wake word)
        if (isFinal && !wakeResult.detected) {
          console.log('[Resting] Final transcript (no wake word):', transcript.substring(0, 50));
          setRestingTranscript(prev => [...prev.slice(-50), transcript]);
          processRestingTranscriptRef.current(transcript);
        }
      }
    };
    
    recognition.onerror = (event: any) => {
      // Ignore common non-fatal errors
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      console.log('[Resting] Speech recognition error:', event.error);
      // Restart on recoverable errors
      setTimeout(() => {
        if (miraState === 'resting') {
          startRestingSpeechRecognition();
        }
      }, 1000);
    };
    
    recognition.onend = () => {
      console.log('[Resting] Speech recognition ended');
      // Auto-restart if still in resting mode
      if (miraState === 'resting') {
        setTimeout(() => startRestingSpeechRecognition(), 100);
      }
    };
    
    try {
      recognition.start();
      webSpeechRecognitionRef.current = recognition;
      console.log('[Resting] Web Speech recognition started (real-time, lightweight)');
    } catch (e) {
      console.error('[Resting] Failed to start speech recognition:', e);
    }
  }, [miraState]);
  
  // Keep processRestingTranscriptRef updated
  useEffect(() => {
    processRestingTranscriptRef.current = processRestingTranscript;
  }, [processRestingTranscript]);

  // Stop resting speech recognition (Web Speech API)
  const stopRestingSpeechRecognition = useCallback(() => {
    // Stop Web Speech recognition
    if (webSpeechRecognitionRef.current) {
      try {
        webSpeechRecognitionRef.current.stop();
        webSpeechRecognitionRef.current = null;
      } catch {}
    }
    
    console.log('[Resting] Speech recognition stopped');
  }, []);

  // Activate MIRA (go from resting to active) - fast reconnection
  const activateMira = useCallback((triggerText?: string) => {
    console.log('[MIRA] Activating from resting mode - enabling QUICK RECONNECT');
    
    // Stop resting speech recognition immediately
    stopRestingSpeechRecognition();
    
    // Play activation sound
    playStateSound('active');
    
    // Mark this as a quick reconnect for faster session creation
    isQuickReconnectRef.current = true;
    
    // Update state - this triggers reconnection via useEffect
    setMiraState('active');
    lastActiveTimeRef.current = Date.now();
    
    // Clear any pending wake word confirmation
    setPendingWakeWordConfirmation(null);
    if (wakeWordConfirmationTimerRef.current) {
      clearTimeout(wakeWordConfirmationTimerRef.current);
    }
    
    // The useEffect watching miraState will trigger connectRealtime()
    // which handles the fast reconnection
    
  }, [stopRestingSpeechRecognition, playStateSound]);
  
  // Keep activateMiraRef updated for use in transcription callbacks
  useEffect(() => {
    activateMiraRef.current = activateMira;
  }, [activateMira]);

  // Deactivate MIRA (go from active to resting)
  const deactivateMira = useCallback(() => {
    console.log('[MIRA] Going to resting mode');
    
    // Play resting sound
    playStateSound('resting');
    
    // Update state
    setMiraState('resting');
    
    // Clear silence timer
    if (restingSilenceTimerRef.current) {
      clearTimeout(restingSilenceTimerRef.current);
      restingSilenceTimerRef.current = null;
    }
    
    // The actual OpenAI disconnection will be handled by a useEffect watching miraState
    // Start resting speech recognition
    setTimeout(() => startRestingSpeechRecognition(), 500);
    
  }, [playStateSound, startRestingSpeechRecognition]);

  // Keep deactivateMiraRef updated for use in handleTranscript goodbye detection
  useEffect(() => {
    deactivateMiraRef.current = deactivateMira;
  }, [deactivateMira]);

  // Reset silence timer (called on any activity)
  const resetSilenceTimer = useCallback(() => {
    lastActiveTimeRef.current = Date.now();
    
    if (restingSilenceTimerRef.current) {
      clearTimeout(restingSilenceTimerRef.current);
    }
    
    // Only set timer if in active mode
    if (miraState === 'active' || miraState === 'listening') {
      restingSilenceTimerRef.current = setTimeout(() => {
        console.log('[MIRA] Silence timeout - going to resting mode');
        deactivateMira();
      }, SILENCE_TIMEOUT_MS);
    }
  }, [miraState, deactivateMira]);

  // Confirm wake word (when user says yes after uncertain detection)
  const confirmWakeWord = useCallback(() => {
    if (pendingWakeWordConfirmation) {
      activateMira(pendingWakeWordConfirmation);
    }
  }, [pendingWakeWordConfirmation, activateMira]);

  // Deny wake word
  const denyWakeWord = useCallback(() => {
    setPendingWakeWordConfirmation(null);
    if (wakeWordConfirmationTimerRef.current) {
      clearTimeout(wakeWordConfirmationTimerRef.current);
    }
  }, []);

  // Acknowledge dropped call
  const acknowledgeDroppedCall = useCallback((id: string) => {
    setDroppedCalls(prev => prev.filter(c => c.id !== id));
  }, []);

  // Handle phone call events
  const handlePhoneCallEvent = useCallback(async (event: PhoneCallEvent) => {
    console.log('[Phone] Call event:', event);
    
    const token = localStorage.getItem('mira_token');
    if (!token) return;
    
    if (event.type === 'ringing') {
      setPhoneCallState(prev => ({ ...prev, isRinging: true, isOnCall: false }));
      
      // Log call to database
      try {
        const response = await fetch('/api/phone-calls', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: 'ringing' }),
        });
        
        if (response.ok) {
          const data = await response.json();
          currentCallIdRef.current = data.callId;
        }
      } catch (error) {
        console.error('[Phone] Failed to log call:', error);
      }
      
      // Add MIRA message about phone ringing
      const phoneMessage: Message = {
        id: `phone_${Date.now()}`,
        role: 'system',
        content: '[PHONE_RINGING] I hear your phone ringing! Let me know if you need me to pause.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, phoneMessage]);
      
    } else if (event.type === 'answered') {
      setPhoneCallState(prev => ({ ...prev, isRinging: false, isOnCall: true, callStartTime: new Date() }));
      
      // Update call status in database
      if (currentCallIdRef.current) {
        try {
          await fetch('/api/phone-calls', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              id: currentCallIdRef.current,
              status: 'answered',
            }),
          });
        } catch (error) {
          console.error('[Phone] Failed to update call:', error);
        }
      }
      
    } else if (event.type === 'ended') {
      const wasOnCall = phoneCallState.isOnCall;
      setPhoneCallState({ isRinging: false, isOnCall: false, ringCount: 0 });
      
      // Update call and ask about conversation
      if (currentCallIdRef.current) {
        try {
          await fetch('/api/phone-calls', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              id: currentCallIdRef.current,
              status: 'ended',
              duration: event.duration,
              conversationHeard: false,
            }),
          });
        } catch (error) {
          console.error('[Phone] Failed to update call:', error);
        }
        
        // Ask about the call if MIRA couldn't hear it
        if (wasOnCall) {
          const askMessage: Message = {
            id: `ask_call_${Date.now()}`,
            role: 'system',
            content: `[PHONE_CALL_ENDED] I noticed you just finished a phone call${event.duration ? ` (about ${Math.ceil(event.duration / 60)} minutes)` : ''}. I couldn't hear the conversation - would you like to tell me about it so I can remember any important details?`,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, askMessage]);
        }
        
        currentCallIdRef.current = null;
      }
      
    } else if (event.type === 'dropped') {
      setPhoneCallState({ isRinging: false, isOnCall: false, ringCount: 0 });
      
      // Update call and create follow-up
      if (currentCallIdRef.current) {
        try {
          await fetch('/api/phone-calls', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              id: currentCallIdRef.current,
              status: 'dropped',
              createFollowUp: true,
            }),
          });
          
          // Add to dropped calls list
          setDroppedCalls(prev => [...prev, {
            id: currentCallIdRef.current!,
            timestamp: new Date(),
          }]);
          
          // Notify user
          const droppedMessage: Message = {
            id: `dropped_${Date.now()}`,
            role: 'system',
            content: '[PHONE_CALL_DROPPED] Your call appears to have been dropped or missed. I\'ve created a reminder to follow up in 30 minutes.',
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, droppedMessage]);
          
          // Refresh reminders to show the new follow-up
          refreshReminders();
          
        } catch (error) {
          console.error('[Phone] Failed to update dropped call:', error);
        }
        
        currentCallIdRef.current = null;
      }
    }
  }, [phoneCallState.isOnCall, refreshReminders]);

  // Handle reminder notifications
  const handleReminderNotification = useCallback((notification: ReminderNotification) => {
    console.log('[Reminder] Notification:', notification);
    
    // Add to pending notifications (avoid duplicates by base reminder ID for overdue)
    const baseId = notification.reminder._id;
    setPendingNotifications(prev => {
      // For overdue, replace the existing notification
      if (notification.urgency === 'overdue') {
        const filtered = prev.filter(n => !n.id.startsWith(baseId));
        return [...filtered, notification];
      }
      // For others, avoid duplicates
      if (prev.some(n => n.id === notification.id)) return prev;
      return [...prev, notification];
    });
    
    // Also add a message to the chat
    const urgencyEmoji = notification.urgency === 'overdue' ? '🚨' :
                         notification.urgency === 'urgent' ? '⚠️' : '⏰';
    
    const reminderMessage: Message = {
      id: `reminder_${notification.id}`,
      role: 'system',
      content: `[REMINDER] ${urgencyEmoji} "${notification.title}" ${notification.message}`,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, reminderMessage]);
    
    // CREATE HUMAN-LIKE SPOKEN MESSAGE
    let spokenMessage = '';
    if (notification.urgency === 'overdue') {
      // Vary the overdue messages to sound more natural
      const overdueVariations = [
        `Hey, just a reminder - ${notification.title} ${notification.message}. Would you like me to mark it as done?`,
        `Quick heads up, ${notification.title} ${notification.message}. Should I mark this one complete?`,
        `Don't forget about ${notification.title}, it ${notification.message}. Let me know when you're done with it.`,
        `Gentle nudge - ${notification.title} is still pending. It ${notification.message}.`,
      ];
      spokenMessage = overdueVariations[Math.floor(Math.random() * overdueVariations.length)];
    } else {
      // Urgent upcoming reminders
      const urgentVariations = [
        `Heads up! ${notification.title} ${notification.message}.`,
        `Hey, ${notification.title} ${notification.message}. Just wanted to let you know.`,
        `Quick reminder - ${notification.title} ${notification.message}.`,
      ];
      spokenMessage = urgentVariations[Math.floor(Math.random() * urgentVariations.length)];
    }
    
    if (speakReminderRef.current && isVoiceConnectedRef.current) {
      console.log('[Reminder] Making MIRA speak via realtime:', spokenMessage);
      speakReminderRef.current(spokenMessage);
    } else {
      // Fallback to browser speech synthesis when MIRA voice not connected
      console.log('[Reminder] Using browser TTS fallback:', spokenMessage);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const speakWithFemaleVoice = () => {
          const utterance = new SpeechSynthesisUtterance(spokenMessage);
          utterance.rate = 1.0;
          utterance.pitch = 1.1; // Slightly higher pitch for more feminine sound
          utterance.volume = 1.0;
          
          // Try to use a female voice - search more thoroughly
          const voices = window.speechSynthesis.getVoices();
          console.log('[TTS] Available voices:', voices.length);
          
          // Priority list of female voices (macOS/iOS, Windows, Chrome)
          const femaleVoiceNames = [
            'Samantha', 'Karen', 'Victoria', 'Moira', 'Fiona', 'Tessa', 'Veena', // macOS/iOS
            'Microsoft Zira', 'Microsoft Eva', 'Microsoft Jenny', 'Microsoft Aria', // Windows
            'Google UK English Female', 'Google US English Female', // Chrome
          ];
          
          let femaleVoice = voices.find(v => 
            femaleVoiceNames.some(name => v.name.includes(name))
          );
          
          // Fallback: search for any voice with "female" in the name
          if (!femaleVoice) {
            femaleVoice = voices.find(v => v.name.toLowerCase().includes('female'));
          }
          
          // Fallback: any English voice that's not explicitly male
          if (!femaleVoice) {
            femaleVoice = voices.find(v => 
              v.lang.startsWith('en') && 
              !v.name.toLowerCase().includes('male') &&
              !v.name.includes('David') &&
              !v.name.includes('James') &&
              !v.name.includes('Daniel')
            );
          }
          
          if (femaleVoice) {
            console.log('[TTS] Using voice:', femaleVoice.name);
            utterance.voice = femaleVoice;
          }
          
          window.speechSynthesis.speak(utterance);
        };
        
        // Voices might not be loaded yet - handle async loading
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          speakWithFemaleVoice();
        } else {
          // Wait for voices to load
          window.speechSynthesis.onvoiceschanged = () => {
            speakWithFemaleVoice();
          };
        }
      }
    }
  }, []);

  // Initialize phone call detector
  useEffect(() => {
    if (!isAuthenticated || phoneDetectorStartedRef.current) return;
    
    // Phone detection requires audio stream - will be initialized when voice is connected
    // The detector will listen for phone-like sounds in the environment
    phoneDetectorStartedRef.current = true;
    console.log('[Phone] Detector ready, waiting for audio stream');
    
    return () => {
      phoneDetectorStartedRef.current = false;
      const detector = getPhoneCallDetector();
      detector.stop();
    };
  }, [isAuthenticated]);

  // Initialize reminder tracker
  useEffect(() => {
    if (!isAuthenticated || reminderTrackerStartedRef.current) return;
    
    const tracker = getReminderTracker();
    tracker.start(handleReminderNotification);
    reminderTrackerStartedRef.current = true;
    
    // Initial fetch
    refreshReminders();
    
    // Refresh reminders more frequently (every 30 seconds for real-time feel)
    const interval = setInterval(refreshReminders, 30000);
    
    return () => {
      clearInterval(interval);
      tracker.stop();
      reminderTrackerStartedRef.current = false;
    };
  }, [isAuthenticated, handleReminderNotification, refreshReminders]);

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
  
  // Conversation ID for persistent storage
  const conversationIdRef = useRef<string | null>(null);
  
  // Auto-save queue for reliable saving
  const saveQueueRef = useRef<Array<{ type: 'transcript' | 'conversation' | 'person'; data: any }>>([]);
  const isSavingRef = useRef(false);
  
  // Process save queue - ensures saves happen in order and don't fail silently
  const processSaveQueue = useCallback(async () => {
    if (isSavingRef.current || saveQueueRef.current.length === 0) return;
    
    isSavingRef.current = true;
    const token = localStorage.getItem('mira_token');
    if (!token) {
      console.warn('[AutoSave] No token available, queue has', saveQueueRef.current.length, 'pending items');
      isSavingRef.current = false;
      // Schedule retry in 2 seconds
      setTimeout(() => {
        if (saveQueueRef.current.length > 0) {
          processSaveQueue();
        }
      }, 2000);
      return;
    }
    
    while (saveQueueRef.current.length > 0) {
      const item = saveQueueRef.current[0];
      let success = false;
      let retries = 3;
      
      while (retries > 0 && !success) {
        try {
          if (item.type === 'transcript') {
            const response = await fetch('/api/transcripts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify(item.data),
            });
            success = response.ok;
            if (!success) console.error('[AutoSave] Transcript save failed:', await response.text());
          } else if (item.type === 'conversation') {
            const response = await fetch('/api/conversations/sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify(item.data),
            });
            if (response.ok) {
              const result = await response.json();
              if (result.conversationId) {
                conversationIdRef.current = result.conversationId;
              }
              success = true;
            } else {
              console.error('[AutoSave] Conversation save failed:', await response.text());
            }
          } else if (item.type === 'person') {
            const response = await fetch('/api/people', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify(item.data),
            });
            success = response.ok;
            if (response.ok) {
              const result = await response.json();
              console.log('[AutoSave] Person saved:', result);
            } else {
              console.error('[AutoSave] Person save failed:', await response.text());
            }
          }
        } catch (err) {
          console.error('[AutoSave] Save error, retrying...', err);
        }
        
        if (!success) {
          retries--;
          if (retries > 0) await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
      }
      
      if (!success) {
        console.error('[AutoSave] Failed after 3 retries:', item);
      }
      
      // Remove from queue
      saveQueueRef.current.shift();
    }
    
    isSavingRef.current = false;
  }, []);
  
  // Queue a save operation
  const queueSave = useCallback((type: 'transcript' | 'conversation' | 'person', data: any) => {
    saveQueueRef.current.push({ type, data });
    processSaveQueue();
  }, [processSaveQueue]);
  
  // Keep queueSaveRef updated for use in processRestingTranscript
  useEffect(() => {
    queueSaveRef.current = queueSave;
  }, [queueSave]);
  
  // Save transcript entry to database with guaranteed delivery
  const saveTranscript = useCallback(async (
    content: string,
    speakerType: 'user' | 'mira' | 'other',
    speakerName?: string
  ) => {
    if (!content.trim()) return;
    
    const timestamp = new Date().toISOString();
    
    // Queue transcript save
    queueSave('transcript', {
      sessionId: sessionIdRef.current,
      content,
      speakerType,
      speakerName: speakerName || (speakerType === 'mira' ? 'MIRA' : undefined),
      timestamp,
    });
    
    // Also sync to conversation
    queueSave('conversation', {
      sessionId: sessionIdRef.current,
      conversationId: conversationIdRef.current,
      message: {
        role: speakerType === 'mira' ? 'mira' : speakerType === 'user' ? 'user' : 'system',
        content,
        timestamp,
        speakerName,
      },
    });
    
    console.log('[AutoSave] Queued save for:', speakerType, content.slice(0, 50));
  }, [queueSave]);
  
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

  // Ask about timeline for reminders without due date
  const askAboutReminderTimeline = useCallback((title: string, isDirectRequest: boolean) => {
    const question = isDirectRequest
      ? `I've noted "${title}" - when would you like to be reminded about this?`
      : `I noticed you mentioned "${title}". Would you like me to set a specific time for this reminder?`;
    
    const timelineMessage: Message = {
      id: `timeline_question_${Date.now()}`,
      role: 'system',
      content: `[TIMELINE_QUESTION] ${question}`,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, timelineMessage]);
    
    console.log('[Reminder] Asking about timeline for:', title);
  }, []);

  // Check and ask about pending timeline questions after silence
  const checkPendingTimelineQuestions = useCallback(() => {
    if (pendingTimelineQuestionsRef.current.length === 0) return;
    
    // Get the oldest pending question that's at least 3 seconds old
    const now = Date.now();
    const ready = pendingTimelineQuestionsRef.current.filter(q => now - q.createdAt >= 3000);
    
    if (ready.length > 0) {
      const question = ready[0];
      askAboutReminderTimeline(question.title, question.isDirectRequest);
      
      // Remove from pending
      pendingTimelineQuestionsRef.current = pendingTimelineQuestionsRef.current.filter(q => q.id !== question.id);
    }
  }, [askAboutReminderTimeline]);

  // Auto-create reminder from detected task
  const autoCreateReminderFromTask = useCallback(async (task: DetectedTask) => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) {
        console.log('[TaskDetection] No token, skipping reminder creation');
        return;
      }
      
      // Check if task has a specific due date or just defaulting
      const hasSpecificTime = !!task.dueDate;
      const dueDate = task.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000); // Default to tomorrow
      
      console.log('[TaskDetection] Creating reminder:', {
        title: task.title,
        dueDate: dueDate.toISOString(),
        hasSpecificTime,
        priority: task.priority,
        source: task.source,
        confidence: task.confidence,
      });
      
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: task.title,
          description: task.description || `Detected from: "${task.originalText.slice(0, 100)}"`,
          dueDate: dueDate.toISOString(),
          priority: task.priority,
          source: 'detected',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[TaskDetection] ✅ Successfully created reminder:', task.title);
        
        // Set flag to trigger auto-open of ReminderBar
        setReminderJustCreated(true);
        
        // IMMEDIATELY add to tracker for real-time notifications
        if (data.reminder) {
          const tracker = getReminderTracker();
          tracker.addReminder(data.reminder);
        }
        
        // Refresh reminders list
        await refreshReminders();
        
        // === HANDLE TIMELINE QUESTIONS ===
        if (!hasSpecificTime && task.isDirectedAtMira) {
          // For DIRECT requests without time - ask IMMEDIATELY
          console.log('[Reminder] No specific time given for direct request, asking immediately');
          askAboutReminderTimeline(task.title, true);
        } else if (!hasSpecificTime && !task.isDirectedAtMira) {
          // For PASSIVE/detected tasks without time - queue for later (after silence)
          console.log('[Reminder] No specific time for detected task, queueing question');
          pendingTimelineQuestionsRef.current.push({
            id: data.reminder?._id || `temp_${Date.now()}`,
            title: task.title,
            isDirectRequest: false,
            createdAt: Date.now(),
          });
          
          // Set timer to check after 5 seconds of silence
          if (timelineQuestionTimerRef.current) {
            clearTimeout(timelineQuestionTimerRef.current);
          }
          timelineQuestionTimerRef.current = setTimeout(() => {
            checkPendingTimelineQuestions();
          }, 5000);
        }
        
        // Add confirmation message if directed at MIRA
        if (task.isDirectedAtMira) {
          const timeInfo = hasSpecificTime 
            ? ` for ${task.dueDate!.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
            : ' (defaulted to tomorrow)';
          const confirmMessage: Message = {
            id: `reminder_confirm_${Date.now()}`,
            role: 'system',
            content: `[REMINDER_CREATED] ✓ I've added a reminder: "${task.title}"${timeInfo}`,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, confirmMessage]);
        }
      } else {
        const errorText = await response.text();
        console.error('[TaskDetection] ❌ Failed to create reminder:', response.status, errorText);
      }
    } catch (error) {
      console.error('[TaskDetection] ❌ Error creating reminder:', error);
    }
  }, [refreshReminders, askAboutReminderTimeline, checkPendingTimelineQuestions]);

  // Handle transcript from WebRTC - with smart detection and noise filtering
  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) return;
    
    console.log('[MIRA] Raw transcript:', text);
    
    // === NOISE FILTERING ===
    // Analyze transcript for noise (music, TV, ambient sounds, gibberish)
    const noiseAnalysis = analyzeForNoise(text);
    if (noiseAnalysis.isNoise && noiseAnalysis.confidence >= 0.6) {
      console.log('[MIRA] Detected noise (type:', noiseAnalysis.noiseType, 'confidence:', noiseAnalysis.confidence, ') - ignoring');
      // Don't reset silence timer for noise - this counts as inactivity
      return;
    }
    
    // === CHECK FOR GOODBYE/REST COMMANDS ===
    // These commands should immediately put MIRA into resting state with a brief acknowledgement
    const lowerTextForGoodbye = text.toLowerCase().trim();
    const goodbyePatterns = [
      /\b(?:bye|goodbye|good\s*bye)\s*(?:mira|mirror)?\b/i,
      /\b(?:stop\s+talking|stop\s+listening|be\s+quiet|shut\s+up)\b/i,
      /\b(?:talk\s+to\s+you\s+later|ttyl|later|see\s+you|see\s+ya)\b/i,
      /\b(?:go\s+to\s+(?:sleep|rest)|take\s+a\s+(?:break|rest))\s*(?:mira|mirror)?\b/i,
      /\b(?:mira|mirror)\s*(?:,?\s*)?(?:go\s+to\s+(?:sleep|rest)|rest|sleep)\b/i,
      /\b(?:that'?s?\s+(?:all|it)|i'?m\s+done|we'?re\s+done)\s*(?:mira|mirror|for\s+now)?\b/i,
      /\b(?:ok|okay)\s*(?:mira|mirror)?\s*(?:,?\s*)?(?:that'?s?\s+(?:all|it|enough)|i'?m\s+done)\b/i,
      /\b(?:thanks?\s+)?(?:mira|mirror)\s*(?:,?\s*)?(?:bye|goodbye|later|that'?s?\s+all)\b/i,
      /\b(?:i\s+don'?t\s+need\s+you|leave\s+me\s+alone)\b/i,
    ];
    
    const isGoodbyeCommand = goodbyePatterns.some(p => p.test(lowerTextForGoodbye));
    
    if (isGoodbyeCommand && miraState === 'active') {
      console.log('[MIRA] Goodbye command detected:', text);
      
      // Save this to transcript
      saveTranscript(text, 'user');
      
      // Pick a random goodbye acknowledgement
      const goodbyeResponses = [
        "Okay, I'll be here when you need me!",
        "Got it! Just say my name when you're ready.",
        "Sure thing! Call me whenever.",
        "Alright, resting now. Wake me anytime!",
        "Bye for now! I'll be listening for you.",
      ];
      const randomGoodbye = goodbyeResponses[Math.floor(Math.random() * goodbyeResponses.length)];
      
      // Say a quick goodbye if connected
      if (speakReminderRef.current && isVoiceConnectedRef.current) {
        speakReminderRef.current(randomGoodbye);
        // Give time for the acknowledgement to play before going to resting
        setTimeout(() => {
          deactivateMiraRef.current?.();
        }, 2000);
      } else {
        // If not connected, just go to resting immediately
        deactivateMiraRef.current?.();
      }
      
      return; // Don't process further
    }
    
    // === MEANINGFUL SPEECH DETECTED - RESET SILENCE TIMER ===
    // Only meaningful speech (not noise) resets the timer
    resetSilenceTimer();
    
    // Update last speech time
    lastSpeechTimeRef.current = Date.now();
    
    // === ALWAYS save transcript to database for memory ===
    // This captures everything the user says, regardless of whether it's directed at MIRA
    saveTranscript(text, 'user');
    
    // Process through speaker detection
    if (speakerManagerRef.current) {
      speakerManagerRef.current.processSpeech(text, undefined, true);
    }
    
    // === CHECK FOR REMINDER COMPLETION COMMANDS ===
    const completionPatterns = [
      /(?:mark|mark it|mark that|mark this|that's?|it'?s?|i'?m)\s*(?:as\s+)?(?:done|complete|completed|finished)/i,
      /(?:i'?ve|i have|already)\s+(?:done|finished|completed)\s+(?:it|that|this)?/i,
      /(?:done|finished|completed)\s+(?:with\s+)?(?:it|that|this|the reminder)?/i,
      /(?:yes|yeah|yep|yup),?\s*(?:i'?m\s+)?(?:done|finished)/i,
    ];
    
    const lowerText = text.toLowerCase();
    const isCompletionCommand = completionPatterns.some(p => p.test(lowerText));
    
    if (isCompletionCommand && pendingNotifications.length > 0) {
      // Get the most recent overdue reminder
      const overdueReminder = pendingNotifications.find(n => n.urgency === 'overdue');
      if (overdueReminder) {
        console.log('[Reminder] User marked reminder as done via voice:', overdueReminder.title);
        
        // Complete the reminder via API - NOW PROPERLY AWAITED
        (async () => {
          try {
            const token = localStorage.getItem('mira_token');
            const response = await fetch('/api/reminders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ id: overdueReminder.reminder._id, status: 'completed' }),
            });
            
            if (response.ok) {
              console.log('[Reminder] ✓ Successfully marked as completed');
              
              // IMMEDIATELY update the reminder tracker
              const tracker = getReminderTracker();
              tracker.completeReminder(overdueReminder.reminder._id);
              
              // Remove from pending notifications
              setPendingNotifications(prev => prev.filter(n => n.reminder._id !== overdueReminder.reminder._id));
              
              // Refresh reminders list to update UI
              await refreshReminders();
              
              // Confirm via speech
              if (speakReminderRef.current && isVoiceConnectedRef.current) {
                speakReminderRef.current(`Great! I've marked "${overdueReminder.title}" as done.`);
              }
            } else {
              console.error('[Reminder] ❌ Failed to complete reminder:', await response.text());
            }
          } catch (error) {
            console.error('[Reminder] ❌ Error completing reminder:', error);
          }
        })();
        
        return; // Don't process further if this was a completion command
      }
    }
    
    // === SMART TASK DETECTION ===
    const taskResult = detectTasks(text);
    console.log('[TaskDetection] Result:', {
      isDirected: taskResult.isDirectedAtMira,
      shouldRespond: taskResult.shouldRespond,
      conversationType: taskResult.conversationType,
      tasksFound: taskResult.tasks.length,
    });
    
    // Auto-create reminders for high-confidence tasks
    for (const task of taskResult.tasks) {
      if (shouldAutoCreateReminder(task)) {
        console.log('[TaskDetection] Auto-creating reminder for:', task.title);
        autoCreateReminderFromTask(task);
      } else if (task.confidence >= 0.6) {
        // For medium confidence tasks from passive conversation, still log them
        console.log('[TaskDetection] Detected task (not auto-creating):', task.title, 'confidence:', task.confidence);
        
        // Save as a memory/potential task for future context
        queueSave('transcript', {
          sessionId: sessionIdRef.current,
          content: `[DETECTED_TASK] ${task.title} (confidence: ${task.confidence.toFixed(2)}, source: ${task.source})`,
          speakerType: 'user',
          timestamp: new Date().toISOString(),
        });
      }
    }
    
    // Check if user is identifying an unknown speaker
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
        if (savePersonRef.current) {
          savePersonRef.current(identifiedName, speaker);
        }
        setPendingUnknownSpeakers(prev => prev.slice(1));
        break;
      }
    }
    
    // Reset silence timer since there's activity
    checkConversationSilence();
    
    // === DETERMINE IF MIRA SHOULD ADD TO VISIBLE MESSAGES ===
    // Only add to visible message list if directed at MIRA or important event
    if (taskResult.isDirectedAtMira || taskResult.shouldRespond || taskResult.isPhoneCall) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);
    } else if (!taskResult.isPassiveConversation) {
      // For non-passive conversation that's not directly to MIRA,
      // still show it but mark it as background
      const bgMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: `[Background] ${text}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, bgMessage]);
    }
    // Passive conversation (small talk with others) is saved to transcripts but not shown in chat
    
  }, [saveTranscript, checkConversationSilence, pendingUnknownSpeakers, autoCreateReminderFromTask, queueSave, pendingNotifications, refreshReminders]);
  
  // Check if a person with similar name exists
  const checkExistingPerson = useCallback(async (name: string): Promise<{ exists: boolean; person?: any }> => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return { exists: false };
      
      const response = await fetch(`/api/people/check?name=${encodeURIComponent(name)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (response.ok) {
        const result = await response.json();
        return result;
      }
      return { exists: false };
    } catch {
      return { exists: false };
    }
  }, []);
  
  // Save identified person to database with duplicate checking
  const savePersonToDirectory = useCallback(async (
    name: string, 
    conversationContext: string,
    relationship?: string,
    skipDuplicateCheck?: boolean
  ): Promise<{ success: boolean; isExisting: boolean; person?: any }> => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return { success: false, isExisting: false };
      
      // Check for existing person first (unless skipped)
      if (!skipDuplicateCheck) {
        const existing = await checkExistingPerson(name);
        if (existing.exists) {
          // Person exists - update their record with new context
          const response = await fetch('/api/people', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              name,
              conversationContext,
              relationship,
              source: 'voice_detection',
            }),
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log('[People] Updated existing person:', name);
            return { success: true, isExisting: true, person: result.person };
          }
        }
      }
      
      // Use queue save for guaranteed delivery
      queueSave('person', {
        name,
        conversationContext,
        relationship,
        firstMet: new Date().toISOString(),
        source: 'voice_detection',
      });
      
      console.log('[People] Queued save for new person:', name);
      return { success: true, isExisting: false };
    } catch (err) {
      console.error('[People] Error saving person:', err);
      return { success: false, isExisting: false };
    }
  }, [checkExistingPerson, queueSave]);
  
  // Save identified person from speaker detection
  const savePerson = useCallback(async (name: string, speaker: DetectedSpeaker) => {
    const conversationText = speaker.speechSegments.map(s => s.text).join(' ');
    
    const result = await savePersonToDirectory(name, conversationText);
    
    if (result.success) {
      // Update speaker manager
      if (speakerManagerRef.current) {
        speakerManagerRef.current.identifySpeaker(speaker.id, name);
      }
      
      // If person already existed, add a confirmation message
      if (result.isExisting && result.person) {
        const confirmMessage: Message = {
          id: `confirm_${Date.now()}`,
          role: 'system',
          content: `[PERSON_CONFIRMED] ${name} - I've updated their record. I've talked with them before!`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, confirmMessage]);
      }
    }
  }, [savePersonToDirectory]);

  // Store savePerson in ref for use in handleTranscript
  useEffect(() => {
    savePersonRef.current = savePerson;
  }, [savePerson]);

  // Handle AI response from WebRTC
  const handleResponse = useCallback((text: string) => {
    if (!text.trim()) return;
    
    console.log('[MIRA] Response:', text);
    
    // Save MIRA's response to transcript database (background)
    saveTranscript(text, 'mira', 'MIRA');
    
    // === CRITICAL: Parse MIRA's response for task/reminder creation ===
    // When MIRA says she added a reminder, actually create it!
    const extractedTasks = extractTasksFromMiraResponse(text);
    if (extractedTasks.length > 0) {
      console.log('[MIRA Response Parser] Found tasks MIRA mentioned creating:', extractedTasks.map(t => t.title));
      for (const task of extractedTasks) {
        autoCreateReminderFromTask(task);
      }
    }
    
    // Add MIRA message
    const miraMessage: Message = {
      id: `${Date.now()}-response`,
      role: 'mira',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, miraMessage]);
  }, [saveTranscript, autoCreateReminderFromTask]);

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
    speak: speakReminder, // Make MIRA speak reminders aloud
  } = useMIRAEngine({
    voice: 'mira',
    onTranscript: handleTranscript,
    onResponse: handleResponse,
    onError: handleError,
  });

  // Store the speak function in ref so handleReminderNotification can use it
  useEffect(() => {
    speakReminderRef.current = speakReminder;
    isVoiceConnectedRef.current = isConnected;
  }, [speakReminder, isConnected]);

  // === MIRA STATE TRANSITION EFFECTS ===
  
  // Handle state transitions - disconnect on resting to save costs
  // Reconnection is optimized to be fast when wake word detected
  useEffect(() => {
    if (miraState === 'active' || miraState === 'listening' || miraState === 'speaking' || miraState === 'thinking') {
      // Active states - ensure Realtime API is connected
      if (!isConnected) {
        const useQuickReconnect = isQuickReconnectRef.current;
        console.log('[MIRA] State is active, connecting Realtime API', useQuickReconnect ? '(QUICK MODE)' : '');
        
        // Pass quick reconnect flag to connectRealtime for faster session creation
        connectRealtime(useQuickReconnect);
        
        // Reset the flag after using it
        isQuickReconnectRef.current = false;
      }
      // Start silence timer
      resetSilenceTimer();
    } else if (miraState === 'resting') {
      // Resting state - disconnect to save API costs
      if (isConnected) {
        console.log('[MIRA] State is resting, disconnecting Realtime API to save costs');
        disconnectRealtime();
      }
    }
  }, [miraState, isConnected, connectRealtime, disconnectRealtime, resetSilenceTimer]);

  // Reset silence timer when user is talking or MIRA is responding
  useEffect(() => {
    if (isListening || isSpeaking || transcript) {
      resetSilenceTimer();
    }
  }, [isListening, isSpeaking, transcript, resetSilenceTimer]);

  // When MIRA starts speaking, update state
  useEffect(() => {
    if (isSpeaking) {
      setMiraState('speaking');
    } else if (isListening) {
      setMiraState('listening');
    } else if (miraState === 'speaking' || miraState === 'listening') {
      setMiraState('active');
    }
  }, [isSpeaking, isListening, miraState]);

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

  // Load conversation history from database for AI context
  const loadConversationHistory = useCallback(async () => {
    if (historyLoadedRef.current) return;
    
    const token = localStorage.getItem('mira_token');
    if (!token) return;
    
    try {
      console.log('[MIRA] Loading conversation history for context...');
      const response = await fetch('/api/conversations?forContext=true&messageLimit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.contextMessages && data.contextMessages.length > 0) {
          conversationHistoryRef.current = data.contextMessages;
          historyLoadedRef.current = true;
          console.log('[MIRA] ✅ Loaded', data.contextMessages.length, 'messages from conversation history for context');
        } else {
          console.log('[MIRA] No previous conversation history found');
        }
      } else {
        console.error('[MIRA] Failed to load conversation history:', response.status);
      }
    } catch (error) {
      console.error('[MIRA] Error loading conversation history:', error);
    }
  }, []);

  // Auto-start WebRTC after auth (camera disabled by default for privacy)
  // Auto-initiate is ALWAYS on - no option to disable
  const autoStart = useCallback(() => {
    if (!autoStartedRef.current) {
      autoStartedRef.current = true;
      
      // Load conversation history for context
      loadConversationHistory();
      
      // Connect immediately - state is already 'active' by default
      console.log('[MIRA] Auto-starting in active mode (always enabled)');
      connectRealtime();
      
      // Camera is disabled by default for privacy
      // User can manually enable camera when needed
      console.log('[MIRA] Camera disabled by default - user can enable manually');
    }
  }, [connectRealtime, loadConversationHistory]);

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
        console.log('[MIRA] Login successful, storing token for:', user.email);
        localStorage.setItem('mira_token', token);
        setUser(user);
        setIsAuthenticated(true);
        // Process any pending saves now that we have a token
        if (saveQueueRef.current.length > 0) {
          console.log('[MIRA] Flushing', saveQueueRef.current.length, 'pending saves after login');
          processSaveQueue();
        }
        autoStart();
        return true;
      }
      console.log('[MIRA] Login failed, status:', response.status);
      return false;
    } catch (error) {
      console.error('[MIRA] Login error:', error);
      return false;
    }
  }, [autoStart, processSaveQueue]);

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
        // Process any pending saves now that we have a token
        if (saveQueueRef.current.length > 0) {
          console.log('[MIRA] Flushing', saveQueueRef.current.length, 'pending saves after registration');
          processSaveQueue();
        }
        autoStart();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [autoStart, processSaveQueue]);

  const logout = useCallback(() => {
    localStorage.removeItem('mira_token');
    setUser(null);
    setIsAuthenticated(false);
    setMessages([]);
    disconnectRealtime();
  }, [disconnectRealtime]);

  // Check auth on mount - validate session with server
  // Use ref to prevent multiple runs
  const authCheckedRef = useRef(false);
  
  useEffect(() => {
    const checkAuth = async () => {
      // Prevent multiple auth checks
      if (authCheckedRef.current) return;
      authCheckedRef.current = true;
      
      // Only run on client side
      if (typeof window === 'undefined') {
        setIsAuthLoading(false);
        return;
      }
      
      const token = localStorage.getItem('mira_token');
      console.log('[MIRA] Checking auth, token exists:', !!token, 'already authenticated:', isAuthenticated);
      
      if (!token) {
        setIsAuthenticated(false);
        setUser(null);
        setIsAuthLoading(false);
        return;
      }

      // If we already have auth state from initialization, just validate in background
      // and auto-start immediately
      if (isAuthenticated && user) {
        console.log('[MIRA] Already authenticated from token, starting services');
        autoStart();
      }

      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const { user: serverUser } = await response.json();
          console.log('[MIRA] Session validated for:', serverUser.email);
          setUser(serverUser);
          setIsAuthenticated(true);
          // Only call autoStart if we weren't already authenticated
          if (!isAuthenticated) {
            autoStart();
          }
        } else if (response.status === 401) {
          // Only remove token if explicitly unauthorized (invalid/expired token)
          console.log('[MIRA] Token invalid (401), removing');
          localStorage.removeItem('mira_token');
          setIsAuthenticated(false);
          setUser(null);
        } else {
          // Server error (500, 503, etc.) - keep token and current auth state
          console.log('[MIRA] Server error, keeping token, status:', response.status);
          // If we already have auth from token parsing, keep it
          if (!isAuthenticated) {
            const parsedUser = parseTokenPayload(token);
            if (parsedUser) {
              setIsAuthenticated(true);
              setUser(parsedUser);
              autoStart();
            }
          }
        }
      } catch (error) {
        console.error('[MIRA] Session check error (network):', error);
        // Network error - keep token and current auth state
        if (!isAuthenticated) {
          const parsedUser = parseTokenPayload(token);
          if (parsedUser) {
            setIsAuthenticated(true);
            setUser(parsedUser);
            autoStart();
          }
        }
      } finally {
        setIsAuthLoading(false);
      }
    };

    checkAuth();
  }, []); // Empty dependency array - run once on mount

  const value: MIRAContextType = {
    // Auth
    isAuthenticated,
    isAuthLoading,
    user,
    login,
    register,
    logout,

    // MIRA State - cost optimization
    miraState,
    isResting,
    restingTranscript,
    activateMira,
    deactivateMira,

    // Conversation
    messages,
    isLoading,
    sendMessage,
    clearConversation,

    // Voice - Pure WebRTC
    isConnected,
    isMicReady: isConnected,
    isRecording: isListening,
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

    // Phone Call Detection
    phoneCallState,
    droppedCalls,
    acknowledgeDroppedCall,

    // Reminders
    reminders,
    pendingNotifications,
    createReminder,
    dismissNotification,
    refreshReminders,
    reminderJustCreated,
    clearReminderCreatedFlag,

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
