'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseLiveSpeechOptions {
  onTranscription?: (text: string, isFinal: boolean) => void;
  onInterimResult?: (text: string) => void;
  language?: string;
  continuous?: boolean;
}

// Deepgram configuration for ultra-low latency
const DEEPGRAM_CONFIG = {
  model: 'nova-2', // Fast and accurate
  language: 'en-US',
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1000, // End utterance detection
  vad_events: true, // Voice activity detection
  endpointing: 300, // 300ms silence = end of speech (fast!)
  encoding: 'linear16',
  sample_rate: 16000,
};

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
  const [useDeepgram, setUseDeepgram] = useState(false);
  const [deepgramReady, setDeepgramReady] = useState(false);
  const [isMobile] = useState(isMobileDevice);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptionRef = useRef(onTranscription);
  const onInterimResultRef = useRef(onInterimResult);
  const isListeningRef = useRef(false);
  const shouldBeListeningRef = useRef(false); // Track intent to listen (for reconnection)
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const initRecognitionRef = useRef<(() => SpeechRecognition | null) | null>(null);
  
  // Sentence accumulation refs - wait for complete sentences before sending
  const accumulatedTextRef = useRef<string>('');
  const sentenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const SENTENCE_WAIT_MS = 1500; // Wait 1.5 seconds of silence before considering sentence complete
  
  // Deepgram refs
  const deepgramSocketRef = useRef<WebSocket | null>(null);
  const deepgramApiKeyRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Fetch Deepgram API key on mount
  useEffect(() => {
    const fetchDeepgramKey = async () => {
      try {
        const token = localStorage.getItem('mira_token');
        if (!token) return;
        
        const response = await fetch('/api/stt/token', {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (response.ok) {
          const { apiKey } = await response.json();
          if (apiKey) {
            deepgramApiKeyRef.current = apiKey;
            setUseDeepgram(true);
            setDeepgramReady(true);
            console.log('🎤 Deepgram STT ready - ultra-low latency enabled');
          }
        }
      } catch (error) {
        console.warn('Deepgram not available, using Web Speech API fallback');
      }
    };
    
    fetchDeepgramKey();
  }, []);

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
        setInterimTranscript(accumulatedTextRef.current + interim);
        if (onInterimResultRef.current) {
          onInterimResultRef.current(accumulatedTextRef.current + interim);
        }
      }

      if (final) {
        // Accumulate final text instead of sending immediately
        accumulatedTextRef.current += (accumulatedTextRef.current ? ' ' : '') + final.trim();
        setInterimTranscript(accumulatedTextRef.current);
        
        // Reset reconnect attempts on successful transcription
        reconnectAttemptsRef.current = 0;
        
        // Clear any existing timeout
        if (sentenceTimeoutRef.current) {
          clearTimeout(sentenceTimeoutRef.current);
        }
        
        // Check if sentence seems complete (ends with punctuation or is long enough)
        const text = accumulatedTextRef.current.trim();
        const endsWithPunctuation = /[.!?]$/.test(text);
        const isLongEnough = text.split(' ').length >= 8; // At least 8 words
        
        // If sentence seems complete, send after a shorter delay
        // Otherwise wait for the full timeout
        const waitTime = endsWithPunctuation ? 800 : SENTENCE_WAIT_MS;
        
        sentenceTimeoutRef.current = setTimeout(() => {
          if (accumulatedTextRef.current.trim() && onTranscriptionRef.current) {
            onTranscriptionRef.current(accumulatedTextRef.current.trim(), true);
            accumulatedTextRef.current = '';
            setInterimTranscript('');
          }
        }, waitTime);
      }
    };

    recognition.onerror = (event) => {
      const error = event.error;
      
      // "no-speech" is very common - just means silence was detected
      // Silently restart without logging
      if (error === 'no-speech') {
        if (shouldBeListeningRef.current) {
          // On mobile, use longer delay to prevent rapid cycling
          const delay = isMobile ? 200 : 50;
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, delay);
        }
        return;
      }
      
      // "aborted" means intentional stop
      if (error === 'aborted') {
        // On mobile, check if we should restart after abort
        if (shouldBeListeningRef.current && isMobile) {
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, 500);
        }
        return;
      }

      // Log other errors
      console.warn('Speech recognition error:', error);

      // Restart on recoverable errors with exponential backoff on mobile
      if (shouldBeListeningRef.current && (error === 'network' || error === 'audio-capture' || error === 'not-allowed' || error === 'service-not-allowed')) {
        reconnectAttemptsRef.current++;
        
        if (reconnectAttemptsRef.current <= maxReconnectAttempts) {
          // Exponential backoff: 500ms, 1s, 2s, 4s... up to 30s
          const delay = Math.min(500 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
          console.log(`[Speech] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, delay);
        } else {
          console.error('[Speech] Max reconnect attempts reached');
        }
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (shouldBeListeningRef.current) {
        // On mobile, use slightly longer delay
        const delay = isMobile ? 100 : 50;
        restartTimeoutRef.current = setTimeout(() => {
          restartRecognition();
        }, delay);
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

  // Deepgram WebSocket connection and audio streaming
  const startDeepgramListening = useCallback(async () => {
    if (!deepgramApiKeyRef.current) return false;
    
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: DEEPGRAM_CONFIG.sample_rate,
        }
      });
      streamRef.current = stream;

      // Build WebSocket URL with config
      const params = new URLSearchParams({
        model: DEEPGRAM_CONFIG.model,
        language: language || DEEPGRAM_CONFIG.language,
        smart_format: String(DEEPGRAM_CONFIG.smart_format),
        interim_results: String(DEEPGRAM_CONFIG.interim_results),
        utterance_end_ms: String(DEEPGRAM_CONFIG.utterance_end_ms),
        vad_events: String(DEEPGRAM_CONFIG.vad_events),
        endpointing: String(DEEPGRAM_CONFIG.endpointing),
        encoding: DEEPGRAM_CONFIG.encoding,
        sample_rate: String(DEEPGRAM_CONFIG.sample_rate),
      });

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      const socket = new WebSocket(wsUrl, ['token', deepgramApiKeyRef.current]);
      deepgramSocketRef.current = socket;

      socket.onopen = () => {
        console.log('🎤 Deepgram WebSocket connected - streaming audio');
        setIsListening(true);
        isListeningRef.current = true;
        
        // Set up audio processing with AudioContext
        const audioContext = new AudioContext({ sampleRate: DEEPGRAM_CONFIG.sample_rate });
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(stream);
        
        // Use ScriptProcessor for raw PCM data (required by Deepgram)
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        audioProcessorRef.current = processor;
        
        // Also set up analyser for audio level visualization
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        analyserRef.current = analyser;
        
        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN && isListeningRef.current) {
            const inputData = e.inputBuffer.getChannelData(0);
            // Convert Float32 to Int16 PCM
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            socket.send(pcmData.buffer);
          }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Start audio level monitoring
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
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
            const transcript = data.channel.alternatives[0].transcript;
            const isFinal = data.is_final;
            
            if (transcript) {
              if (isFinal) {
                // Accumulate final text instead of sending immediately
                accumulatedTextRef.current += (accumulatedTextRef.current ? ' ' : '') + transcript.trim();
                setInterimTranscript(accumulatedTextRef.current);
                
                // Clear any existing timeout
                if (sentenceTimeoutRef.current) {
                  clearTimeout(sentenceTimeoutRef.current);
                }
                
                // Check if sentence seems complete
                const text = accumulatedTextRef.current.trim();
                const endsWithPunctuation = /[.!?]$/.test(text);
                const waitTime = endsWithPunctuation ? 800 : SENTENCE_WAIT_MS;
                
                sentenceTimeoutRef.current = setTimeout(() => {
                  if (accumulatedTextRef.current.trim() && onTranscriptionRef.current) {
                    onTranscriptionRef.current(accumulatedTextRef.current.trim(), true);
                    accumulatedTextRef.current = '';
                    setInterimTranscript('');
                  }
                }, waitTime);
              } else {
                setInterimTranscript(accumulatedTextRef.current + (accumulatedTextRef.current ? ' ' : '') + transcript);
                if (onInterimResultRef.current) {
                  onInterimResultRef.current(accumulatedTextRef.current + (accumulatedTextRef.current ? ' ' : '') + transcript);
                }
              }
            }
          } else if (data.type === 'UtteranceEnd') {
            // End of speech detected - wait before sending accumulated text
            if (sentenceTimeoutRef.current) {
              clearTimeout(sentenceTimeoutRef.current);
            }
            sentenceTimeoutRef.current = setTimeout(() => {
              if (accumulatedTextRef.current.trim() && onTranscriptionRef.current) {
                onTranscriptionRef.current(accumulatedTextRef.current.trim(), true);
                accumulatedTextRef.current = '';
                setInterimTranscript('');
              }
            }, SENTENCE_WAIT_MS);
          }
        } catch (error) {
          console.error('Error parsing Deepgram response:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('Deepgram WebSocket error:', error);
      };

      socket.onclose = (event) => {
        console.log('Deepgram WebSocket closed:', event.code, event.reason);
        // Auto-reconnect if still supposed to be listening
        if (isListeningRef.current) {
          setTimeout(() => {
            if (isListeningRef.current) {
              startDeepgramListening();
            }
          }, 500);
        }
      };

      return true;
    } catch (error) {
      console.error('Error starting Deepgram:', error);
      return false;
    }
  }, [language]);

  const stopDeepgramListening = useCallback(() => {
    // Close WebSocket
    if (deepgramSocketRef.current) {
      try {
        deepgramSocketRef.current.close();
      } catch {
        // Ignore
      }
      deepgramSocketRef.current = null;
    }
    
    // Stop audio processor
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch {
        // Ignore
      }
      audioProcessorRef.current = null;
    }
    
    // Stop audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // Ignore
      }
      audioContextRef.current = null;
    }
    
    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setAudioLevel(0);
  }, []);

  // Start listening - use Deepgram if available, fallback to Web Speech API
  const startListening = useCallback(async () => {
    // Mark that we want to be listening (for reconnection logic)
    shouldBeListeningRef.current = true;
    reconnectAttemptsRef.current = 0;
    
    if (isListeningRef.current) {
      return;
    }

    console.log('[Speech] Starting listening...', { isMobile, useDeepgram });

    // Try Deepgram first (ultra-low latency)
    if (useDeepgram && deepgramApiKeyRef.current) {
      const success = await startDeepgramListening();
      if (success) {
        return;
      }
      console.warn('Deepgram failed, falling back to Web Speech API');
    }

    // Fallback to Web Speech API
    if (!isSupported) {
      console.warn('Web Speech API not supported in this browser. Voice input disabled.');
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
        console.log('[Speech] Web Speech API started');
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
  }, [useDeepgram, startDeepgramListening, isSupported, initRecognition, startAudioMonitoring, isMobile]);

  // Stop listening
  const stopListening = useCallback(() => {
    console.log('[Speech] Stopping listening...');
    shouldBeListeningRef.current = false;
    isListeningRef.current = false;
    reconnectAttemptsRef.current = 0;
    setIsListening(false);
    setInterimTranscript('');
    
    // Clear sentence accumulation
    if (sentenceTimeoutRef.current) {
      clearTimeout(sentenceTimeoutRef.current);
      sentenceTimeoutRef.current = null;
    }
    // Send any accumulated text before stopping
    if (accumulatedTextRef.current.trim() && onTranscriptionRef.current) {
      onTranscriptionRef.current(accumulatedTextRef.current.trim(), true);
    }
    accumulatedTextRef.current = '';

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    // Stop Deepgram if active
    if (deepgramSocketRef.current) {
      stopDeepgramListening();
    }

    // Stop Web Speech API if active
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore errors when stopping
      }
    }

    stopAudioMonitoring();
  }, [stopDeepgramListening, stopAudioMonitoring]);

  // Handle visibility change - restart mic when app comes back to foreground
  // This is critical for mobile background support
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // App came back to foreground
        if (shouldBeListeningRef.current && !isListeningRef.current) {
          console.log('[Speech] App visible, restarting microphone...');
          // Small delay to let the app settle
          setTimeout(() => {
            if (shouldBeListeningRef.current && !isListeningRef.current) {
              // Re-initialize and start
              if (recognitionRef.current) {
                recognitionRef.current = null;
              }
              startListening();
            }
          }, 300);
        }
      } else {
        // App going to background - on mobile, try to keep listening
        if (isMobile && shouldBeListeningRef.current) {
          console.log('[Speech] App going to background, mic should stay active');
          // The WebView/native app should keep the audio session alive
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startListening, isMobile]);

  // Handle page focus/blur for additional mobile stability
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocus = () => {
      if (shouldBeListeningRef.current && !isListeningRef.current) {
        console.log('[Speech] Window focused, checking mic...');
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
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
      // Cleanup Deepgram
      if (deepgramSocketRef.current) {
        try {
          deepgramSocketRef.current.close();
        } catch {
          // Ignore
        }
      }
      if (audioProcessorRef.current) {
        try {
          audioProcessorRef.current.disconnect();
        } catch {
          // Ignore
        }
      }
      stopAudioMonitoring();
    };
  }, [stopAudioMonitoring]);

  return {
    isListening,
    isSupported: isSupported || useDeepgram, // Supported if either works
    interimTranscript,
    audioLevel,
    startListening,
    stopListening,
    // New: expose Deepgram status
    useDeepgram,
    deepgramReady,
  };
}

export default useLiveSpeech;
