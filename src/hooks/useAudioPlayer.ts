'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type AgentType = 'mi' | 'ra' | 'mira';

interface UseAudioPlayerOptions {
  onSpeakingStart?: (agent: AgentType, text: string) => void;
  onSpeakingEnd?: (agent: AgentType) => void;
  onInterrupted?: (interruptionText: string, lastSpokenText: string) => void;
}

// Thinking sounds - ULTRA SHORT for instant loading
// These must be < 1 second to speak
const THINKING_SOUNDS = [
  'Hmm',
  'Okay',
  'Mmm',
  'Alright',
  'Right',
  'Sure',
  'Yep',
  'Oh',
  'Ah',
  'Well',
  'So',
  'Yes',
  'Cool',
  'Nice',
  'Great',
];

// Pre-cached thinking sounds (loaded on init)
const thinkingSoundCache = new Map<string, Blob>();
let thinkingSoundsPreloaded = false;

// Audio preloading cache for faster playback
const audioCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 20;

// iOS/Safari audio unlock - must be called on user interaction
let audioUnlocked = false;
let audioContext: AudioContext | null = null;

function unlockAudioContext() {
  if (audioUnlocked) return Promise.resolve();
  
  return new Promise<void>((resolve) => {
    try {
      // Create and resume AudioContext
      if (!audioContext) {
        audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
          audioUnlocked = true;
          console.log('[Audio] iOS audio context unlocked via resume');
          resolve();
        });
      } else {
        audioUnlocked = true;
        resolve();
      }
      
      // Play a silent buffer to unlock audio on iOS
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
      
      // Also create and play a silent Audio element
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.volume = 0.01;
      silentAudio.play().catch(() => {});
      
      console.log('[Audio] iOS audio context unlocked');
    } catch (e) {
      console.log('[Audio] Failed to unlock audio context:', e);
      resolve();
    }
  });
}

// Initialize audio unlock on first user interaction (required for iOS/Safari)
if (typeof window !== 'undefined') {
  const unlockEvents = ['touchstart', 'touchend', 'mousedown', 'keydown', 'click'];
  const handleUnlock = () => {
    unlockAudioContext();
    // Remove listeners after first interaction
    unlockEvents.forEach(event => {
      document.removeEventListener(event, handleUnlock, true);
    });
  };
  unlockEvents.forEach(event => {
    document.addEventListener(event, handleUnlock, true);
  });
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const { onSpeakingStart, onSpeakingEnd, onInterrupted } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AgentType | null>(null);
  const [queue, setQueue] = useState<{ text: string; agent: AgentType }[]>([]);
  const [ttsAudioLevel, setTtsAudioLevel] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const thinkingAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const currentAudioUrlRef = useRef<string | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastSpokenTextRef = useRef<string>('');
  const lastPlayedTextRef = useRef<string>(''); // Prevent duplicate playback
  const lastPlayedTimeRef = useRef<number>(0);
  const onInterruptedRef = useRef(onInterrupted);
  const fetchControllerRef = useRef<AbortController | null>(null);
  
  // Keep callback ref updated
  onInterruptedRef.current = onInterrupted;

  // Cleanup audio level monitoring
  const cleanupAudioAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setTtsAudioLevel(0);
  }, []);

  // Cleanup function for audio resources
  const cleanupAudio = useCallback(() => {
    cleanupAudioAnalysis();
    
    // Cancel any pending fetch
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.src = '';
      audioRef.current.load(); // Reset the audio element
      audioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    playPromiseRef.current = null;
  }, [cleanupAudioAnalysis]);

  // Start audio level monitoring for TTS playback (with improved handling)
  const startAudioAnalysis = useCallback((audio: HTMLAudioElement) => {
    try {
      // Create audio context if needed (reuse existing)
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioContext = audioContextRef.current;
      
      // Resume if suspended
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      
      // Only create source node if not already connected
      if (!sourceNodeRef.current) {
        try {
          const source = audioContext.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
          sourceNodeRef.current = source;
        } catch (e) {
          // Audio element may already be connected - use simulated levels
          console.log('[Audio] Using simulated levels (element already connected)');
        }
      } else {
        // Reconnect existing source
        sourceNodeRef.current.connect(analyser);
        analyser.connect(audioContext.destination);
      }
      
      // Monitor audio levels
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const checkLevel = () => {
        if (!analyserRef.current || !isPlayingRef.current) {
          setTtsAudioLevel(0);
          return;
        }
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Calculate average level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const level = Math.min(1, average / 128); // Normalize to 0-1
        
        setTtsAudioLevel(level);
        
        if (isPlayingRef.current) {
          animationFrameRef.current = requestAnimationFrame(checkLevel);
        }
      };
      
      checkLevel();
    } catch (error) {
      // Audio analysis not supported, fall back to simulated levels
      console.log('[Audio] Audio analysis not available, using simulated levels');
      
      // Simulate audio levels based on time
      const simulateLevel = () => {
        if (!isPlayingRef.current) {
          setTtsAudioLevel(0);
          return;
        }
        // Create a dynamic simulation with some variation
        const time = Date.now() * 0.01;
        const level = 0.4 + Math.sin(time) * 0.2 + Math.sin(time * 2.3) * 0.15 + Math.random() * 0.1;
        setTtsAudioLevel(Math.min(1, Math.max(0, level)));
        
        if (isPlayingRef.current) {
          animationFrameRef.current = requestAnimationFrame(simulateLevel);
        }
      };
      
      simulateLevel();
    }
  }, []);

  const playAudio = useCallback(async (text: string, agent: AgentType) => {
    if (!text) return;

    // Ensure audio is unlocked on iOS/Safari
    await unlockAudioContext();

    // Prevent duplicate playback of same text within 2 seconds
    const now = Date.now();
    if (text === lastPlayedTextRef.current && (now - lastPlayedTimeRef.current) < 2000) {
      console.log('[Audio] Blocked duplicate playback of:', text.substring(0, 50) + '...');
      return;
    }
    lastPlayedTextRef.current = text;
    lastPlayedTimeRef.current = now;

    // Add to queue if already playing
    if (isPlayingRef.current) {
      // Also check queue to prevent adding same text
      setQueue(prev => {
        if (prev.some(item => item.text === text)) {
          console.log('[Audio] Blocked duplicate queue add:', text.substring(0, 50) + '...');
          return prev;
        }
        return [...prev, { text, agent }];
      });
      return;
    }

    // Stop thinking sound when starting to speak
    if (thinkingAudioRef.current) {
      thinkingAudioRef.current.pause();
      thinkingAudioRef.current = null;
      setIsThinking(false);
    }

    // Track what's being spoken (for interruption context)
    lastSpokenTextRef.current = text;

    // For MIRA responses, use MI's voice (no overlapping voices)
    const voiceToUse = agent === 'mira' ? 'mi' : agent;

    isPlayingRef.current = true;
    setIsPlaying(true);
    setCurrentAgent(agent);
    onSpeakingStart?.(agent, text); // Pass text for echo detection

    try {
      // Stop any previous audio first to prevent AbortError
      cleanupAudio();

      const token = localStorage.getItem('mira_token');
      
      // Create cache key
      const cacheKey = `${voiceToUse}:${text}`;
      
      // Check cache first for faster playback
      if (audioCache.has(cacheKey)) {
        console.log('[Audio] Using cached audio');
        const audioBlob = audioCache.get(cacheKey)!;
        const audioUrl = URL.createObjectURL(audioBlob);
        currentAudioUrlRef.current = audioUrl;
        
        const audio = new Audio();
        audioRef.current = audio;
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        
        audio.onended = () => {
          cleanupAudio();
          isPlayingRef.current = false;
          setIsPlaying(false);
          onSpeakingEnd?.(agent);
          setCurrentAgent(null);
          setQueue(prev => {
            if (prev.length > 0) {
              const [next, ...rest] = prev;
              setTimeout(() => playAudio(next.text, next.agent), 30);
              return rest;
            }
            return prev;
          });
        };
        
        audio.onerror = () => {
          cleanupAudio();
          isPlayingRef.current = false;
          setIsPlaying(false);
          onSpeakingEnd?.(agent);
          setCurrentAgent(null);
        };
        
        audio.src = audioUrl;
        startAudioAnalysis(audio);
        await audio.play();
        return;
      }
      
      // Create abort controller for this fetch
      fetchControllerRef.current = new AbortController();
      
      console.log('[Audio] Fetching TTS for immediate playback...');
      const fetchStart = Date.now();
      
      // Fetch with streaming - start playing as soon as we have enough data
      const response = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text, voice: voiceToUse }),
        signal: fetchControllerRef.current.signal,
      });

      if (!response.ok) throw new Error('TTS failed');

      console.log(`[Audio] TTS response received in ${Date.now() - fetchStart}ms`);

      // Get the response as a blob for audio playback
      const audioBlob = await response.blob();
      
      console.log(`[Audio] Audio blob ready in ${Date.now() - fetchStart}ms, size: ${audioBlob.size}`);
      
      // Cache the audio for future use
      if (audioCache.size >= MAX_CACHE_SIZE) {
        const firstKey = audioCache.keys().next().value;
        if (firstKey) audioCache.delete(firstKey);
      }
      audioCache.set(cacheKey, audioBlob);
      
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrlRef.current = audioUrl;

      const audio = new Audio();
      audioRef.current = audio;
      
      // iOS/Safari specific: Set attributes for better compatibility
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');

      // Set up event handlers before setting src
      audio.onended = () => {
        console.log('[Audio] Playback ended');
        cleanupAudio();
        isPlayingRef.current = false;
        setIsPlaying(false);
        onSpeakingEnd?.(agent);
        setCurrentAgent(null);

        // Play next in queue
        setQueue(prev => {
          if (prev.length > 0) {
            const [next, ...rest] = prev;
            setTimeout(() => playAudio(next.text, next.agent), 30);
            return rest;
          }
          return prev;
        });
      };

      audio.onerror = (e) => {
        console.log('[Audio] Playback error:', e);
        cleanupAudio();
        isPlayingRef.current = false;
        setIsPlaying(false);
        onSpeakingEnd?.(agent);
        setCurrentAgent(null);
      };

      // Set src and start playing IMMEDIATELY - don't wait for canplaythrough
      audio.preload = 'auto';
      audio.src = audioUrl;

      // Start audio level analysis
      startAudioAnalysis(audio);

      // Start playing immediately without waiting for full buffer
      console.log(`[Audio] Starting playback immediately at ${Date.now() - fetchStart}ms`);
      playPromiseRef.current = audio.play();
      await playPromiseRef.current;
      
    } catch (error) {
      // Ignore AbortError - it's expected when audio is interrupted
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      // Ignore other expected errors silently
      if (error instanceof Error && (error.message === 'Audio load error' || error.name === 'NotAllowedError')) {
        return;
      }
      console.error('[Audio] Error playing audio:', error);
      cleanupAudio();
      isPlayingRef.current = false;
      setIsPlaying(false);
      onSpeakingEnd?.(agent);
      setCurrentAgent(null);
    }
  }, [onSpeakingStart, onSpeakingEnd, cleanupAudio, startAudioAnalysis]);

  const stopAudio = useCallback(async () => {
    // Wait for any pending play() promise before stopping
    if (playPromiseRef.current) {
      try {
        await playPromiseRef.current;
      } catch {
        // Ignore any errors from the pending play
      }
    }
    cleanupAudio();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentAgent(null);
    setQueue([]);
  }, [cleanupAudio]);

  // Interrupt current audio with user speech - captures what was said and last AI text
  const interruptAudio = useCallback(async (interruptionText: string) => {
    if (!isPlayingRef.current) return;
    
    const lastSpoken = lastSpokenTextRef.current;
    
    // Stop the current audio
    await stopAudio();
    
    // Notify about the interruption
    if (onInterruptedRef.current && interruptionText.trim()) {
      onInterruptedRef.current(interruptionText.trim(), lastSpoken);
    }
  }, [stopAudio]);

  // Pre-load thinking sounds for instant playback
  const preloadThinkingSounds = useCallback(async () => {
    if (thinkingSoundsPreloaded) return;
    
    const token = localStorage.getItem('mira_token');
    if (!token) return;
    
    console.log('[Audio] Pre-loading thinking sounds...');
    const startTime = Date.now();
    
    // Load first 5 thinking sounds in parallel (most common ones)
    const soundsToPreload = THINKING_SOUNDS.slice(0, 5);
    
    try {
      await Promise.all(soundsToPreload.map(async (text) => {
        try {
          const response = await fetch('/api/tts/stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ text, voice: 'mi' }),
          });
          
          if (response.ok) {
            const blob = await response.blob();
            thinkingSoundCache.set(text, blob);
          }
        } catch {
          // Ignore individual failures
        }
      }));
      
      thinkingSoundsPreloaded = true;
      console.log(`[Audio] Pre-loaded ${thinkingSoundCache.size} thinking sounds in ${Date.now() - startTime}ms`);
    } catch {
      console.log('[Audio] Failed to pre-load thinking sounds');
    }
  }, []);

  // Play a short thinking sound - NON-BLOCKING, fire and forget
  // Does NOT wait for sound to complete - response plays immediately after
  const playThinkingSound = useCallback((): void => {
    // Don't play if already playing something
    if (isPlayingRef.current) return;
    
    setIsThinking(true);
    
    const thinkingText = THINKING_SOUNDS[Math.floor(Math.random() * THINKING_SOUNDS.length)];
    console.log('[Audio] Playing thinking sound:', thinkingText);
    
    // Check pre-loaded cache first for INSTANT playback
    const cachedBlob = thinkingSoundCache.get(thinkingText);
    
    if (cachedBlob) {
      // INSTANT playback from cache
      console.log('[Audio] Using pre-cached thinking sound (instant)');
      const audioUrl = URL.createObjectURL(cachedBlob);
      const audio = new Audio();
      thinkingAudioRef.current = audio;
      
      audio.onended = () => {
        setIsThinking(false);
        URL.revokeObjectURL(audioUrl);
        thinkingAudioRef.current = null;
      };
      
      audio.onerror = () => {
        setIsThinking(false);
        URL.revokeObjectURL(audioUrl);
        thinkingAudioRef.current = null;
      };
      
      audio.src = audioUrl;
      audio.volume = 0.7;
      audio.play().catch(() => setIsThinking(false));
      return;
    }
    
    // Fallback: Fetch on demand (slower, but don't block)
    const token = localStorage.getItem('mira_token');
    
    fetch('/api/tts/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: thinkingText, voice: 'mi' }),
    })
      .then(response => {
        if (!response.ok) throw new Error('TTS failed');
        return response.blob();
      })
      .then(audioBlob => {
        // Cache for next time
        thinkingSoundCache.set(thinkingText, audioBlob);
        
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio();
        thinkingAudioRef.current = audio;
        
        audio.onended = () => {
          setIsThinking(false);
          URL.revokeObjectURL(audioUrl);
          thinkingAudioRef.current = null;
        };
        
        audio.onerror = () => {
          setIsThinking(false);
          URL.revokeObjectURL(audioUrl);
          thinkingAudioRef.current = null;
        };
        
        audio.src = audioUrl;
        audio.volume = 0.7;
        audio.play().catch(() => setIsThinking(false));
      })
      .catch(() => {
        setIsThinking(false);
      });
  }, []);

  // Legacy function for backward compatibility - now just calls playThinkingSound
  const playThinkingAndQueueResponse = useCallback(async (
    responsePromise: Promise<{ text: string; agent: AgentType } | null>
  ): Promise<void> => {
    // Start thinking sound (non-blocking)
    playThinkingSound();
    
    // Wait for response (don't wait for thinking sound)
    const response = await responsePromise;
    
    // Play the response immediately
    if (response && response.text) {
      await playAudio(response.text, response.agent);
    }
  }, [playThinkingSound, playAudio]);

  // Stop thinking sound (e.g., when response is ready)
  const stopThinkingSound = useCallback(() => {
    if (thinkingAudioRef.current) {
      thinkingAudioRef.current.pause();
      thinkingAudioRef.current = null;
    }
    setIsThinking(false);
  }, []);

  // Play audio and wait for it to complete (useful for sequential playback like debates)
  const playAudioAndWait = useCallback(async (text: string, agent: AgentType): Promise<void> => {
    if (!text) return;

    // Wait for any currently playing audio to finish first
    while (isPlayingRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Now play our audio
    await playAudio(text, agent);

    // Wait for this audio to complete
    while (isPlayingRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, [playAudio]);

  const playDebateSequence = useCallback(async (
    messages: { agent: AgentType; content: string }[]
  ) => {
    for (const msg of messages) {
      await new Promise<void>((resolve) => {
        const checkQueue = setInterval(() => {
          if (!isPlayingRef.current) {
            clearInterval(checkQueue);
            resolve();
          }
        }, 100);
      });
      await playAudio(msg.content, msg.agent);
    }
  }, [playAudio]);

  // Manually initialize audio (call on user interaction for iOS)
  const initAudio = useCallback(() => {
    unlockAudioContext();
    // Pre-load thinking sounds on first user interaction
    preloadThinkingSounds();
  }, [preloadThinkingSounds]);

  return {
    isPlaying,
    isThinking,
    currentAgent,
    queue,
    ttsAudioLevel,
    playAudio,
    playAudioAndWait,
    stopAudio,
    playDebateSequence,
    playThinkingSound,
    playThinkingAndQueueResponse,
    stopThinkingSound,
    interruptAudio,
    initAudio,
    preloadThinkingSounds,
  };
}

// Export the unlock function for manual initialization
export { unlockAudioContext as initializeAudio };

export default useAudioPlayer;
