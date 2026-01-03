'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseLiveSpeechOptions {
  onTranscription?: (text: string, isFinal: boolean) => void;
  onInterimResult?: (text: string) => void;
  language?: string;
  continuous?: boolean;
}

// Extend Window interface for SpeechRecognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

// Mobile detection helper
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|MIRAAndroid/i.test(ua);
};

// Utterance completion delay (ms)
const UTTERANCE_COMPLETE_MS = 600;

export function useLiveSpeech(options: UseLiveSpeechOptions = {}) {
  const {
    onTranscription,
    onInterimResult,
    language = 'en-US',
    continuous = true,
  } = options;

  // Check for browser support
  const checkSupport = () => {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SpeechRecognition;
  };

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(checkSupport);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMobile] = useState(isMobileDevice);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptionRef = useRef(onTranscription);
  const onInterimResultRef = useRef(onInterimResult);
  const isListeningRef = useRef(false);
  const shouldBeListeningRef = useRef(false);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const initRecognitionRef = useRef<(() => SpeechRecognition | null) | null>(null);
  
  // Text accumulation
  const finalTextRef = useRef<string>('');
  const utteranceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Re-check support on mount
  useEffect(() => {
    setIsSupported(checkSupport());
  }, []);

  // Keep refs updated
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);

  useEffect(() => {
    onInterimResultRef.current = onInterimResult;
  }, [onInterimResult]);

  // Audio level monitoring
  const startAudioMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const checkLevel = () => {
        if (!analyserRef.current || !isListeningRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.fftSize);
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const amplitude = (dataArray[i] - 128) / 128;
          sum += amplitude * amplitude;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(1, rms * 4);
        setAudioLevel(level);

        if (isListeningRef.current) {
          animationFrameRef.current = requestAnimationFrame(checkLevel);
        }
      };

      checkLevel();
    } catch (error) {
      console.error('Error starting audio monitoring:', error);
    }
  }, []);

  const stopAudioMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // Helper to restart recognition
  const restartRecognition = useCallback(() => {
    if (!isListeningRef.current) return;
    
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        return;
      } catch {
        // Failed to start, will reinitialize below
      }
    }
    
    if (initRecognitionRef.current) {
      recognitionRef.current = initRecognitionRef.current();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Ignore - will retry on next attempt
        }
      }
    }
  }, []);

  // Initialize speech recognition
  const initRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = language;

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(finalTextRef.current + interim);
        if (onInterimResultRef.current) {
          onInterimResultRef.current(finalTextRef.current + interim);
        }
      }

      if (final) {
        // Accumulate final text
        finalTextRef.current += (finalTextRef.current ? ' ' : '') + final.trim();
        setInterimTranscript(finalTextRef.current);
        
        // Reset reconnect attempts on successful transcription
        reconnectAttemptsRef.current = 0;
        
        // Clear any existing timeout
        if (utteranceTimeoutRef.current) {
          clearTimeout(utteranceTimeoutRef.current);
        }
        
        // Check if sentence seems complete
        const text = finalTextRef.current.trim();
        const endsWithPunctuation = /[.!?]$/.test(text);
        
        // Shorter wait for complete sentences
        const waitTime = endsWithPunctuation ? 400 : UTTERANCE_COMPLETE_MS;
        
        utteranceTimeoutRef.current = setTimeout(() => {
          if (finalTextRef.current.trim() && onTranscriptionRef.current) {
            onTranscriptionRef.current(finalTextRef.current.trim(), true);
            finalTextRef.current = '';
            setInterimTranscript('');
          }
        }, waitTime);
      }
    };

    recognition.onerror = (event) => {
      const error = event.error;
      
      // "no-speech" is common - just means silence
      if (error === 'no-speech') {
        if (shouldBeListeningRef.current) {
          const delay = isMobile ? 10 : 50;
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, delay);
        }
        return;
      }
      
      // "aborted" means intentional stop
      if (error === 'aborted') {
        if (shouldBeListeningRef.current) {
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, 100);
        }
        return;
      }

      console.warn('Speech recognition error:', error);

      // Restart on recoverable errors
      if (shouldBeListeningRef.current && ['network', 'audio-capture', 'not-allowed', 'service-not-allowed'].includes(error)) {
        reconnectAttemptsRef.current++;
        
        if (reconnectAttemptsRef.current <= maxReconnectAttempts) {
          const baseDelay = isMobile ? 200 : 500;
          const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1), isMobile ? 5000 : 30000);
          console.log(`[Speech] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, delay);
        } else {
          console.error('[Speech] Max reconnect attempts reached');
          reconnectAttemptsRef.current = 0;
        }
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (shouldBeListeningRef.current) {
        const delay = isMobile ? 10 : 50;
        restartTimeoutRef.current = setTimeout(() => {
          restartRecognition();
        }, delay);
      } else {
        setIsListening(false);
      }
    };

    return recognition;
  }, [continuous, language, restartRecognition, isMobile]);

  // Store initRecognition in ref
  useEffect(() => {
    initRecognitionRef.current = initRecognition;
  }, [initRecognition]);

  // Start listening with native Web Speech API
  const startListening = useCallback(async () => {
    shouldBeListeningRef.current = true;
    reconnectAttemptsRef.current = 0;
    
    if (isListeningRef.current) {
      return;
    }

    console.log('[Speech] Starting native STT...', { isMobile });

    if (!isSupported) {
      console.warn('Web Speech API not supported in this browser.');
      return;
    }

    // Initialize recognition if needed
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }

    if (recognitionRef.current) {
      try {
        isListeningRef.current = true;
        recognitionRef.current.start();
        startAudioMonitoring();
        console.log('[Speech] Native STT started');
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        isListeningRef.current = false;
        
        // On mobile, retry after a delay
        if (isMobile && shouldBeListeningRef.current) {
          setTimeout(() => {
            if (shouldBeListeningRef.current) {
              startListening();
            }
          }, 1000);
        }
      }
    }
  }, [isSupported, initRecognition, startAudioMonitoring, isMobile]);

  // Stop listening
  const stopListening = useCallback(() => {
    console.log('[Speech] Stopping...');
    shouldBeListeningRef.current = false;
    isListeningRef.current = false;
    reconnectAttemptsRef.current = 0;
    setIsListening(false);
    setInterimTranscript('');
    
    // Clear utterance timeout and send accumulated text
    if (utteranceTimeoutRef.current) {
      clearTimeout(utteranceTimeoutRef.current);
      utteranceTimeoutRef.current = null;
    }
    if (finalTextRef.current.trim() && onTranscriptionRef.current) {
      onTranscriptionRef.current(finalTextRef.current.trim(), true);
    }
    finalTextRef.current = '';

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore errors when stopping
      }
    }

    stopAudioMonitoring();
  }, [stopAudioMonitoring]);

  // Handle visibility change - restart when app comes back
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (shouldBeListeningRef.current && !isListeningRef.current) {
          console.log('[Speech] App visible, restarting...');
          setTimeout(() => {
            if (shouldBeListeningRef.current && !isListeningRef.current) {
              if (recognitionRef.current) {
                recognitionRef.current = null;
              }
              startListening();
            }
          }, 300);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startListening]);

  // Handle window focus
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocus = () => {
      if (shouldBeListeningRef.current && !isListeningRef.current) {
        setTimeout(() => {
          if (shouldBeListeningRef.current && !isListeningRef.current) {
            startListening();
          }
        }, 200);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldBeListeningRef.current = false;
      isListeningRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      if (utteranceTimeoutRef.current) {
        clearTimeout(utteranceTimeoutRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
      stopAudioMonitoring();
    };
  }, [stopAudioMonitoring]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    audioLevel,
    startListening,
    stopListening,
  };
}

export default useLiveSpeech;
