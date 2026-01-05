'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useMediaCapture } from '@/hooks';
import { useRealtime } from '@/hooks/useRealtime';
import { isMobileDevice } from '@/lib/utils/deviceDetection';
// MediaPipe gesture detection disabled due to WASM compatibility issues
// import { useGestureDetection } from '@/lib/gesture/useGestureDetection';
import { 
  GestureType, 
  DetectedGesture, 
  getGesturePrompt,
  isGestureOnCooldown,
  markGestureUsed 
} from '@/lib/gesture/gestureService';

type AgentType = 'mi' | 'ra' | 'mira';

interface Message {
  id: string;
  role: 'user' | 'mi' | 'ra' | 'mira' | 'system';
  content: string;
  timestamp: Date;
  isDebate?: boolean;
  isConsensus?: boolean;
  emotion?: string;
}

interface VisualContext {
  cameraDescription?: string;
  screenDescription?: string;
}

export interface FileAttachment {
  name: string;
  type: string; // MIME type
  size: number;
  data: string; // base64 encoded data
}

interface DateTimeContext {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  dayOfWeek: string;
  timestamp: number;
  timezone: string;
  formattedDateTime: string; // Human readable
}

// MIRA trigger keywords for detecting when user is talking to MIRA
// Including common transcription errors and phonetically similar words
const MIRA_KEYWORDS = [
  // Core names
  'mira', 'mi', 'ra',
  // Common greetings + name
  'hey mira', 'hi mira', 'hello mira', 'ok mira', 'okay mira',
  'hey mi', 'hi mi', 'hey ra', 'hi ra',
  // Phonetically similar / common transcription errors
  'meera', 'mera', 'meira', 'myra', 'miraa', 'mirah',
  'maya', 'maira', 'mara', 'moira', 'mia',
  'miri', 'mire', 'mere', 'miro',
  'meara', 'miara', 'mirra', 'mierra',
  // Hindi transcription variations (romanized)
  'meeraa', 'meraa', 'meerha', 'mirha',
  // With "hey/hi" prefix variations  
  'hey meera', 'hey mera', 'hey myra', 'hi meera', 'hi mera',
  'hey maya', 'hey mia', 'hi maya', 'hi mia',
  // Common speech-to-text errors for "MI"
  'me', 'mee', 'my',
  // Common speech-to-text errors for "RA"  
  'raa', 'rah', 'raw',
  // HINDI DEVANAGARI WAKE WORDS (for Hindi transcriptions)
  'मीरा', 'मिरा', 'मेरा', 'मीर', 'मिर',
  'मी', 'रा', 'मीं', 'री',
  'हे मीरा', 'हाय मीरा', 'अरे मीरा', 'ओके मीरा',
  'हे मी', 'हे रा', 'अरे मी', 'अरे रा',
];

// Fuzzy matching: Calculate simple edit distance (Levenshtein)
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

// Check if a word is phonetically similar to MIRA/MI/RA
function isFuzzyMatch(word: string, target: string, maxDistance: number = 2): boolean {
  if (word.length < 2) return false;
  const distance = levenshteinDistance(word.toLowerCase(), target.toLowerCase());
  // Allow more distance for longer words
  const allowedDistance = target.length <= 3 ? 1 : maxDistance;
  return distance <= allowedDistance;
}

// Get current date/time context
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
      timeZoneName: 'short'
    })
  };
}

// Track if MIRA recently asked a follow-up question (managed externally)
let lastMiraQuestionTime = 0;
let miraAskedFollowUp = false;

// Export functions to update follow-up state
export function setMiraAskedFollowUp(asked: boolean) {
  miraAskedFollowUp = asked;
  if (asked) {
    lastMiraQuestionTime = Date.now();
  }
}

// Check if message is a follow-up response (no wake word needed within 45 seconds of MIRA's question)
function isFollowUpResponse(text: string): boolean {
  const timeSinceQuestion = Date.now() - lastMiraQuestionTime;
  const followUpWindow = 45000; // 45 seconds to respond without wake word
  
  console.log('[FollowUp] Checking follow-up:', {
    miraAskedFollowUp,
    timeSinceQuestion,
    withinWindow: timeSinceQuestion <= followUpWindow
  });
  
  if (!miraAskedFollowUp || timeSinceQuestion > followUpWindow) {
    return false;
  }
  
  const lower = text.toLowerCase().trim();
  
  // Skip if it's clearly addressed to someone else
  const notForMira = [
    /^(hey|hi|hello)\s+(mom|dad|brother|sister|friend|dude|bro|man)/i,
    /talking\s+to\s+(someone|you)/i,
    /not\s+talking\s+to\s+(you|mira)/i,
  ];
  if (notForMira.some(p => p.test(lower))) {
    console.log('[FollowUp] Message appears directed at someone else');
    return false;
  }
  
  // Skip if it contains another wake word (alexa, siri, google, etc.)
  const otherAssistants = /\b(alexa|siri|google|hey google|cortana)\b/i;
  if (otherAssistants.test(lower)) {
    console.log('[FollowUp] Message directed at another assistant');
    return false;
  }
  
  // Within the follow-up window, MOST responses should be treated as follow-ups
  // Only exclude if clearly not for MIRA
  
  // Common follow-up response patterns (very broad to catch most answers)
  const followUpPatterns = [
    /^(yes|no|yeah|yep|nope|sure|okay|ok|nah|maybe|probably|definitely|absolutely)/i,
    /^(i think|i guess|i mean|well|actually|hmm|um|let me|i'd|i would|i could)/i,
    /^(that's|it's|this is|it was|there's|here's|those|these)/i,
    /^(the|a|an|my|his|her|their|our|your|some|any|all|both)\s+/i,
    /^(because|since|so|but|and|or|if|when|where|what|why|how|which)/i,
    /^(about|around|maybe|probably|definitely|certainly|actually|basically)/i,
    /^(not\s+really|kind\s+of|sort\s+of|i\s+don't|i\s+do|i\s+am|i\s+have|i\s+was|i\s+will|i\s+can)/i,
    /^[0-9]/,  // Starts with a number (answering a question)
    /^(one|two|three|four|five|six|seven|eight|nine|ten|first|second|third)/i,
    /^(it|he|she|they|we|you|that|this|those|these)\s+/i,  // Pronoun starts
    /^(can|could|would|should|will|won't|don't|didn't|isn't|aren't|wasn't)/i,
    /^(never|always|sometimes|often|usually|rarely|just|only|even)/i,
    /^(like|love|hate|want|need|prefer|enjoy)/i,
    /^(go|come|take|make|get|give|put|try|let|see|look|find)/i,  // Common verbs
  ];
  
  // If message matches follow-up patterns, it's likely a response to MIRA's question
  if (followUpPatterns.some(p => p.test(lower))) {
    console.log('[FollowUp] Detected follow-up response pattern within window');
    return true;
  }
  
  // Within 30 seconds, be very lenient - most responses are likely follow-ups
  // unless they're very long (might be a new topic)
  const wordCount = lower.split(/\s+/).length;
  if (timeSinceQuestion < 30000) {
    // Under 30 seconds: accept responses up to 50 words
    if (wordCount <= 50) {
      console.log('[FollowUp] Response within 30s window - treating as follow-up');
      return true;
    }
  } else if (timeSinceQuestion < 45000) {
    // 30-45 seconds: accept shorter responses (up to 25 words)
    if (wordCount <= 25) {
      console.log('[FollowUp] Short response within extended window - treating as follow-up');
      return true;
    }
  }
  
  return false;
}

// Check if message is directed at MIRA (with fuzzy matching) OR is a follow-up response
function isDirectedAtMira(text: string): boolean {
  // First check if it's a follow-up response
  if (isFollowUpResponse(text)) {
    return true;
  }
  
  const lower = text.toLowerCase().trim();
  const originalText = text.trim(); // Keep original for Hindi matching
  const words = lower.split(/\s+/);
  
  // 1. Exact keyword match (handles both Roman and Devanagari)
  const hasExactMatch = MIRA_KEYWORDS.some(keyword => {
    // For Roman keywords, use lowercase comparison
    if (/[a-z]/.test(keyword)) {
      if (lower.startsWith(keyword + ' ') || lower.startsWith(keyword + ',')) return true;
      if (/^(hey|hi|hello|ok|okay)\s+/.test(lower) && lower.includes(keyword)) return true;
      if (lower.endsWith(keyword) || lower.endsWith(keyword + '?') || lower.endsWith(keyword + '!')) return true;
      const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
      return keywordRegex.test(lower);
    } else {
      // For Devanagari keywords, use original text (case doesn't apply)
      if (originalText.includes(keyword)) return true;
    }
    return false;
  });
  
  if (hasExactMatch) return true;
  
  // 2. Fuzzy matching on first few words (wake word is usually at the start)
  const firstWords = words.slice(0, 4);
  const coreTargets = ['mira', 'meera', 'mi', 'ra'];
  
  for (const word of firstWords) {
    // Skip very short words or common articles
    if (word.length < 2 || ['a', 'an', 'the', 'is', 'it', 'to', 'in', 'on', 'at'].includes(word)) {
      continue;
    }
    
    // Check fuzzy match against core wake words
    for (const target of coreTargets) {
      if (isFuzzyMatch(word, target)) {
        console.log(`[WakeWord] Fuzzy match: "${word}" ≈ "${target}"`);
        return true;
      }
    }
  }
  
  // 3. Check for "hey/hi + fuzzy match" pattern
  if (words.length >= 2 && ['hey', 'hi', 'hello', 'ok', 'okay'].includes(words[0])) {
    const secondWord = words[1];
    for (const target of coreTargets) {
      if (isFuzzyMatch(secondWord, target)) {
        console.log(`[WakeWord] Fuzzy match after greeting: "${secondWord}" ≈ "${target}"`);
        return true;
      }
    }
  }
  
  return false;
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
  conversationId: string | null;
  isLoading: boolean;
  isThinking: boolean; // True when AI is processing (plays thinking sound)
  sendMessage: (text: string, attachments?: FileAttachment[]) => Promise<void>;
  clearConversation: () => void;

  // Voice
  isRecording: boolean;
  isListening: boolean;
  isProcessing: boolean;
  audioLevel: number;
  startRecording: () => void;
  stopRecording: () => void;
  isSpeaking: boolean;
  speakingAgent: AgentType | null;
  isMicReady: boolean; // True when WebRTC is connected and mic is available

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

  // Proactive
  enableProactive: boolean;
  setEnableProactive: (enabled: boolean) => void;

  // Gesture Detection
  currentGesture: DetectedGesture | null;
  gestureEnabled: boolean;
  setGestureEnabled: (enabled: boolean) => void;
  isHandsLoaded: boolean;

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
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Start true to check existing session
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(null);

  // Conversation state
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Ref for instant access to loading state (avoids stale closures)
  const isProcessingMessageRef = useRef(false);
  
  // Refs for face detection callback - prevents STT interference from re-renders
  const isSpeakingRef = useRef(false);
  const isLoadingRef = useRef(false);

  // Visual context
  const [visualContext, setVisualContext] = useState<VisualContext>({});

  // Proactive behavior
  const [enableProactive, setEnableProactive] = useState(true);
  const lastActivityRef = useRef<Date>(new Date());
  const proactiveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Ref to track if media has been auto-started
  const mediaAutoStartedRef = useRef(false);
  
  // Ref to store sendMessage for use in callbacks
  const sendMessageRef = useRef<((text: string) => Promise<void>) | undefined>(undefined);
  
  // Session ID for transcripts
  const sessionIdRef = useRef<string>(`session_${Date.now()}`);
  
  // Gesture detection state
  const [currentGesture, setCurrentGesture] = useState<DetectedGesture | null>(null);
  const [gestureEnabled, setGestureEnabled] = useState(true);
  const gestureProcessingRef = useRef(false);
  
  // Person context for gestures
  const [currentPerson, setCurrentPerson] = useState<{ name?: string; context?: string } | null>(null);
  
  // DateTime state
  const [dateTime, setDateTime] = useState<DateTimeContext>(() => getCurrentDateTime());

  // Update datetime every minute
  useEffect(() => {
    const updateDateTime = () => {
      setDateTime(getCurrentDateTime());
    };
    
    // Update immediately
    updateDateTime();
    
    // Update every minute
    const interval = setInterval(updateDateTime, 60000);
    
    return () => clearInterval(interval);
  }, []);

  // Helper function to transform content for TTS - summarizes code blocks and structured outputs
  const transformForTTS = useCallback((content: string): string => {
    // Check for code blocks
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    const hasCodeBlocks = codeBlockRegex.test(content);
    
    // Check for numbered/bulleted lists (3+ items)
    const listRegex = /(?:^|\n)((?:[\d]+\.|[-•*])\s+.+(?:\n(?:[\d]+\.|[-•*])\s+.+){2,})/gm;
    const hasLists = listRegex.test(content);
    
    if (!hasCodeBlocks && !hasLists) {
      return content; // No special content, return as-is
    }
    
    let ttsContent = content;
    
    // Replace code blocks with spoken summary
    if (hasCodeBlocks) {
      ttsContent = ttsContent.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, language) => {
        const lang = language || 'code';
        return `I've written some ${lang} code for you. You can see it in the outputs panel.`;
      });
    }
    
    // Replace long lists with summary
    if (hasLists) {
      ttsContent = ttsContent.replace(/(?:^|\n)((?:[\d]+\.|[-•*])\s+.+(?:\n(?:[\d]+\.|[-•*])\s+.+){2,})/gm, (match) => {
        const itemCount = (match.match(/(?:^|\n)[\d]+\.|[-•*]\s+/g) || []).length;
        return `\nI've listed ${itemCount} items for you in the outputs panel.`;
      });
    }
    
    // Clean up multiple spaces/newlines
    ttsContent = ttsContent.replace(/\n{3,}/g, '\n\n').trim();
    
    // If the entire content was just code/lists, add a helpful note
    if (ttsContent.length < 50 && (hasCodeBlocks || hasLists)) {
      ttsContent += ' Let me know if you have any questions about it!';
    }
    
    return ttsContent;
  }, []);

  // isThinking state for AI processing indicator
  const [isThinking, setIsThinking] = useState(false);
  
  // Track current speaking agent
  const [speakingAgent, setSpeakingAgent] = useState<AgentType | null>(null);
  
  // Track last AI response text
  const lastResponseTextRef = useRef<string>('');
  
  // TTS audio level for sphere reactivity (from WebRTC output)
  const [ttsAudioLevel, setTtsAudioLevel] = useState(0);

  // ========== WebRTC Realtime API (Hybrid Mode) ==========
  // Handles BOTH speech-to-text AND text-to-speech via WebRTC
  // In hybrid mode: transcribes user speech, then we call /api/chat, then injectResponse to speak
  
  const handleRealtimeTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!isFinal || !text.trim()) return;
    
    console.log('[Realtime] User transcript:', text);
    
    const directed = isDirectedAtMira(text);
    
    // Always save the transcript in background
    saveTranscriptEntry(text, 'user', user?.name || 'User', directed);
    
    // Only send to MIRA if addressed
    // Note: WebRTC handles echo cancellation and interruptions automatically
    if (directed && sendMessageRef.current) {
      console.log('Message directed at MIRA:', text);
      sendMessageRef.current(text);
    } else {
      console.log('Background transcript (not for MIRA):', text);
    }
  }, []);
  
  const handleRealtimeResponse = useCallback((text: string) => {
    console.log('[Realtime] AI response:', text);
    lastResponseTextRef.current = text;
  }, []);
  
  const handleRealtimeError = useCallback((error: string) => {
    console.error('[Realtime] Error:', error);
  }, []);
  
  const handleRealtimeStateChange = useCallback((state: 'disconnected' | 'connecting' | 'connected' | 'speaking' | 'listening') => {
    console.log('[Realtime] State change:', state);
  }, []);
  
  // Initialize Realtime hook in HYBRID mode
  const {
    state: realtimeState,
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    injectResponse: realtimeInjectResponse,
    cancelResponse: realtimeCancelResponse,
    updateInstructions: realtimeUpdateInstructions,
    isConnected: realtimeConnected,
    isSpeaking,
    isListening,
    transcript: realtimeTranscript,
    inputAudioLevel: micAudioLevel,
    outputAudioLevel: realtimeOutputLevel,
  } = useRealtime({
    hybridMode: true, // CRITICAL: Don't auto-respond, we handle /api/chat
    voice: 'mi', // Default voice
    onTranscript: handleRealtimeTranscript,
    onAudioResponse: handleRealtimeResponse,
    onError: handleRealtimeError,
    onStateChange: handleRealtimeStateChange,
  });
  
  // Update TTS audio level from WebRTC output
  useEffect(() => {
    setTtsAudioLevel(realtimeOutputLevel);
  }, [realtimeOutputLevel]);
  
  // Helper function to speak via WebRTC (replaces playAudio)
  const playAudio = useCallback(async (text: string, agent: AgentType) => {
    // Auto-connect if not connected
    if (!realtimeConnected) {
      console.log('[Realtime] Not connected, connecting first...');
      await connectRealtime();
      // Wait a bit for connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('[Realtime] Speaking as', agent, ':', text.substring(0, 50) + '...');
    setSpeakingAgent(agent);
    lastResponseTextRef.current = text;
    
    // Inject the response for WebRTC to speak
    realtimeInjectResponse(text, agent);
  }, [realtimeConnected, connectRealtime, realtimeInjectResponse]);
  
  // playAudioAndWait - speaks and waits for completion
  const playAudioAndWait = useCallback(async (text: string, agent: AgentType): Promise<void> => {
    return new Promise(async (resolve) => {
      // Auto-connect if not connected
      if (!realtimeConnected) {
        console.log('[Realtime] Not connected, connecting first...');
        await connectRealtime();
        // Wait a bit for connection to establish
        await new Promise(r => setTimeout(r, 1000));
      }
      
      console.log('[Realtime] Speaking (wait) as', agent, ':', text.substring(0, 50) + '...');
      setSpeakingAgent(agent);
      lastResponseTextRef.current = text;
      
      // Inject the response
      realtimeInjectResponse(text, agent);
      
      // Estimate speech duration based on text length (~150 words per minute = 400ms per word)
      const wordCount = text.split(/\s+/).length;
      const estimatedDuration = Math.max(2000, wordCount * 400); // Minimum 2 seconds
      
      // Wait for estimated duration
      setTimeout(() => {
        resolve();
      }, estimatedDuration);
    });
  }, [realtimeConnected, connectRealtime, realtimeInjectResponse]);
  
  // Stop audio - cancel WebRTC response
  const stopAudio = useCallback(() => {
    realtimeCancelResponse();
    setSpeakingAgent(null);
    lastResponseTextRef.current = '';
  }, [realtimeCancelResponse]);
  
  // Thinking sound removed - was causing blocking issues
  const playThinkingSound = useCallback(() => {
    // No-op - thinking sound removed
  }, []);
  
  const stopThinkingSound = useCallback(() => {
    // No-op - thinking sound removed
  }, []);

  // Keep refs in sync with state values (for face detection callback)
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);
  
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Save transcript entry in background
  const saveTranscriptEntry = useCallback(async (
    content: string,
    speakerType: 'user' | 'mira' | 'other',
    speakerName?: string,
    directedAtMira?: boolean
  ) => {
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return;

      await fetch('/api/transcripts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          content,
          speakerType,
          speakerName,
          isDirectedAtMira: directedAtMira ?? isDirectedAtMira(content),
        }),
      });
    } catch (error) {
      console.error('Error saving transcript:', error);
    }
  }, []);

  // Handle gesture-triggered AI response
  const handleGestureResponse = useCallback(async (gesture: DetectedGesture) => {
    if (!gestureEnabled || gestureProcessingRef.current || isSpeaking || isLoading) {
      return;
    }
    
    // Check cooldown
    if (isGestureOnCooldown(gesture.gesture)) {
      return;
    }

    gestureProcessingRef.current = true;
    setCurrentGesture(gesture);
    
    try {
      const token = localStorage.getItem('mira_token');
      if (!token) return;

      console.log(`[Gesture] Detected: ${gesture.gesture} (${(gesture.confidence * 100).toFixed(0)}%)`);
      
      // Call gesture API to get response
      const response = await fetch('/api/gesture', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          gesture: gesture.gesture,
          personName: currentPerson?.name,
          personContext: currentPerson?.context,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        
        // Add message to UI
        const gestureMessage: Message = {
          id: `${Date.now()}-gesture`,
          role: data.agent as Message['role'],
          content: data.response,
          timestamp: new Date(),
          emotion: 'friendly',
        };
        setMessages(prev => [...prev, gestureMessage]);
        
        // Save to transcript - use English names for UI display
        const agentNameMap: Record<string, string> = { 'mi': 'MI', 'ra': 'RA', 'mira': 'MIRA' };
        saveTranscriptEntry(data.response, 'mira', agentNameMap[data.agent] || data.agent.toUpperCase(), true);
        
        // Play audio response (transform code/outputs for TTS)
        await playAudio(transformForTTS(data.response), data.agent as AgentType);
        
        // Mark gesture as used
        markGestureUsed(gesture.gesture);
      }
    } catch (error) {
      console.error('Gesture response error:', error);
    } finally {
      gestureProcessingRef.current = false;
      // Clear current gesture after a delay
      setTimeout(() => setCurrentGesture(null), 2000);
    }
  }, [gestureEnabled, isSpeaking, isLoading, currentPerson, saveTranscriptEntry, playAudio, transformForTTS]);

  // Note: Echo cancellation and interruption handling are managed by WebRTC automatically

  // Audio level for sphere animation - ONLY use device output audio (ttsAudioLevel)
  // This prevents spheres from reacting to external sounds picked up by mic
  // Spheres should only react when MIRA is speaking, not to ambient noise
  const audioLevel = ttsAudioLevel;

  // Alias for backward compatibility
  const isRecording = isListening;
  const isProcessing = false; // No processing delay with WebRTC STT
  
  // Voice recording controls - connect/disconnect WebRTC
  const startVoiceRecording = useCallback(() => {
    if (!realtimeConnected) {
      console.log('[Voice] Connecting WebRTC for voice...');
      connectRealtime();
    }
  }, [realtimeConnected, connectRealtime]);
  
  const stopVoiceRecording = useCallback(() => {
    // Don't actually disconnect - just log
    console.log('[Voice] stopVoiceRecording called (WebRTC stays connected)');
  }, []);

  // MediaPipe gesture detection disabled - using Gemini Vision API instead
  // The hook causes WASM loading errors in Next.js
  const isHandsLoaded = false; // Placeholder for interface
  /*
  const {
    currentGesture: detectedGesture,
    isHandsLoaded,
    error: gestureError,
    startDetection: startGestureDetection,
    processFrame: processGestureFrame,
    initializeHands,
  } = useGestureDetection({
    onGestureDetected: handleGestureResponse,
    minConfidence: 0.7,
    enabled: gestureEnabled && !isSpeaking && !isLoading,
  });
  */

  // Media capture - simplified without face detection
  const handleCameraFrame = useCallback(async (imageBase64: string) => {
    // Skip on mobile devices
    if (isMobileDevice()) {
      return;
    }
    
    // Skip processing when user is waiting for a response
    if (isProcessingMessageRef.current) {
      return;
    }
    
    // Camera frames available for future use (gesture detection, etc.)
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
    captureInterval: 10000, // Every 10 seconds for face detection (client-side face-api.js)
  });

  // Function to auto-start media after auth
  const autoStartMedia = useCallback(() => {
    if (!mediaAutoStartedRef.current) {
      mediaAutoStartedRef.current = true;
      
      // Small delay to ensure component is fully mounted
      setTimeout(() => {
        // Always start voice recording
        startVoiceRecording();
        console.log('[Media] Voice recording started');
        
        // Also start camera by default for face detection
        startCamera();
        console.log('[Media] Camera started');
      }, 500);
    }
  }, [startVoiceRecording, startCamera]);

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
        autoStartMedia();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [autoStartMedia]);

  const register = useCallback(async (
    email: string,
    password: string,
    name: string
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, dropExisting: false }),
      });

      if (response.ok) {
        const { user, token } = await response.json();
        localStorage.setItem('mira_token', token);
        setUser(user);
        setIsAuthenticated(true);
        autoStartMedia();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [autoStartMedia]);

  const logout = useCallback(() => {
    localStorage.removeItem('mira_token');
    setUser(null);
    setIsAuthenticated(false);
    setMessages([]);
    setConversationId(null);
    stopAudio();
  }, [stopAudio]);

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
          
          // Auto-start media on existing session
          if (!mediaAutoStartedRef.current) {
            mediaAutoStartedRef.current = true;
            setTimeout(() => {
              // Start WebRTC voice connection
              startVoiceRecording();
            }, 500);
          }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // NOTE: MediaPipe gesture detection disabled due to WASM compatibility issues with Next.js
  // Using Gemini Vision API for gesture detection instead (handled in handleCameraFrame)
  // The useGestureDetection hook is kept but not actively used
  /*
  // Initialize MediaPipe gesture detection when camera becomes active
  useEffect(() => {
    if (isCameraActive && cameraVideoRef.current && gestureEnabled) {
      console.log('[Gesture] Camera active, initializing MediaPipe gesture detection...');
      
      // Initialize MediaPipe hands
      initializeHands().then(() => {
        if (cameraVideoRef.current) {
          // Start processing video frames for gesture detection
          startGestureDetection(cameraVideoRef.current);
          console.log('[Gesture] MediaPipe gesture detection started');
        }
      }).catch(err => {
        console.error('[Gesture] Failed to initialize:', err);
      });
    }
  }, [isCameraActive, gestureEnabled, initializeHands, startGestureDetection, cameraVideoRef]);

  // Process video frames for gesture detection
  useEffect(() => {
    if (!isCameraActive || !cameraVideoRef.current || !isHandsLoaded || !gestureEnabled) {
      return;
    }

    let animationId: number;
    let lastProcessTime = 0;
    const FRAME_INTERVAL = 100; // Process ~10 frames per second

    const processLoop = async (timestamp: number) => {
      if (timestamp - lastProcessTime >= FRAME_INTERVAL) {
        if (cameraVideoRef.current && cameraVideoRef.current.readyState >= 2) {
          await processGestureFrame(cameraVideoRef.current);
        }
        lastProcessTime = timestamp;
      }
      animationId = requestAnimationFrame(processLoop);
    };

    animationId = requestAnimationFrame(processLoop);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isCameraActive, isHandsLoaded, gestureEnabled, processGestureFrame, cameraVideoRef]);
  */

  // Send message
  const sendMessage = useCallback(async (text: string, attachments?: FileAttachment[]) => {
    // Prevent duplicate sends
    if ((!text.trim() && !attachments?.length) || isLoading) {
      console.log('[SendMessage] Blocked - empty or loading:', { text: text.trim(), isLoading });
      return;
    }

    console.log('[SendMessage] Starting:', text, attachments?.length ? `with ${attachments.length} attachments` : '');
    lastActivityRef.current = new Date();
    
    // PRIORITY: Set processing flag IMMEDIATELY to pause all background tasks
    isProcessingMessageRef.current = true;
    setIsLoading(true);

    // Check if this is a system message (don't show to user or play thinking)
    const isSystemPrompt = text.startsWith('[SYSTEM:');
    
    // Play thinking sound while processing (not for system messages)
    if (!isSystemPrompt) {
      playThinkingSound();
    }

    // Add user message (skip if it's a system prompt)
    if (!isSystemPrompt) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);
    }

    try {
      const token = localStorage.getItem('mira_token');
      
      // Build context object with datetime
      const contextData = {
        visualContext: visualContext.cameraDescription || visualContext.screenDescription 
          ? visualContext 
          : undefined,
        dateTime: {
          ...dateTime,
          formattedDateTime: dateTime.formattedDateTime,
        },
      };
      
      console.log('[SendMessage] Calling /api/chat with context:', { 
        dateTime: dateTime.formattedDateTime 
      });
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          conversationId,
          sessionId: sessionIdRef.current,
          attachments: attachments || [],
          ...contextData,
        }),
      });

      console.log('[SendMessage] Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        
        // Stop thinking sound - we have a response
        stopThinkingSound();
        
        console.log('[SendMessage] Response data:', { 
          agent: data.response?.agent,
        });
        
        setConversationId(data.conversationId);

        // Add final response
        const responseMessage: Message = {
          id: `${Date.now()}-response`,
          role: data.response.agent as Message['role'],
          content: data.response.content,
          timestamp: new Date(),
          emotion: data.response.emotion,
        };
        setMessages(prev => [...prev, responseMessage]);
        
        // Save response to transcript - use English names for UI display
        const finalAgentNameMap: Record<string, string> = { 'mi': 'MI', 'ra': 'RA', 'mira': 'MIRA' };
        saveTranscriptEntry(data.response.content, 'mira', finalAgentNameMap[data.response.agent] || data.response.agent.toUpperCase(), true);
        
        // Check if MIRA's response contains a question (for follow-up detection)
        // Be very aggressive at detecting questions - any question mark or question-like phrase
        const responseText = data.response.content;
        const lastSentences = responseText.split(/[.!]/).slice(-3).join(' '); // Focus on last few sentences
        
        const hasQuestionMark = /\?/.test(responseText);
        const hasQuestionWords = /\b(what|how|when|where|why|which|who|whose|whom)\b.*\?/i.test(responseText);
        const hasInvitingQuestion = /\b(could you|would you|can you|do you|are you|is it|have you|will you|shall|should|tell me|let me know|thoughts|think|prefer|like to|want to|interested in)\b/i.test(lastSentences);
        const hasOpenEnded = /\b(anything else|what else|how about|what about|any questions|more info|tell me more|go on|continue|elaborate)\b/i.test(responseText);
        
        const hasQuestion = hasQuestionMark || hasQuestionWords || hasInvitingQuestion || hasOpenEnded;
        
        console.log('[FollowUp] Question detection:', {
          hasQuestionMark,
          hasQuestionWords,
          hasInvitingQuestion,
          hasOpenEnded,
          result: hasQuestion
        });
        
        if (hasQuestion) {
          console.log('[FollowUp] MIRA asked a follow-up question - enabling follow-up mode');
          setMiraAskedFollowUp(true);
        } else {
          setMiraAskedFollowUp(false);
        }

        // Play final response audio
        // Transform code/outputs for TTS so AI summarizes instead of reading code verbatim
        console.log('[SendMessage] Playing final response from:', data.response.agent);
        await playAudio(transformForTTS(data.response.content), data.response.agent as AgentType);
        console.log('[SendMessage] Complete!');
      } else {
        const errorText = await response.text();
        console.error('[SendMessage] API error:', response.status, errorText);
        throw new Error(`API error: ${response.status}`);
      }
    } catch (error) {
      console.error('[SendMessage] Error:', error);
      stopThinkingSound(); // Stop thinking on error
      const errorMessage: Message = {
        id: `${Date.now()}-error`,
        role: 'system',
        content: 'Sorry, there was an error processing your message.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      isProcessingMessageRef.current = false;
      setIsLoading(false);
      console.log('[SendMessage] isLoading set to false');
    }
  }, [conversationId, visualContext, isLoading, playAudio, playAudioAndWait, saveTranscriptEntry, dateTime, playThinkingSound, stopThinkingSound, transformForTTS]);

  // Keep sendMessageRef in sync
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  // Recording controls (WebRTC handles VAD automatically)
  const startRecording = useCallback(() => {
    if (!realtimeConnected && !isLoading) {
      connectRealtime();
    }
  }, [realtimeConnected, isLoading, connectRealtime]);

  const stopRecording = useCallback(() => {
    // With WebRTC, we don't stop - VAD handles listening automatically
    // User can explicitly disconnect if needed
    console.log('[Recording] stopRecording called (WebRTC VAD handles automatically)');
  }, []);

  // WebRTC handles echo cancellation and VAD automatically, no need for manual pause/resume
  // The auto-pause/resume logic is removed since WebRTC manages this internally

  // Proactive behavior - AI initiates conversation
  useEffect(() => {
    if (!enableProactive || !isAuthenticated) return;

    proactiveIntervalRef.current = setInterval(async () => {
      const timeSinceActivity = Date.now() - lastActivityRef.current.getTime();
      const minutes = timeSinceActivity / 1000 / 60;

      // Only initiate if idle for more than 2 minutes and not currently interacting
      if (minutes > 2 && !isLoading && !isRecording && !isSpeaking) {
        // Check if AI should speak
        try {
          const token = localStorage.getItem('mira_token');
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              message: '[PROACTIVE_CHECK]',
              conversationId,
              visualContext,
              proactive: true,
            }),
          });

          // Handle proactive response if the API supports it
          // For now, this is a placeholder
        } catch {
          // Ignore errors for proactive checks
        }
      }
    }, 60000); // Check every minute

    return () => {
      if (proactiveIntervalRef.current) {
        clearInterval(proactiveIntervalRef.current);
      }
    };
  }, [enableProactive, isAuthenticated, isLoading, isRecording, isSpeaking, conversationId, visualContext]);

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
    conversationId,
    isLoading,
    isThinking,
    sendMessage,
    clearConversation,

    // Voice
    isRecording,
    isListening,
    isProcessing,
    audioLevel,
    startRecording,
    stopRecording,
    isSpeaking,
    speakingAgent,
    isMicReady: realtimeConnected,

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

    // Proactive
    enableProactive,
    setEnableProactive,

    // Gesture Detection
    currentGesture,
    gestureEnabled,
    setGestureEnabled,
    isHandsLoaded,

    // Time
    dateTime,
  };

  return <MIRAContext.Provider value={value}>{children}</MIRAContext.Provider>;
}

export default MIRAProvider;