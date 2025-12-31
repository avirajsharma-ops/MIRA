'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useMediaCapture, useAudioPlayer } from '@/hooks';
import { useLiveSpeech } from '@/hooks/useLiveSpeech';
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
  detectedFaces?: string[];
  currentFrame?: string; // Current camera frame as base64 for face recognition
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
  // Hindi transcription variations
  'meeraa', 'meraa', 'meerha', 'mirha',
  // With "hey/hi" prefix variations  
  'hey meera', 'hey mera', 'hey myra', 'hi meera', 'hi mera',
  'hey maya', 'hey mia', 'hi maya', 'hi mia',
  // Common speech-to-text errors for "MI"
  'me', 'mee', 'my',
  // Common speech-to-text errors for "RA"  
  'raa', 'rah', 'raw',
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

// Check if message is directed at MIRA (with fuzzy matching)
function isDirectedAtMira(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);
  
  // 1. Exact keyword match
  const hasExactMatch = MIRA_KEYWORDS.some(keyword => {
    if (lower.startsWith(keyword + ' ') || lower.startsWith(keyword + ',')) return true;
    if (/^(hey|hi|hello|ok|okay)\s+/.test(lower) && lower.includes(keyword)) return true;
    if (lower.endsWith(keyword) || lower.endsWith(keyword + '?') || lower.endsWith(keyword + '!')) return true;
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
    return keywordRegex.test(lower);
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
  user: { id: string; name: string; email: string } | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;

  // Conversation
  messages: Message[];
  conversationId: string | null;
  isLoading: boolean;
  sendMessage: (text: string) => Promise<void>;
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
  isDebating: boolean; // True when MI and RA are having a debate

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
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(null);

  // Conversation state
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDebating, setIsDebating] = useState(false);

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
  
  // Person context for gestures (from face recognition)
  const [currentPerson, setCurrentPerson] = useState<{ name?: string; context?: string } | null>(null);
  
  // Unknown face detection state
  const [pendingUnknownFace, setPendingUnknownFace] = useState<{
    imageBase64: string;
    description: string;
    distinctiveFeatures: string[];
  } | null>(null);
  const unknownFacePromptedRef = useRef(false);
  const lastUnknownFaceTimeRef = useRef<number>(0);
  const knownPeopleCountRef = useRef<number | null>(null);
  const awaitingFaceInfoRef = useRef(false);
  
  // Track who we've greeted in this session to avoid repeated greetings
  const greetedPeopleRef = useRef<Set<string>>(new Set());

  // Audio player
  const {
    isPlaying: isSpeaking,
    currentAgent: speakingAgent,
    playAudio,
    playAudioAndWait,
    stopAudio,
  } = useAudioPlayer();

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
        
        // Save to transcript
        saveTranscriptEntry(data.response, 'mira', data.agent.toUpperCase(), true);
        
        // Play audio response
        await playAudio(data.response, data.agent as AgentType);
        
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
  }, [gestureEnabled, isSpeaking, isLoading, currentPerson, saveTranscriptEntry, playAudio]);

  // Live Speech Recognition - always transcribes, only responds when addressed
  const handleTranscription = useCallback(async (text: string, isFinal: boolean) => {
    if (!isFinal || !text.trim()) return;
    
    // Always save the transcript in background
    const directed = isDirectedAtMira(text);
    await saveTranscriptEntry(text, 'user', user?.name || 'User', directed);
    
    // Only send to MIRA if addressed
    if (directed && sendMessageRef.current) {
      console.log('Message directed at MIRA:', text);
      await sendMessageRef.current(text);
    } else {
      console.log('Background transcript (not for MIRA):', text);
    }
  }, [saveTranscriptEntry, user?.name]);

  const {
    isListening,
    isSupported: isSpeechSupported,
    interimTranscript,
    audioLevel,
    startListening: startVoiceRecording,
    stopListening: stopVoiceRecording,
  } = useLiveSpeech({ 
    onTranscription: handleTranscription,
    continuous: true,
    language: 'en-US', // Will auto-detect other languages too
  });

  // Alias for backward compatibility
  const isRecording = isListening;
  const isProcessing = false; // No processing delay with live STT

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

  // Media capture with speaker detection (vision API for face recognition AND gestures)
  const handleCameraFrame = useCallback(async (imageBase64: string) => {
    // Always store the current frame for face recognition
    setVisualContext(prev => ({
      ...prev,
      currentFrame: imageBase64,
    }));
    
    try {
      const token = localStorage.getItem('mira_token');
      const response = await fetch('/api/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          imageBase64, 
          type: 'camera', 
          detectSpeakers: true, // For face recognition and speaker detection
          detectGestures: true, // Enable gesture detection via vision API
        }),
      });

      if (response.ok) {
        const { analysis } = await response.json();
        
        setVisualContext(prev => ({
          ...prev,
          cameraDescription: analysis.description,
          detectedFaces: analysis.speakers?.detectedFaces?.map((f: any) => f.description) || analysis.people?.descriptions || [],
        }));
        
        // Update current person context from face recognition (from speakers data)
        const speakers = analysis.speakers;
        if (speakers?.recognizedPeople && speakers.recognizedPeople.length > 0) {
          const person = speakers.recognizedPeople[0];
          console.log(`[Face] Recognized: ${person.name} (confidence: ${person.confidence})`);
          setCurrentPerson({
            name: person.name,
            context: person.relationship || person.context,
          });
          // Clear unknown face state if we recognized someone
          unknownFacePromptedRef.current = false;
          awaitingFaceInfoRef.current = false;
          setPendingUnknownFace(null);
          
          // Check for greetings (first time today or after long gap)
          if (speakers.greetings && speakers.greetings.length > 0 && sendMessageRef.current) {
            for (const greeting of speakers.greetings) {
              // Only greet if we haven't greeted this person in this session
              if (!greetedPeopleRef.current.has(greeting.personName)) {
                greetedPeopleRef.current.add(greeting.personName);
                
                // Build greeting prompt based on time of day and context
                let greetingPrompt: string;
                const greetingTypeMap: Record<string, string> = {
                  morning: 'Good morning',
                  afternoon: 'Good afternoon', 
                  evening: 'Good evening',
                  night: 'Hi',
                  welcome_back: 'Welcome back',
                };
                const timeGreeting = greetingTypeMap[greeting.greetingType] || 'Hello';
                
                if (greeting.isOwner) {
                  // Greeting for the account owner
                  greetingPrompt = `[SYSTEM: The account owner "${greeting.personName}" has just appeared on camera for the first time ${greeting.isFirstTimeToday ? 'today' : 'in a while'}. Greet them warmly and naturally. Use "${timeGreeting}" as your greeting style. Be friendly and personal - you know them well. Don't mention "camera" or "detected" - just greet them as if you're happy to see them. Keep it brief and natural, maybe ask how they're doing or comment on the time of day.]`;
                } else {
                  // Greeting for a known person (not owner)
                  greetingPrompt = `[SYSTEM: "${greeting.personName}" (${greeting.relationship || 'known person'}) has just appeared on camera for the first time ${greeting.isFirstTimeToday ? 'today' : 'in a while'}. Greet them warmly using "${timeGreeting}". Be friendly and natural. Don't mention "camera" or "detected" - just greet them naturally. Keep it brief.]`;
                }
                
                console.log(`[Face] Triggering greeting for ${greeting.personName} (${greeting.greetingType})`);
                
                // Only send greeting if not currently speaking or processing
                if (!isSpeaking && !isLoading) {
                  sendMessageRef.current(greetingPrompt);
                  break; // Only greet one person at a time
                }
              }
            }
          }
        }
        
        // Check for unknown faces when we haven't prompted recently
        // and there are no recognized people
        const now = Date.now();
        const cooldownMs = 30000; // 30 second cooldown between prompts
        
        if (
          speakers?.unknownFaces?.length > 0 &&
          speakers?.recognizedPeople?.length === 0 &&
          !unknownFacePromptedRef.current &&
          !awaitingFaceInfoRef.current &&
          !isSpeaking &&
          !isLoading &&
          (now - lastUnknownFaceTimeRef.current) > cooldownMs
        ) {
          const unknownFace = speakers.unknownFaces[0];
          
          // Store the unknown face data for later saving
          setPendingUnknownFace({
            imageBase64,
            description: unknownFace.description || '',
            distinctiveFeatures: unknownFace.distinctiveFeatures || [],
          });
          
          unknownFacePromptedRef.current = true;
          lastUnknownFaceTimeRef.current = now;
          awaitingFaceInfoRef.current = true;
          
          console.log('[Face] Unknown face detected, prompting for introduction');
          
          // Trigger MIRA to ask who this person is
          if (sendMessageRef.current) {
            const introPrompt = `[SYSTEM: An unknown person has appeared in the camera. Their appearance: ${unknownFace.description || 'visible in camera'}. Distinctive features: ${unknownFace.distinctiveFeatures?.join(', ') || 'none noted'}. Please warmly introduce yourself and ask who they are so you can remember them. Be friendly and natural - don't mention "camera" or "image", just act like you're meeting them for the first time. Ask for their name and optionally their relationship to the user (friend, family, etc).]`;
            
            // Send as internal system message
            sendMessageRef.current(introPrompt);
          }
        }
        
        // Handle gesture detection from vision API
        if (analysis.gesture && analysis.gesture !== 'none' && gestureEnabled) {
          const gesture = analysis.gesture as GestureType;
          
          // Check cooldown and processing state
          if (!isGestureOnCooldown(gesture) && !gestureProcessingRef.current && !isSpeaking && !isLoading) {
            console.log(`[Gesture] Vision API detected: ${gesture}`);
            
            // Create a DetectedGesture object for the handler
            const detectedGesture: DetectedGesture = {
              gesture,
              confidence: 0.8,
              handedness: 'Right',
              landmarks: [],
            };
            
            // Trigger response
            handleGestureResponse(detectedGesture);
          }
        }
      }
    } catch (error) {
      console.error('Camera analysis error:', error);
    }
  }, [gestureEnabled, isSpeaking, isLoading, handleGestureResponse]);

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
    captureInterval: 10000, // Every 10 seconds
  });

  // Function to auto-start media after auth
  const autoStartMedia = useCallback(() => {
    if (!mediaAutoStartedRef.current) {
      mediaAutoStartedRef.current = true;
      // Small delay to ensure component is fully mounted
      setTimeout(() => {
        startCamera();
        startVoiceRecording();
      }, 500);
    }
  }, [startCamera, startVoiceRecording]);

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

  // Timeout for unknown face introduction - reset after 60 seconds if no response
  useEffect(() => {
    if (awaitingFaceInfoRef.current && pendingUnknownFace) {
      const timeout = setTimeout(() => {
        console.log('[Face] Timeout waiting for introduction, resetting state');
        awaitingFaceInfoRef.current = false;
        setPendingUnknownFace(null);
        // Allow re-prompting after longer cooldown
        lastUnknownFaceTimeRef.current = Date.now();
      }, 60000); // 60 second timeout
      
      return () => clearTimeout(timeout);
    }
  }, [pendingUnknownFace]);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('mira_token');
      if (!token) return;

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
              startCamera();
              // Only start voice if speech recognition is supported
              if (isSpeechSupported) {
                startVoiceRecording();
              }
            }, 500);
          }
        } else {
          localStorage.removeItem('mira_token');
        }
      } catch {
        localStorage.removeItem('mira_token');
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
  const sendMessage = useCallback(async (text: string) => {
    // Prevent duplicate sends
    if (!text.trim() || isLoading) {
      console.log('[SendMessage] Blocked - empty or loading:', { text: text.trim(), isLoading });
      return;
    }

    console.log('[SendMessage] Starting:', text);
    lastActivityRef.current = new Date();
    setIsLoading(true);

    // Check if this is a system message for unknown face prompt (don't show to user)
    const isSystemPrompt = text.startsWith('[SYSTEM:');
    
    // Check if user is responding to our face introduction question
    const isIntroductionResponse = awaitingFaceInfoRef.current && !isSystemPrompt;
    
    if (isIntroductionResponse && pendingUnknownFace) {
      // Try to extract name from the user's response
      // More comprehensive patterns for name extraction
      const namePatterns = [
        // "I'm John", "I am John", "My name is John"
        /(?:i(?:'?m| am)|my name is|call me|it(?:'?s| is)|this is|i go by)\s+([A-Za-z][a-zA-Z]+)/i,
        // "Name's John", "Name is John"
        /name(?:'?s| is)?\s+([A-Za-z][a-zA-Z]+)/i,
        // "John here", "John speaking"
        /([A-Za-z][a-zA-Z]+)\s+(?:here|speaking)/i,
        // Just a name at the start with punctuation: "John.", "John!", "John,"
        /^([A-Za-z][a-zA-Z]+)[.,!]?\s*$/i,
        // Name at start followed by more text: "John, nice to meet you"
        /^([A-Za-z][a-zA-Z]+)(?:\s*[,.]|\s+(?:nice|good|hey|hi|hello|pleased))/i,
        // "Hey, I'm John" or "Hi, it's John"
        /(?:hey|hi|hello)[,.]?\s*(?:i(?:'?m| am)|it(?:'?s| is))?\s*([A-Za-z][a-zA-Z]+)/i,
        // Hindi patterns: "Mera naam John hai", "Main John hoon"
        /(?:mera naam|main)\s+([A-Za-z][a-zA-Z]+)/i,
      ];
      
      let extractedName: string | null = null;
      for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          // Filter out common words that aren't names
          const potentialName = match[1].trim();
          const commonWords = ['hey', 'hi', 'hello', 'nice', 'good', 'well', 'just', 'here', 'there', 'yeah', 'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank', 'please', 'mira', 'mi', 'ra'];
          if (!commonWords.includes(potentialName.toLowerCase()) && potentialName.length >= 2) {
            extractedName = potentialName.charAt(0).toUpperCase() + potentialName.slice(1).toLowerCase();
            break;
          }
        }
      }
      
      // Extract relationship if mentioned
      const relationshipPatterns = [
        /(?:i(?:'?m| am) (?:a |the )?|i(?:'?m| am) your )?(friend|family|brother|sister|mother|father|mom|dad|wife|husband|partner|colleague|coworker|boss|son|daughter|roommate|neighbor)/i,
      ];
      
      let extractedRelationship = 'friend';
      for (const pattern of relationshipPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          extractedRelationship = match[1].toLowerCase();
          break;
        }
      }
      
      if (extractedName) {
        console.log(`[Face] Extracted name: ${extractedName}, relationship: ${extractedRelationship}`);
        
        // Save the person
        try {
          const token = localStorage.getItem('mira_token');
          const saveResponse = await fetch('/api/people', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: extractedName,
              imageBase64: pendingUnknownFace.imageBase64,
              relationship: extractedRelationship,
              context: `First met on ${new Date().toLocaleDateString()}. ${pendingUnknownFace.description}`,
            }),
          });
          
          if (saveResponse.ok) {
            console.log(`[Face] Successfully saved ${extractedName} to people library`);
            // Clear the pending state
            setPendingUnknownFace(null);
            awaitingFaceInfoRef.current = false;
            unknownFacePromptedRef.current = false;
            
            // Update current person context
            setCurrentPerson({
              name: extractedName,
              context: extractedRelationship,
            });
            
            // Generate a confirmation response
            const confirmationMsg = `Nice to meet you, ${extractedName}! I'll remember your face from now on. Next time I see you, I'll know it's you! 😊`;
            
            // Add confirmation message to UI
            const confirmMessage: Message = {
              id: `${Date.now()}-face-confirm`,
              role: 'mi',
              content: confirmationMsg,
              timestamp: new Date(),
              emotion: 'happy',
            };
            setMessages(prev => [...prev, confirmMessage]);
            
            // Play the confirmation audio
            await playAudio(confirmationMsg, 'mi');
            
            // Return early - don't process as normal message since we handled it
            setIsLoading(false);
            return;
          } else {
            const errorData = await saveResponse.json();
            console.error('[Face] Failed to save person:', errorData.error);
            // If it's a duplicate, still acknowledge
            if (errorData.error?.includes('already exists')) {
              awaitingFaceInfoRef.current = false;
              setPendingUnknownFace(null);
            }
          }
        } catch (error) {
          console.error('[Face] Error saving person:', error);
        }
      } else {
        // Couldn't extract name, will retry next time
        console.log('[Face] Could not extract name from response, keeping awaiting state');
      }
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
      
      console.log('[SendMessage] Calling /api/chat...');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          conversationId,
          sessionId: sessionIdRef.current, // Include session ID for transcript context
          visualContext: visualContext.cameraDescription || visualContext.screenDescription 
            ? visualContext 
            : undefined, // Only send if we have context
        }),
      });

      console.log('[SendMessage] Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[SendMessage] Response data:', { 
          hasDebate: !!data.debate?.length, 
          debateCount: data.debate?.length || 0,
          agent: data.response?.agent,
          consensus: data.consensus 
        });
        
        setConversationId(data.conversationId);

        // Add and play debate messages if any - user hears the whole discussion
        if (data.debate && data.debate.length > 0) {
          // Spheres separate during debate
          setIsDebating(true);
          console.log('[SendMessage] Starting debate playback, messages:', data.debate.length);
          
          // Play each debate message with audio so user hears the discussion
          // Use playAudioAndWait to ensure each message completes before the next
          for (let index = 0; index < data.debate.length; index++) {
            const msg = data.debate[index] as { agent: string; content: string; emotion?: string };
            
            console.log(`[SendMessage] Debate message ${index + 1}/${data.debate.length}:`, msg.agent);
            
            // Add message to UI
            const debateMessage: Message = {
              id: `${Date.now()}-debate-${index}`,
              role: msg.agent as Message['role'],
              content: msg.content,
              timestamp: new Date(),
              isDebate: true,
              emotion: msg.emotion,
            };
            setMessages(prev => [...prev, debateMessage]);
            
            // Save debate message to transcript
            saveTranscriptEntry(msg.content, 'mira', msg.agent.toUpperCase(), true);
            
            // Play audio for this debate message and WAIT for it to complete
            // This ensures spheres stay separated throughout the entire debate
            await playAudioAndWait(msg.content, msg.agent as AgentType);
            
            // Small pause between debate turns for natural flow
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          console.log('[SendMessage] Debate playback complete, delivering final response');
        }

        // Add final response
        const responseMessage: Message = {
          id: `${Date.now()}-response`,
          role: data.response.agent as Message['role'],
          content: data.response.content,
          timestamp: new Date(),
          emotion: data.response.emotion,
          isConsensus: data.consensus, // Mark if this is a consensus response
        };
        setMessages(prev => [...prev, responseMessage]);
        
        // Save MIRA response to transcript
        saveTranscriptEntry(data.response.content, 'mira', data.response.agent.toUpperCase(), true);

        // Spheres merge back ONLY when final agreed-upon response starts playing
        // This happens right before the final audio plays, so the merge animation
        // accompanies the unified MIRA response
        if (data.debate && data.debate.length > 0) {
          setIsDebating(false);
        }

        // Play final response audio - when consensus, this is MIRA speaking (spheres merge)
        console.log('[SendMessage] Playing final response from:', data.response.agent);
        await playAudio(data.response.content, data.response.agent as AgentType);
        console.log('[SendMessage] Complete!');
      } else {
        const errorText = await response.text();
        console.error('[SendMessage] API error:', response.status, errorText);
        throw new Error(`API error: ${response.status}`);
      }
    } catch (error) {
      console.error('[SendMessage] Error:', error);
      const errorMessage: Message = {
        id: `${Date.now()}-error`,
        role: 'system',
        content: 'Sorry, there was an error processing your message.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      console.log('[SendMessage] isLoading set to false');
    }
  }, [conversationId, visualContext, isLoading, playAudio, saveTranscriptEntry, pendingUnknownFace]);

  // Keep sendMessageRef in sync
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  // Recording controls (pause when AI is speaking)
  const startRecording = useCallback(() => {
    if (!isSpeaking && !isLoading) {
      startVoiceRecording();
    }
  }, [isSpeaking, isLoading, startVoiceRecording]);

  const stopRecording = useCallback(() => {
    stopVoiceRecording();
  }, [stopVoiceRecording]);

  // Auto-pause listening when AI is speaking to prevent feedback loop
  useEffect(() => {
    if (isSpeaking && isListening) {
      console.log('AI speaking, pausing voice listener');
      stopVoiceRecording();
    }
  }, [isSpeaking, isListening, stopVoiceRecording]);

  // Auto-resume listening after AI stops speaking (with cooldown)
  useEffect(() => {
    if (!isSpeaking && !isListening && isAuthenticated && mediaAutoStartedRef.current && !isLoading) {
      const cooldownTimer = setTimeout(() => {
        if (!isSpeaking && !isLoading) {
          console.log('AI done speaking, resuming voice listener');
          startVoiceRecording();
        }
      }, 1000); // 1 second cooldown to prevent echo pickup
      
      return () => clearTimeout(cooldownTimer);
    }
  }, [isSpeaking, isListening, isAuthenticated, isLoading, startVoiceRecording]);

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
    user,
    login,
    register,
    logout,

    // Conversation
    messages,
    conversationId,
    isLoading,
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
      isDebating,    // Media
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
  };

  return <MIRAContext.Provider value={value}>{children}</MIRAContext.Provider>;
}

export default MIRAProvider;