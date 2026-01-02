'use client';

import { useState, useCallback, useRef } from 'react';

type AgentType = 'mi' | 'ra' | 'mira';

interface UseAudioPlayerOptions {
  onSpeakingStart?: (agent: AgentType, text: string) => void;
  onSpeakingEnd?: (agent: AgentType) => void;
  onInterrupted?: (interruptionText: string, lastSpokenText: string) => void;
}

// Thinking sounds - short "hmm" variations
const THINKING_SOUNDS = [
  'hmm',
  'let me think',
  'mmm',
];

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
  const animationFrameRef = useRef<number | null>(null);
  const lastSpokenTextRef = useRef<string>('');
  const onInterruptedRef = useRef(onInterrupted);
  
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

  // Start audio level monitoring for TTS playback
  const startAudioAnalysis = useCallback((audio: HTMLAudioElement) => {
    try {
      // Create audio context if needed
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioContext = audioContextRef.current;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      // Connect audio element to analyser
      const source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      
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
      console.log('Audio analysis not available, using simulated levels');
      
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

    // Add to queue if already playing
    if (isPlayingRef.current) {
      setQueue(prev => [...prev, { text, agent }]);
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

      // Use streaming endpoint for faster playback
      const response = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text, voice: voiceToUse }),
      });

      if (!response.ok) throw new Error('TTS failed');

      // Create a MediaSource for streaming playback
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrlRef.current = audioUrl;

      const audio = new Audio();
      audioRef.current = audio;

      // Set up event handlers before setting src
      audio.onended = () => {
        cleanupAudio();
        isPlayingRef.current = false;
        setIsPlaying(false);
        onSpeakingEnd?.(agent);
        setCurrentAgent(null);

        // Play next in queue
        setQueue(prev => {
          if (prev.length > 0) {
            const [next, ...rest] = prev;
            setTimeout(() => playAudio(next.text, next.agent), 50);
            return rest;
          }
          return prev;
        });
      };

      audio.onerror = () => {
        // Silently handle errors - AbortError is expected when stopping audio
        cleanupAudio();
        isPlayingRef.current = false;
        setIsPlaying(false);
        onSpeakingEnd?.(agent);
        setCurrentAgent(null);
      };

      // Set src and preload
      audio.preload = 'auto';
      audio.src = audioUrl;

      // Wait for audio to be ready before playing
      await new Promise<void>((resolve, reject) => {
        audio.oncanplaythrough = () => resolve();
        audio.onerror = () => reject(new Error('Audio load error'));
        // Timeout after 10 seconds
        setTimeout(() => resolve(), 10000);
      });

      // Check if audio element is still valid (not cleaned up)
      if (audioRef.current !== audio) {
        return;
      }

      // Start audio level analysis for voice distortion effect
      startAudioAnalysis(audio);

      // Start playing and store the promise
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
      console.error('Error playing audio:', error);
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

  // Play a short thinking sound while AI processes
  const playThinkingSound = useCallback(async () => {
    // Don't play if already playing something
    if (isPlayingRef.current) return;
    
    setIsThinking(true);
    
    try {
      const token = localStorage.getItem('mira_token');
      const thinkingText = THINKING_SOUNDS[Math.floor(Math.random() * THINKING_SOUNDS.length)];
      
      const response = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: thinkingText, voice: 'mi' }),
      });

      if (!response.ok) {
        setIsThinking(false);
        return;
      }

      const audioBlob = await response.blob();
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
      audio.volume = 0.6; // Slightly quieter for thinking sound
      await audio.play();
    } catch {
      setIsThinking(false);
    }
  }, []);

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
    stopThinkingSound,
    interruptAudio,
  };
}

export default useAudioPlayer;
