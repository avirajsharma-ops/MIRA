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

export function useLiveSpeech(options: UseLiveSpeechOptions = {}) {
  const {
    onTranscription,
    onInterimResult,
    language = 'en-US',
    continuous = true,
  } = options;

  // Check for browser support - do this synchronously in initial state
  const checkSupport = () => {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SpeechRecognition;
  };

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(checkSupport);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptionRef = useRef(onTranscription);
  const onInterimResultRef = useRef(onInterimResult);
  const isListeningRef = useRef(false);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const initRecognitionRef = useRef<(() => SpeechRecognition | null) | null>(null);

  // Re-check support on mount (for SSR hydration)
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

  // Helper function to restart recognition - stored in ref to avoid dependency issues
  const restartRecognition = useCallback(() => {
    if (!isListeningRef.current) return;
    
    // Clear any existing restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    // Try to restart existing recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        return;
      } catch {
        // Failed to start, will reinitialize below
      }
    }
    
    // Reinitialize if needed
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
        setInterimTranscript(interim);
        if (onInterimResultRef.current) {
          onInterimResultRef.current(interim);
        }
      }

      if (final) {
        setInterimTranscript('');
        if (onTranscriptionRef.current) {
          onTranscriptionRef.current(final.trim(), true);
        }
      }
    };

    recognition.onerror = (event) => {
      const error = event.error;
      
      // "no-speech" is very common - just means silence was detected
      // Silently restart without logging
      if (error === 'no-speech') {
        if (isListeningRef.current) {
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, 50);
        }
        return;
      }
      
      // "aborted" means intentional stop
      if (error === 'aborted') {
        return;
      }

      // Log other errors
      console.warn('Speech recognition error:', error);

      // Restart on recoverable errors
      if (isListeningRef.current && (error === 'network' || error === 'audio-capture' || error === 'not-allowed')) {
        restartTimeoutRef.current = setTimeout(() => {
          restartRecognition();
        }, 1000);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (isListeningRef.current) {
        restartTimeoutRef.current = setTimeout(() => {
          restartRecognition();
        }, 50);
      } else {
        setIsListening(false);
      }
    };

    return recognition;
  }, [continuous, language, restartRecognition]);

  // Store initRecognition in ref so restartRecognition can access it
  useEffect(() => {
    initRecognitionRef.current = initRecognition;
  }, [initRecognition]);

  // Start listening
  const startListening = useCallback(() => {
    if (!isSupported) {
      console.warn('Web Speech API not supported in this browser. Voice input disabled.');
      return;
    }

    if (isListeningRef.current) {
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
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        isListeningRef.current = false;
      }
    }
  }, [isSupported, initRecognition, startAudioMonitoring]);

  // Stop listening
  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
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
