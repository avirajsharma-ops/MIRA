'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMicrophoneLevelOptions {
  /** Whether to start monitoring immediately */
  autoStart?: boolean;
  /** Smoothing factor for audio level (0-1, higher = smoother) */
  smoothing?: number;
  /** External media stream to use (to avoid conflicts with Web Speech API) */
  externalStream?: MediaStream | null;
  /** Callback when mic fails */
  onMicError?: (error: string) => void;
  /** Callback when mic recovers */
  onMicRecover?: () => void;
}

interface UseMicrophoneLevelResult {
  /** Current audio level (0-1) */
  level: number;
  /** Start monitoring the microphone */
  startMonitoring: () => Promise<void>;
  /** Stop monitoring the microphone */
  stopMonitoring: () => void;
  /** Whether currently monitoring */
  isMonitoring: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Whether mic has failed and needs recovery */
  needsRecovery: boolean;
  /** Attempt to recover the microphone */
  attemptRecovery: () => Promise<boolean>;
}

// Singleton for shared microphone stream across hooks
let sharedMicStream: MediaStream | null = null;
let sharedStreamRefCount = 0;
let isAcquiringStream = false;
let streamAcquisitionPromise: Promise<MediaStream | null> | null = null;

async function acquireSharedMicStream(): Promise<MediaStream | null> {
  // If already acquiring, wait for the existing promise
  if (isAcquiringStream && streamAcquisitionPromise) {
    return streamAcquisitionPromise;
  }
  
  // If stream exists and is active, reuse it
  if (sharedMicStream && sharedMicStream.active) {
    sharedStreamRefCount++;
    return sharedMicStream;
  }
  
  isAcquiringStream = true;
  streamAcquisitionPromise = (async () => {
    try {
      console.log('[SharedMic] Acquiring shared microphone stream');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      sharedMicStream = stream;
      sharedStreamRefCount = 1;
      
      // Monitor for track ending
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          console.log('[SharedMic] Track ended, clearing shared stream');
          sharedMicStream = null;
          sharedStreamRefCount = 0;
        };
      });
      
      console.log('[SharedMic] Acquired shared stream successfully');
      return stream;
    } catch (err) {
      console.error('[SharedMic] Failed to acquire stream:', err);
      return null;
    } finally {
      isAcquiringStream = false;
      streamAcquisitionPromise = null;
    }
  })();
  
  return streamAcquisitionPromise;
}

function releaseSharedMicStream() {
  sharedStreamRefCount--;
  if (sharedStreamRefCount <= 0 && sharedMicStream) {
    console.log('[SharedMic] Releasing shared stream (no more users)');
    sharedMicStream.getTracks().forEach(track => track.stop());
    sharedMicStream = null;
    sharedStreamRefCount = 0;
  }
}

/**
 * Simple hook for monitoring microphone audio level without WebRTC.
 * Used for visual feedback (sphere animation) in resting state.
 * Uses a shared microphone stream to avoid conflicts with Web Speech API.
 */
export function useMicrophoneLevel({
  autoStart = false,
  smoothing = 0.3,
  externalStream,
  onMicError,
  onMicRecover,
}: UseMicrophoneLevelOptions = {}): UseMicrophoneLevelResult {
  const [level, setLevel] = useState(0);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  const levelRef = useRef(0);
  const recoveryAttemptRef = useRef(0);
  const lastRecoveryTimeRef = useRef(0);
  const usedSharedStreamRef = useRef(false);
  const lastSetLevelTimeRef = useRef(0);

  const stopMonitoring = useCallback(() => {
    isActiveRef.current = false;
    setIsMonitoring(false);
    
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Release shared stream reference (don't stop tracks - other users may need it)
    if (usedSharedStreamRef.current) {
      releaseSharedMicStream();
      usedSharedStreamRef.current = false;
    } else if (streamRef.current) {
      // Only stop if we created our own stream
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    streamRef.current = null;
    
    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    setLevel(0);
    levelRef.current = 0;
  }, []);

  const startMonitoring = useCallback(async () => {
    // Prevent double start
    if (isActiveRef.current) {
      console.log('[MicLevel] Already monitoring');
      return;
    }
    
    setError(null);
    setNeedsRecovery(false);
    
    try {
      // Use external stream, shared stream, or get new one
      let stream: MediaStream | null = null;
      
      if (externalStream && externalStream.active) {
        console.log('[MicLevel] Using external stream');
        stream = externalStream;
        usedSharedStreamRef.current = false;
      } else {
        // Use shared stream to avoid conflicts with Web Speech API
        stream = await acquireSharedMicStream();
        usedSharedStreamRef.current = true;
      }
      
      if (!stream || !stream.active) {
        throw new Error('Failed to get active microphone stream');
      }
      
      streamRef.current = stream;
      
      // Set up audio context and analyser
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = smoothing;
      analyserRef.current = analyser;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      isActiveRef.current = true;
      setIsMonitoring(true);
      
      // Clear recovery state on success
      recoveryAttemptRef.current = 0;
      
      console.log('[MicLevel] Started microphone monitoring');
      onMicRecover?.();
      
      // Start level monitoring loop with error detection
      let lastLevel = 0;
      let consecutiveZeroFrames = 0;
      const MAX_ZERO_FRAMES = 300; // ~5 seconds at 60fps
      
      const updateLevel = () => {
        if (!isActiveRef.current || !analyserRef.current) {
          return;
        }
        
        try {
          // Check if stream is still active
          if (!streamRef.current?.active) {
            console.warn('[MicLevel] Stream became inactive');
            handleMicFailure('Microphone stream became inactive');
            return;
          }
          
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Calculate RMS for smooth level
          const sumSquares = dataArray.reduce((sum, val) => sum + val * val, 0);
          const rms = Math.sqrt(sumSquares / dataArray.length);
          const normalized = Math.min(1, rms / 80);
          
          // Detect prolonged silence (might indicate mic failure)
          if (normalized < 0.001) {
            consecutiveZeroFrames++;
            if (consecutiveZeroFrames >= MAX_ZERO_FRAMES) {
              // Reset counter to avoid spamming
              consecutiveZeroFrames = 0;
              // Don't treat as failure - could be quiet environment
              // Just log for debugging
              console.log('[MicLevel] Extended silence detected (normal if quiet)');
            }
          } else {
            consecutiveZeroFrames = 0;
          }
          
          // Smooth transitions - fast attack, slow decay
          if (normalized > lastLevel) {
            lastLevel = lastLevel * 0.3 + normalized * 0.7; // Fast attack
          } else {
            lastLevel = lastLevel * 0.85 + normalized * 0.15; // Slow decay
          }
          
          levelRef.current = lastLevel;
          
          // Throttle setLevel calls to every 50ms to prevent max update depth
          const now = Date.now();
          if (now - lastSetLevelTimeRef.current >= 50) {
            lastSetLevelTimeRef.current = now;
            setLevel(lastLevel);
          }
        } catch (err) {
          console.error('[MicLevel] Error reading level:', err);
          handleMicFailure('Error reading microphone data');
          return;
        }
        
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
      
    } catch (err) {
      console.error('[MicLevel] Error starting monitoring:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(errorMsg);
      setIsMonitoring(false);
      setNeedsRecovery(true);
      isActiveRef.current = false;
      onMicError?.(errorMsg);
    }
  }, [smoothing, externalStream, onMicError, onMicRecover]);
  
  // Handle mic failure with recovery
  const handleMicFailure = useCallback((reason: string) => {
    console.warn('[MicLevel] Mic failure:', reason);
    setError(reason);
    setNeedsRecovery(true);
    setIsMonitoring(false);
    isActiveRef.current = false;
    onMicError?.(reason);
    
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [onMicError]);
  
  // Attempt to recover microphone
  const attemptRecovery = useCallback(async (): Promise<boolean> => {
    const now = Date.now();
    const timeSinceLastRecovery = now - lastRecoveryTimeRef.current;
    
    // Debounce recovery attempts (min 2 seconds between attempts)
    if (timeSinceLastRecovery < 2000) {
      console.log('[MicLevel] Recovery attempt too soon, waiting...');
      return false;
    }
    
    // Limit recovery attempts (max 5 attempts, then require manual intervention)
    if (recoveryAttemptRef.current >= 5) {
      console.warn('[MicLevel] Max recovery attempts reached');
      setError('Microphone failed repeatedly. Please check your microphone and refresh the page.');
      return false;
    }
    
    lastRecoveryTimeRef.current = now;
    recoveryAttemptRef.current++;
    
    console.log(`[MicLevel] Attempting recovery (attempt ${recoveryAttemptRef.current}/5)`);
    
    // Clean up existing resources
    stopMonitoring();
    
    // Clear shared stream to force new acquisition
    if (sharedMicStream) {
      sharedMicStream.getTracks().forEach(track => track.stop());
      sharedMicStream = null;
      sharedStreamRefCount = 0;
    }
    
    // Wait a moment before retrying
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Try to start monitoring again
    try {
      await startMonitoring();
      return isActiveRef.current;
    } catch {
      return false;
    }
  }, [stopMonitoring, startMonitoring]);

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart) {
      startMonitoring();
    }
    
    return () => {
      stopMonitoring();
    };
  }, [autoStart, startMonitoring, stopMonitoring]);

  return {
    level,
    startMonitoring,
    stopMonitoring,
    isMonitoring,
    error,
    needsRecovery,
    attemptRecovery,
  };
}
